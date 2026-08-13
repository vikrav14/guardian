const { normalizeE164, sendWhatsApp } = require('../notify');
const { haversineMeters } = require('../geofence');
const { sendDeviceCommand: sendDeviceCommandImpl } = require('../commands');
const { ACTION_STATUS, getPendingAction, storePendingAction } = require('../pending-actions');
const { batteryFreshness } = require('../battery-freshness');
const { analyzeJourney } = require('../journey-diagnostics');

const CALLER_ROLES = Object.freeze({
  GUARDIAN: 'guardian',
  ADMIN: 'admin',
  EMERGENCY_CONTACT: 'emergency_contact',
  UNKNOWN: 'unknown',
});

function permissionsForCallerRole(role) {
  const registeredGuardian =
    role === CALLER_ROLES.GUARDIAN || role === CALLER_ROLES.ADMIN;

  return Object.freeze({
    canUseWhatsAppAssistant: registeredGuardian,
    canReadDeviceStatus: registeredGuardian,
    canReadLocation: registeredGuardian,
    canReadAlerts: registeredGuardian,
    canReadSafeZones: registeredGuardian,
    canControlDevice: registeredGuardian,
    canScheduleReminders: registeredGuardian,
    canReceiveSafetyAlerts: role === CALLER_ROLES.EMERGENCY_CONTACT,
  });
}

function normalizePhoneList(values) {
  return values
    .filter(Boolean)
    .map((value) => normalizeE164(String(value)))
    .filter(Boolean);
}

function restrictedCallerReply(ctx, { critical = false } = {}) {
  if (ctx?.callerRole === CALLER_ROLES.EMERGENCY_CONTACT) {
    if (critical) {
      return 'You are registered as an emergency contact. Guardian WhatsApp chat does not trigger an SOS or contact emergency services on your behalf. Use the Guardian watch/app SOS flow for Guardian alerts, and contact emergency services directly if immediate help is needed.';
    }

    return 'You are registered as an emergency contact, but emergency-contact status does not grant access to private location, watch status, history, safe zones or device controls. A Guardian account must explicitly share access with you in the app. You can still receive configured Guardian safety alerts such as SOS or fall notifications.';
  }

  if (critical) {
    return "This number isn't registered. If immediate help is needed, contact emergency services directly. Ask your guardian to register this number before using Guardian WhatsApp.";
  }

  return "This number isn't registered with a Guardian account. Ask your guardian to add or share access with you in the app first.";
}

/**
 * Resolve which registered Guardian account a WhatsApp sender is allowed to use.
 *
 * Security rule:
 * - A direct users/{uid}.phone or .whatsapp match authenticates that user.
 * - That user gets ONLY their own users/{uid}.linkedImeis.
 * - Emergency-contact membership is notification-only and never inherits the
 *   guardian owner's linkedImeis.
 * - Direct registered-user matches always win over emergency-contact matches.
 */
async function resolveCallerContext(db, fromRaw) {
  const from = normalizeE164(String(fromRaw || '').replace(/^whatsapp:/i, ''));

  const unknownContext = {
    from,
    uid: null,
    accountUid: null,
    ownerUid: null,
    displayName: null,
    callerRole: CALLER_ROLES.UNKNOWN,
    accessSource: 'none',
    permissions: permissionsForCallerRole(CALLER_ROLES.UNKNOWN),
    linkedImeis: [],
    devices: [],
  };

  if (!db) return unknownContext;

  const usersSnap = await db.collection('users').get();
  const users = usersSnap.docs.map((doc) => ({
    uid: doc.id,
    ...(doc.data() || {}),
  }));

  // Direct registered-user matches win over emergency-contact matches.
  let matchedUser = null;
  for (const user of users) {
    const directPhones = normalizePhoneList([user.phone, user.whatsapp]);
    if (directPhones.includes(from)) {
      matchedUser = user;
      break;
    }
  }

  if (matchedUser) {
    const callerRole =
      String(matchedUser.role || '').toLowerCase() === 'admin'
        ? CALLER_ROLES.ADMIN
        : CALLER_ROLES.GUARDIAN;

    const linkedImeis = Array.isArray(matchedUser.linkedImeis)
      ? [...new Set(matchedUser.linkedImeis.filter(Boolean).map(String))]
      : [];

    const devices = [];
    for (const imei of linkedImeis) {
      const snap = await db.collection('devices').doc(imei).get();
      if (snap.exists) {
        devices.push({ imei, ...snap.data() });
      }
    }

    return {
      from,
      uid: matchedUser.uid,
      accountUid: matchedUser.uid,
      ownerUid: null,
      displayName: matchedUser.displayName || matchedUser.email || null,
      callerRole,
      accessSource: 'registered_user',
      permissions: permissionsForCallerRole(callerRole),
      linkedImeis,
      devices,
    };
  }

  // Emergency contacts are recognised but get zero private query/control access.
  for (const owner of users) {
    const contacts = Array.isArray(owner.emergencyContacts)
      ? owner.emergencyContacts
      : [];

    for (const contact of contacts) {
      if (!contact) continue;

      const contactPhones = normalizePhoneList([
        contact.phone,
        contact.whatsapp,
      ]);

      if (!contactPhones.includes(from)) continue;

      return {
        from,
        uid: null,
        accountUid: null,
        ownerUid: owner.uid,
        displayName: contact.name || 'Emergency contact',
        callerRole: CALLER_ROLES.EMERGENCY_CONTACT,
        accessSource: 'emergency_contact',
        permissions: permissionsForCallerRole(CALLER_ROLES.EMERGENCY_CONTACT),
        linkedImeis: [],
        devices: [],
      };
    }
  }

  return unknownContext;
}

