const { normalizeE164, sendWhatsApp } = require('../notify');
const { haversineMeters } = require('../geofence');
const { sendDeviceCommand: sendDeviceCommandImpl } = require('../commands');
const { getPendingAction, removePendingAction } = require('../pending-actions');

/**
 * Resolve which guardian + devices a WhatsApp sender may ask about.
 */
async function resolveCallerContext(db, fromRaw) {
  const from = normalizeE164(String(fromRaw || '').replace(/^whatsapp:/i, ''));
  if (!db) {
    return { from, uid: null, displayName: null, linkedImeis: [], devices: [] };
  }

  const usersSnap = await db.collection('users').get();
  let matched = null;

  for (const doc of usersSnap.docs) {
    const data = doc.data() || {};
    const phones = [
      data.phone,
      data.whatsapp,
      ...(Array.isArray(data.emergencyContacts)
        ? data.emergencyContacts.flatMap((c) => [c?.phone, c?.whatsapp])
        : []),
    ]
      .filter(Boolean)
      .map((p) => normalizeE164(String(p)));

    if (phones.includes(from)) {
      matched = { uid: doc.id, ...data };
      break;
    }
  }

  const linkedImeis = Array.isArray(matched?.linkedImeis) ? matched.linkedImeis : [];

  const devices = [];
  for (const imei of linkedImeis) {
    const snap = await db.collection('devices').doc(imei).get();
    if (snap.exists) {
      devices.push({ imei, ...snap.data() });
    }
  }

  return {
    from,
    uid: matched?.uid || null,
    displayName: matched?.displayName || matched?.email || null,
    linkedImeis,
    devices,
  };
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
  return {
    name: deviceLabel(device),
    imei: device.imei,
    batteryPercent: device.batteryPercent ?? null,
    online: device.online === true,
    lastHeartbeatAt:
      device.lastHeartbeatAt?.toDate?.()?.toISOString?.() || device.lastHeartbeatAt || null,
  };
}

async function getRecentAlerts(db, ctx, { limit = 5, device_name: deviceName, imei } = {}) {
  const device = deviceName || imei ? findDevice(ctx.devices, imei || deviceName) : null;
  let query = db.collection('alerts').orderBy('createdAt', 'desc').limit(Math.min(20, Number(limit) || 5));
  if (device) {
    query = db
      .collection('alerts')
      .where('imei', '==', device.imei)
      .orderBy('createdAt', 'desc')
      .limit(Math.min(20, Number(limit) || 5));
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
    const snap = await db.collection('alerts').orderBy('createdAt', 'desc').limit(30).get();
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
    return { alerts: alerts.slice(0, Number(limit) || 5), note: err.message };
  }
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
  if (!device) {
    return { error: 'No matching watch.' };
  }

  const cmd = String(commandType || '').toLowerCase().trim();
  if (!['ring', 'locate', 'vibrate', 'alarm'].includes(cmd)) {
    return { error: `Unknown command: ${commandType}. Supported: ring, locate, vibrate, alarm.` };
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
      status: 'sent',
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
      status: 'sent',
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
      type: pending.action.type,
      device: pending.action.device,
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
      'Send a command to a watch: ring (sound/vibrate alert) or locate (trigger GPS ping). Supported: ring, locate, vibrate, alarm.',
    input_schema: {
      type: 'object',
      properties: {
        command_type: { type: 'string', description: 'Command type: ring, locate, vibrate, or alarm' },
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
  resolveCallerContext,
  TOOL_DEFINITIONS,
  runTool,
  deviceLabel,
  getDeviceIntelligence,
  isAtGeofence,
};
