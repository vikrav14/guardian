const admin = require('firebase-admin');

/** In-memory inside/outside state: `${imei}:${geofenceId}` → boolean */
const insideState = new Map();
/** Cooldown to avoid flapping alerts */
const lastAlertAt = new Map();
const COOLDOWN_MS = 60_000;

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Load active geofences for an IMEI and emit enter/exit transitions.
 * @returns {Promise<Array<{ type: string, severity: string, message: string, payload: object }>>}
 */
async function evaluateGeofenceTransitions(db, imei, location) {
  if (!db || !location || typeof location.lat !== 'number' || typeof location.lng !== 'number') {
    return [];
  }

  const snap = await db
    .collection('geofences')
    .where('imei', '==', imei)
    .where('active', '==', true)
    .get();

  const events = [];
  const now = Date.now();

  for (const doc of snap.docs) {
    const data = doc.data() || {};
    const center = data.center || {};
    const lat = Number(center.lat);
    const lng = Number(center.lng);
    const radius = Number(data.radiusMeters) || 150;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const distance = haversineMeters(location.lat, location.lng, lat, lng);
    // A zone with a wifiSsid configured is "inside" if either GPS says so, OR the
    // pendant currently reports being associated with that SSID — whichever fires
    // first, since indoor GPS is often unreliable right where a WiFi fence matters.
    // NOTE: the GT06/V28C protocol decoder in ./protocol/gt06.js does not currently
    // extract a WiFi SSID from any device packet (the vendor docs in docs/reference/
    // don't document that packet's byte layout), so `location.wifiSsid` is always
    // undefined today — this check is ready for whenever that decoding is added.
    const wifiMatch =
      Boolean(data.wifiSsid) &&
      Boolean(location.wifiSsid) &&
      String(location.wifiSsid).trim().toLowerCase() === String(data.wifiSsid).trim().toLowerCase();
    const inside = distance <= radius || wifiMatch;
    const key = `${imei}:${doc.id}`;
    const prev = insideState.get(key);

    insideState.set(key, inside);

    // First sample: seed state only, don't alert.
    if (prev === undefined) continue;
    if (prev === inside) continue;

    const cooldownKey = `${key}:${inside ? 'enter' : 'exit'}`;
    const last = lastAlertAt.get(cooldownKey) || 0;
    if (now - last < COOLDOWN_MS) continue;
    lastAlertAt.set(cooldownKey, now);

    const name = data.name || 'Safe zone';
    if (inside) {
      events.push({
        type: 'geofence_enter',
        severity: 'info',
        message: `Entered safe zone: ${name}`,
        payload: {
          geofenceId: doc.id,
          geofenceName: name,
          distanceMeters: Math.round(distance),
          viaWifi: wifiMatch,
          source: 'gateway',
        },
      });
    } else {
      events.push({
        type: 'geofence_exit',
        severity: 'warning',
        message: `Left safe zone: ${name}`,
        payload: {
          geofenceId: doc.id,
          geofenceName: name,
          distanceMeters: Math.round(distance),
          viaWifi: wifiMatch,
          source: 'gateway',
        },
      });
    }
  }

  return events;
}

module.exports = {
  evaluateGeofenceTransitions,
  haversineMeters,
};