function deviceLabel(device) {
  if (device.nickname && String(device.nickname).trim()) {
    return String(device.nickname).trim();
  }
  if (device.relationship && String(device.relationship).trim()) {
    return String(device.relationship).trim();
  }
  if (device.name && String(device.name).trim()) {
    const legacy = String(device.name)
      .trim()
      .replace(/(?:'s)?\s+(?:pendant|device)$/i, '')
      .trim();
    if (legacy && !legacy.toLowerCase().startsWith('device ')) return legacy;
  }
  return 'Loved one';
}

function findDevice(devices, query) {
  if (!query) return devices[0] || null;
  const q = String(query).toLowerCase().trim();
  return (
    devices.find((d) => d.imei === query) ||
    devices.find((d) => deviceLabel(d).toLowerCase() === q) ||
    devices.find((d) => deviceLabel(d).toLowerCase().includes(q)) ||
    devices.find((d) => String(d.imei).endsWith(q)) ||
    null
  );
}

async function getLastLocation(ctx, { device_name: deviceName, imei } = {}) {
  const device = findDevice(ctx.devices, imei || deviceName);
  if (!device) {
    return { error: 'No matching watch. Ask list_devices first.' };
  }
  const loc = device.location || {};
  // Filter GPS noise & stale low speeds: walking speed (~5 km/h) threshold.
  // Speeds under 5 km/h are too slow to be real movement (likely GPS noise or stale data).
  // Real movement is typically faster (car ~30+ km/h, bike ~15+ km/h, jogging ~10+ km/h).
  const speedKmh = device.speedKmh != null && device.speedKmh >= 5 ? device.speedKmh : 0;

  // Consider online if recent heartbeat (within 15 min) — device connects periodically to send data
  const lastHeartbeatTime = device.lastHeartbeatAt?.toDate?.() || device.lastHeartbeatAt;
  const now = new Date();
  const heartbeatAgeMs = lastHeartbeatTime ? now.getTime() - lastHeartbeatTime.getTime() : Infinity;
  const isRecentlyActive = heartbeatAgeMs < 15 * 60 * 1000; // 15 minutes

  return {
    name: deviceLabel(device),
    imei: device.imei,
    online: isRecentlyActive,
    batteryPercent: device.batteryPercent ?? null,
    lat: loc.lat ?? null,
    lng: loc.lng ?? null,
    placeLabel: loc.placeLabel || null,
    accuracySource: loc.accuracySource || null,
    speedKmh: speedKmh,
    updatedAt: device.updatedAt?.toDate?.()?.toISOString?.() || device.updatedAt || null,
    mapsUrl:
      loc.lat != null && loc.lng != null
        ? `https://maps.google.com/?q=${loc.lat},${loc.lng}`
        : null,
  };
}

async function getBattery(ctx, { device_name: deviceName, imei } = {}) {
  const device = findDevice(ctx.devices, imei || deviceName);
  if (!device) {
    return { error: 'No matching watch.' };
  }
  const freshness = batteryFreshness(device);
  return {
    name: deviceLabel(device),
    imei: device.imei,
    batteryPercent: device.batteryPercent ?? null,
    online: freshness.online,
    lastHeartbeatAt:
      device.lastHeartbeatAt?.toDate?.()?.toISOString?.() || device.lastHeartbeatAt || null,
    ...freshness,
  };
}

async function getRecentAlerts(db, ctx, { limit = 5, device_name: deviceName, imei } = {}) {
  const device = deviceName || imei ? findDevice(ctx.devices, imei || deviceName) : null;
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 5));
  let query = db.collection('alerts').orderBy('createdAt', 'desc').limit(safeLimit);
  if (device) {
    query = db
      .collection('alerts')
      .where('imei', '==', device.imei)
      .orderBy('createdAt', 'desc')
      .limit(safeLimit);
  }
  try {
    const snap = await query.get();
    return {
      alerts: snap.docs.map((doc) => {
        const d = doc.data() || {};
        return {
          id: doc.id,
          imei: d.imei,
          type: d.type,
          severity: d.severity,
          message: d.message,
          resolved: d.resolved === true,
          createdAt: d.createdAt?.toDate?.()?.toISOString?.() || null,
        };
      }),
    };
  } catch (err) {
    // Missing composite index — fall back to recent global filter in memory
    const snap = await db.collection('alerts').orderBy('createdAt', 'desc').limit(Math.max(100, safeLimit)).get();
    let alerts = snap.docs.map((doc) => {
      const d = doc.data() || {};
      return {
        id: doc.id,
        imei: d.imei,
        type: d.type,
        severity: d.severity,
        message: d.message,
        resolved: d.resolved === true,
        createdAt: d.createdAt?.toDate?.()?.toISOString?.() || null,
      };
    });
    if (device) {
      alerts = alerts.filter((a) => a.imei === device.imei);
    }
    return { alerts: alerts.slice(0, safeLimit), note: err.message };
  }
}

