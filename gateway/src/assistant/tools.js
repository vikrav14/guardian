const { normalizeE164 } = require('../notify');

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

  let linkedImeis = matched?.linkedImeis;
  if (!Array.isArray(linkedImeis) || linkedImeis.length === 0) {
    // Demo fallback: all devices (bring-up)
    const devicesSnap = await db.collection('devices').limit(20).get();
    linkedImeis = devicesSnap.docs.map((d) => d.id);
  }

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
  if (device.name && String(device.name).trim()) return String(device.name).trim();
  return `Device …${String(device.imei || '').slice(-4)}`;
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
    return { error: 'No matching pendant. Ask list_devices first.' };
  }
  const loc = device.location || {};
  return {
    name: deviceLabel(device),
    imei: device.imei,
    online: device.online === true,
    lat: loc.lat ?? null,
    lng: loc.lng ?? null,
    accuracySource: device.accuracySource || null,
    speedKmh: device.speedKmh ?? null,
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
    return { error: 'No matching pendant.' };
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
  let query = db.collection('alerts').orderBy('createdAt', 'descending').limit(Math.min(20, Number(limit) || 5));
  if (device) {
    query = db
      .collection('alerts')
      .where('imei', '==', device.imei)
      .orderBy('createdAt', 'descending')
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
    const snap = await db.collection('alerts').orderBy('createdAt', 'descending').limit(30).get();
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

const TOOL_DEFINITIONS = [
  {
    name: 'list_devices',
    description: 'List pendants this family can see (names, IMEI, online, battery).',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_last_location',
    description: 'Get the latest GPS location for a pendant by friendly name or IMEI.',
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
    description: 'Get battery percent and last heartbeat for a pendant.',
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
    description: 'Get recent SOS / fall / geofence alerts for the family or one pendant.',
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
    default:
      return { error: `Unknown tool ${name}` };
  }
}

module.exports = {
  resolveCallerContext,
  TOOL_DEFINITIONS,
  runTool,
  deviceLabel,
};