async function getRecentJourneys(db, ctx, { limit = 3, device_name: deviceName, imei } = {}) {
  const device = findDevice(ctx.devices, imei || deviceName);
  if (!device) {
    return { error: 'No matching watch.' };
  }

  const safeLimit = Math.min(10, Math.max(1, Number(limit) || 3));
  // Read beyond the requested display count so a noisy recent record does not
  // hide an older genuine journey.
  const scanLimit = Math.min(30, Math.max(safeLimit, safeLimit * 5));
  const snap = await db
    .collection('devices')
    .doc(device.imei)
    .collection('journeys')
    .orderBy('endAt', 'desc')
    .limit(scanLimit)
    .get();

  let omittedLowQualityCount = 0;
  const journeys = [];
  for (const doc of snap.docs) {
    const journey = doc.data() || {};
    const analysis = analyzeJourney({ id: doc.id, ...journey });
    if (analysis.assessment === 'likely_stationary_drift') {
      omittedLowQualityCount += 1;
      continue;
    }
    journeys.push({
      id: doc.id,
      startAt: journey.startAt?.toDate?.()?.toISOString?.() || journey.startAt || null,
      endAt: journey.endAt?.toDate?.()?.toISOString?.() || journey.endAt || null,
      distanceKm: Number.isFinite(Number(journey.distanceKm))
        ? Number(journey.distanceKm)
        : null,
      closeReason: journey.closeReason || null,
      originGeofenceName: journey.originGeofenceName || null,
      stopCount: Number.isFinite(Number(journey.stopCount))
        ? Number(journey.stopCount)
        : Array.isArray(journey.stops) ? journey.stops.length : 0,
    });
    if (journeys.length >= safeLimit) break;
  }

  return {
    name: deviceLabel(device),
    journeys,
    omittedLowQualityCount,
  };
}

function timestampMs(value) {
  if (!value) return null;
  const date = value?.toDate?.() || (value instanceof Date ? value : new Date(value));
  const time = date?.getTime?.();
  return Number.isFinite(time) ? time : null;
}

async function getDailySummary(
  db,
  ctx,
  { start_at: startAt, end_at: endAt, period_label: periodLabel = 'today', device_name: deviceName, imei } = {},
) {
  const device = findDevice(ctx.devices, imei || deviceName);
  if (!device) return { error: 'No matching watch.' };
  const startMs = timestampMs(startAt);
  const endMs = timestampMs(endAt);
  if (startMs == null || endMs == null || endMs <= startMs) {
    return { error: 'A valid summary period is required.' };
  }

  const [journeyResult, alertResult] = await Promise.all([
    getRecentJourneys(db, ctx, { imei: device.imei, limit: 10 }),
    getRecentAlerts(db, ctx, { imei: device.imei, limit: 100 }),
  ]);
  const journeys = (journeyResult.journeys || []).filter((journey) => {
    const time = timestampMs(journey.startAt);
    return time != null && time >= startMs && time < endMs;
  });
  const alerts = (alertResult.alerts || []).filter((alert) => {
    const time = timestampMs(alert.createdAt);
    return time != null && time >= startMs && time < endMs;
  });
  const criticalAlerts = alerts.filter((alert) => ['sos', 'fall'].includes(String(alert.type || '').toLowerCase()));
  const safeZoneEvents = alerts.filter((alert) => /geofence|safe_zone/i.test(String(alert.type || '')));
  const freshness = batteryFreshness(device);

  return {
    name: deviceLabel(device),
    periodLabel,
    startAt: new Date(startMs).toISOString(),
    endAt: new Date(endMs).toISOString(),
    journeyCount: journeys.length,
    distanceKm: journeys.reduce((sum, journey) => sum + (Number(journey.distanceKm) || 0), 0),
    omittedLowQualityCount: journeyResult.omittedLowQualityCount || 0,
    alertCount: alerts.length,
    criticalAlertCount: criticalAlerts.length,
    safeZoneEventCount: safeZoneEvents.length,
    alertCoverageComplete: (alertResult.alerts || []).length < 100,
    recentAlertTypes: alerts.slice(0, 3).map((alert) => alert.type).filter(Boolean),
    batteryPercent: device.batteryPercent ?? null,
    batteryAgeSeconds: freshness.ageSeconds,
    batteryStale: freshness.stale,
    online: freshness.online,
  };
}

function listDevices(ctx) {
  return {
    devices: ctx.devices.map((d) => ({
      name: deviceLabel(d),
      imei: d.imei,
      online: d.online === true,
      batteryPercent: d.batteryPercent ?? null,
    })),
  };
}

async function getDeviceIntelligence(ctx, { device_name: deviceName, imei } = {}) {
  const device = findDevice(ctx.devices, imei || deviceName);
  if (!device) {
    return { error: 'No matching watch.' };
  }

  const intelligence = device.intelligence || {};
  const topInsight = intelligence.topInsight || null;

  return {
    name: deviceLabel(device),
    imei: device.imei,
    online: device.online === true,
    updatedAt:
      intelligence.updatedAt?.toDate?.()?.toISOString?.() || intelligence.updatedAt || null,
    topInsight: topInsight
      ? {
          id: topInsight.id || null,
          facts: Array.isArray(topInsight.facts) ? topInsight.facts : [],
          inference: topInsight.inference || null,
          confidence: topInsight.confidence ?? null,
          level: topInsight.level || null,
        }
      : null,
    insightCount: Array.isArray(intelligence.insights) ? intelligence.insights.length : 0,
  };
}

async function isAtGeofence(db, ctx, { geofence_name: geofenceName, device_name: deviceName, imei } = {}) {
  const device = findDevice(ctx.devices, imei || deviceName);
  if (!device) {
    return { error: 'No matching watch.' };
  }

  const loc = device.location || {};
  if (loc.lat == null || loc.lng == null) {
    return {
      name: deviceLabel(device),
      imei: device.imei,
      atGeofence: false,
      reason: 'no_gps_fix',
    };
  }

  if (!db) {
    return { error: 'Live geofence lookup unavailable.' };
  }

  const snap = await db
    .collection('geofences')
    .where('imei', '==', device.imei)
    .where('active', '==', true)
    .get();

  const query = String(geofenceName || '').trim().toLowerCase();
  if (!query) {
    return { error: 'geofence_name is required.' };
  }

  let matched = null;
  for (const doc of snap.docs) {
    const data = doc.data() || {};
    const name = String(data.name || '').trim();
    if (name.toLowerCase() === query || name.toLowerCase().includes(query)) {
      matched = { id: doc.id, ...data };
      break;
    }
  }

  if (!matched) {
    return {
      name: deviceLabel(device),
      imei: device.imei,
      geofenceName: geofenceName || null,
      atGeofence: false,
      reason: 'geofence_not_found',
    };
  }

  const center = matched.center || {};
  const lat = Number(center.lat);
  const lng = Number(center.lng);
  const radius = Number(matched.radiusMeters) || 150;
  const distanceMeters = haversineMeters(loc.lat, loc.lng, lat, lng);
  const inside = distanceMeters <= radius;

  return {
    name: deviceLabel(device),
    imei: device.imei,
    geofenceName: matched.name || geofenceName,
    geofenceId: matched.id,
    atGeofence: inside,
    distanceMeters: Math.round(distanceMeters),
    radiusMeters: radius,
    lat: loc.lat,
    lng: loc.lng,
  };
}

async function sendDeviceCommand(db, ctx, { command_type: commandType, device_name: deviceName, imei } = {}) {
  const device = findDevice(ctx.devices, imei || deviceName);
  if (!device) return { error: 'No matching watch.' };
  const cmd = String(commandType || '').toLowerCase().trim();
  if (['listen', 'monitor'].includes(cmd)) {
    return { error: 'Voice monitoring is disabled by Guardian safety policy.' };
  }
  if (!['ring', 'locate', 'vibrate', 'alarm'].includes(cmd)) {
    return { error: `Unknown command: ${commandType}. Supported: ring, locate, vibrate, alarm.` };
  }
  if (!db || !ctx.uid) return { error: 'Authenticated device command service unavailable.' };
  const pending = await storePendingAction(db, ctx.uid, {
    targetImei: device.imei,
    wearerName: deviceLabel(device),
    actionType: cmd,
    parameters: {},
  });
  return {
    name: deviceLabel(device),
    commandType: cmd,
    status: ACTION_STATUS.AWAITING,
    pendingActionId: pending.id,
    reply: `Confirm: ${cmd} ${deviceLabel(device)}'s watch now? Reply YES to continue or CANCEL.`,
  };
}

async function executeDeviceCommand(db, ctx, { command_type: commandType, imei } = {}) {
  const device = findDevice(ctx.devices, imei);
  if (!device) {
    return { error: 'No matching watch.' };
  }

  const cmd = String(commandType || '').toLowerCase().trim();
  if (!['ring', 'locate', 'vibrate', 'alarm'].includes(cmd)) {
    return { error: `Command is not permitted: ${commandType}.` };
  }

  if (!db) {
    return { error: 'Device command service unavailable.' };
  }

  try {
    // Map command aliases to actual command types
    const typeMap = {
      ring: 'ring_to_find',
      locate: 'ring_to_find',
      vibrate: 'ring_to_find',
      alarm: 'ring_to_find',
    };
    const actualType = typeMap[cmd] || cmd;

    // Send the command to the device
    const result = await sendDeviceCommandImpl(db, device.imei, actualType, {});

    // Store command in Firestore for audit
    const commandRef = db.collection('devices').doc(device.imei).collection('commands').doc();
    const now = new Date();
    await commandRef.set({
      type: cmd,
      status: 'queued',
      createdAt: now,
      createdBy: ctx.uid || 'unknown',
      sentVia: result.channel,
      commandText: result.text,
      deviceResponse: null,
    });

    // Auto-stop ring after 60 seconds (device firmware doesn't auto-stop as documented)
    if (actualType === 'ring_to_find') {
      const { sendDownlinkCommand } = require('../downlink');
      setTimeout(() => {
        try {
          sendDownlinkCommand(device.imei, 'CR');
          console.log(`[ring-auto-stop] sent CR to ${device.imei} to interrupt ring after 60s`);
        } catch (err) {
          console.error(`[ring-auto-stop] failed for ${device.imei}:`, err.message);
        }
      }, 60_000);
    }

    return {
      name: deviceLabel(device),
      imei: device.imei,
      commandType: cmd,
      commandId: commandRef.id,
      status: ACTION_STATUS.QUEUED,
      sentAt: now.toISOString(),
      online: device.online === true,
      channel: result.channel,
      estimatedWaitSeconds: 30,
      note: actualType === 'ring_to_find' ? 'Device will auto-stop after 60 seconds' : undefined,
    };
  } catch (err) {
    return {
      error: `Could not send command: ${err.message}`,
      name: deviceLabel(device),
      imei: device.imei,
      online: device.online === true,
    };
  }
}

async function scheduleReminder(db, ctx, { medicine_name: medicineName, time: scheduledTime, frequency = 'daily', device_name: deviceName, imei } = {}) {
  const device = findDevice(ctx.devices, imei || deviceName);
  if (!device) return { error: 'No matching watch.' };
  const medicine = String(medicineName || '').trim();
  const time = String(scheduledTime || '').trim();
  if (!medicine) return { error: 'medicine_name is required.' };
  if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(time)) return { error: `Invalid time format: ${time}. Use HH:MM.` };
  if (!db || !ctx.uid) return { error: 'Authenticated reminder service unavailable.' };
  const normalizedTime = time.padStart(5, '0');
  const normalizedFrequency = String(frequency || 'daily').trim().toLowerCase();
  const pending = await storePendingAction(db, ctx.uid, {
    targetImei: device.imei,
    wearerName: deviceLabel(device),
    actionType: 'schedule_reminder',
    parameters: { medicineName: medicine, time: normalizedTime, frequency: normalizedFrequency },
  });
  return {
    name: deviceLabel(device),
    status: ACTION_STATUS.AWAITING,
    pendingActionId: pending.id,
    reply: `Confirm: set ${medicine} at ${normalizedTime} (${normalizedFrequency}) for ${deviceLabel(device)}? Reply YES to continue or CANCEL.`,
  };
}

async function executeReminder(db, ctx, { medicine_name: medicineName, time: scheduledTime, frequency = 'daily', imei } = {}) {
  const device = findDevice(ctx.devices, imei);
  if (!device) {
    return { error: 'No matching watch.' };
  }

  const medicine = String(medicineName || '').trim();
  if (!medicine) {
    return { error: 'medicine_name is required.' };
  }

  const time = String(scheduledTime || '').trim();
  if (!time) {
    return { error: 'time is required (HH:MM format).' };
  }

  if (!db) {
    return { error: 'Reminder service unavailable.' };
  }

  // Validate time format (HH:MM)
  if (!/^\d{1,2}:\d{2}$/.test(time)) {
    return { error: `Invalid time format: ${time}. Use HH:MM.` };
  }

  // Store reminder in Firestore
  const reminderRef = db.collection('devices').doc(device.imei).collection('reminders').doc();
  const now = new Date();
  await reminderRef.set({
    medicineName: medicine,
    scheduledTime: time,
    frequency: frequency || 'daily',
    status: 'active',
    createdAt: now,
    createdBy: ctx.uid || 'unknown',
    lastSentAt: null,
  });

  return {
    name: deviceLabel(device),
    imei: device.imei,
    reminderId: reminderRef.id,
    medicineName: medicine,
    scheduledTime: time,
    frequency: frequency || 'daily',
    status: 'scheduled',
    createdAt: now.toISOString(),
  };
}

async function executeConfirmedAction(db, ctx, action) {
  if (!action || action.callerUid !== ctx.uid) return { error: 'Caller does not own this action.' };
  if (!(ctx.linkedImeis || []).includes(action.targetImei)) return { error: 'Target is no longer authorised.' };
  if (action.actionType === 'schedule_reminder') {
    return executeReminder(db, ctx, {
      imei: action.targetImei,
      medicine_name: action.parameters.medicineName,
      time: action.parameters.time,
      frequency: action.parameters.frequency,
    });
  }
  return executeDeviceCommand(db, ctx, { imei: action.targetImei, command_type: action.actionType });
}

async function checkPendingAction(db, ctx) {
  if (!db || !ctx.uid) {
    return { pendingAction: null };
  }

  const pending = await getPendingAction(db, ctx.uid);
  if (!pending) {
    return { pendingAction: null };
  }

  return {
    pendingAction: {
      id: pending.id,
      type: pending.actionType,
      device: pending.wearerName,
      createdAtSeconds: Math.floor(pending.createdAt.getTime() / 1000),
    },
  };
}

const TOOL_DEFINITIONS = [
  {
    name: 'list_devices',
    description: 'List watches this family can see (names, IMEI, online, battery).',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_last_location',
    description: 'Get the latest GPS location for a watch by friendly name or IMEI.',
    input_schema: {
      type: 'object',
      properties: {
        device_name: { type: 'string', description: 'Friendly name, e.g. Mum or Dad' },
        imei: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_battery',
    description: 'Get battery percent and last heartbeat for a watch.',
    input_schema: {
      type: 'object',
      properties: {
        device_name: { type: 'string' },
        imei: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_recent_alerts',
    description: 'Get recent SOS / fall / geofence alerts for the family or one watch.',
    input_schema: {
      type: 'object',
      properties: {
        device_name: { type: 'string' },
        imei: { type: 'string' },
        limit: { type: 'number' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_recent_journeys',
    description: 'Get recent confirmed journeys for one authorised watch.',
    input_schema: {
      type: 'object',
      properties: {
        device_name: { type: 'string' },
        imei: { type: 'string' },
        limit: { type: 'number' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_daily_summary',
    description: 'Get a deterministic factual daily summary for one authorised watch.',
    input_schema: {
      type: 'object',
      properties: {
        start_at: { type: 'string' },
        end_at: { type: 'string' },
        period_label: { type: 'string' },
        device_name: { type: 'string' },
        imei: { type: 'string' },
      },
      required: ['start_at', 'end_at'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_device_intelligence',
    description:
      'Get gateway rule-based insights for a watch (topInsight from devices/{imei}.intelligence). Facts only — do not invent.',
    input_schema: {
      type: 'object',
      properties: {
        device_name: { type: 'string' },
        imei: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'is_at_geofence',
    description:
      'Check whether a watch is currently inside a named safe zone (distance check). Returns facts only.',
    input_schema: {
      type: 'object',
      properties: {
        geofence_name: { type: 'string', description: 'Safe zone name, e.g. Home or School' },
        device_name: { type: 'string' },
        imei: { type: 'string' },
      },
      required: ['geofence_name'],
      additionalProperties: false,
    },
  },
  {
    name: 'send_device_command',
    description:
      'Send a command to a watch: ring (sound/vibrate alert), locate (GPS ping), or listen (voice monitor). Supported: ring, locate, vibrate, alarm, listen, monitor.',
    input_schema: {
      type: 'object',
      properties: {
        command_type: { type: 'string', description: 'Command type: ring, locate, vibrate, alarm, listen, or monitor' },
        device_name: { type: 'string' },
        imei: { type: 'string' },
      },
      required: ['command_type'],
      additionalProperties: false,
    },
  },
  {
    name: 'schedule_reminder',
    description:
      'Schedule a pill/medication reminder for a watch. Returns reminder ID and scheduled time.',
    input_schema: {
      type: 'object',
      properties: {
        medicine_name: { type: 'string', description: 'Name of the medicine or pill' },
        time: { type: 'string', description: 'Time in HH:MM format (24-hour)' },
        frequency: { type: 'string', description: 'Frequency: daily, weekdays, weekends, or specific day' },
        device_name: { type: 'string' },
        imei: { type: 'string' },
      },
      required: ['medicine_name', 'time'],
      additionalProperties: false,
    },
  },
  {
    name: 'check_pending_action',
    description: 'Check if there is a pending action awaiting confirmation (e.g., ring device, schedule reminder).',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

async function runTool(db, ctx, name, input) {
  switch (name) {
    case 'list_devices':
      return listDevices(ctx);
    case 'get_last_location':
      return getLastLocation(ctx, input || {});
    case 'get_battery':
      return getBattery(ctx, input || {});
    case 'get_recent_alerts':
      return getRecentAlerts(db, ctx, input || {});
    case 'get_recent_journeys':
      return getRecentJourneys(db, ctx, input || {});
    case 'get_daily_summary':
      return getDailySummary(db, ctx, input || {});
    case 'get_device_intelligence':
      return getDeviceIntelligence(ctx, input || {});
    case 'is_at_geofence':
      return isAtGeofence(db, ctx, input || {});
    case 'send_device_command':
      return sendDeviceCommand(db, ctx, input || {});
    case 'schedule_reminder':
      return scheduleReminder(db, ctx, input || {});
    case 'check_pending_action':
      return checkPendingAction(db, ctx);
    default:
      return { error: `Unknown tool ${name}` };
  }
}

module.exports = {
  CALLER_ROLES,
  permissionsForCallerRole,
  restrictedCallerReply,
  resolveCallerContext,
  TOOL_DEFINITIONS,
  runTool,
  deviceLabel,
  getDeviceIntelligence,
  getRecentJourneys,
  getDailySummary,
  executeConfirmedAction,
  isAtGeofence,
};
