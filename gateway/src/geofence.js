const admin = require('firebase-admin');

/** In-memory inside/outside state: `${imei}:${geofenceId}` â†’ boolean */
const insideState = new Map();
/** Current active-zone presence per device. */
const devicePresenceState = new Map();
/** Cooldown to avoid flapping alerts */
const lastAlertAt = new Map();
const COOLDOWN_MS = 60_000;
const MIN_BOUNDARY_HYSTERESIS_METERS = 30;

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

function boundaryUncertaintyMeters(location, radius) {
  const rawAccuracy = Number(location?.accuracyMeters);
  const reportedAccuracy =
    Number.isFinite(rawAccuracy) && rawAccuracy > 0 ? rawAccuracy : 0;

  // Never let an imprecise WiFi/LBS accuracy radius make entry impossible.
  // Cap uncertainty to half the configured zone radius while retaining a small
  // hysteresis even for satellite fixes that do not report accuracy.
  const cap = Math.max(MIN_BOUNDARY_HYSTERESIS_METERS, radius * 0.5);
  return Math.min(
    Math.max(MIN_BOUNDARY_HYSTERESIS_METERS, reportedAccuracy),
    cap
  );
}

function resolveInsideState({ distance, radius, previous, wifiMatch, location }) {
  if (wifiMatch) return true;

  // First sample seeds the state. No transition is emitted for this sample.
  if (previous === undefined) {
    return distance <= radius;
  }

  const uncertainty = boundaryUncertaintyMeters(location, radius);

  if (previous) {
    // Once inside, remain inside until the fix is clearly beyond the zone.
    return distance <= radius + uncertainty;
  }

  // Once outside, require the fix to be clearly inside before entering.
  return distance < Math.max(0, radius - uncertainty);
}

function getGeofencePresence(imei) {
  const presence = devicePresenceState.get(imei);
  if (!presence) {
    return {
      hasActiveZones: false,
      insideAny: false,
      insideZoneIds: [],
    };
  }

  return {
    hasActiveZones: presence.hasActiveZones,
    insideAny: presence.insideAny,
    insideZoneIds: [...presence.insideZoneIds],
  };
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
  const activeKeys = new Set();
  const insideZoneIds = [];
  let activeZoneCount = 0;

  for (const doc of snap.docs) {
    const data = doc.data() || {};
    const center = data.center || {};
    const lat = Number(center.lat);
    const lng = Number(center.lng);
    const radius = Number(data.radiusMeters) || 150;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const distance = haversineMeters(location.lat, location.lng, lat, lng);
    // A zone with a wifiSsid configured is "inside" if either GPS says so, OR the
    // watch currently reports being associated with that SSID â€” whichever fires
    // first, since indoor GPS is often unreliable right where a WiFi fence matters.
    // NOTE: the V52 protocol decoder in ./protocol/gt06.js does not currently
    // extract a WiFi SSID from any device packet (the vendor docs in docs/reference/
    // don't document that packet's byte layout), so `location.wifiSsid` is always
    // undefined today â€” this check is ready for whenever that decoding is added.
    const wifiMatch =
      Boolean(data.wifiSsid) &&
      Boolean(location.wifiSsid) &&
      String(location.wifiSsid).trim().toLowerCase() === String(data.wifiSsid).trim().toLowerCase();

    const key = `${imei}:${doc.id}`;
    activeKeys.add(key);
    activeZoneCount += 1;

    const prev = insideState.get(key);
    const inside = resolveInsideState({
      distance,
      radius,
      previous: prev,
      wifiMatch,
      location,
    });

    insideState.set(key, inside);
    if (inside) insideZoneIds.push(doc.id);

    // First sample: seed state only, don't alert.
    if (prev === undefined) continue;
    if (prev === inside) continue;

    const cooldownKey = `${key}:${inside ? 'enter' : 'exit'}`;
    const last = lastAlertAt.get(cooldownKey) || 0;
    if (now - last < COOLDOWN_MS) continue;
    lastAlertAt.set(cooldownKey, now);

    const name = data.name || 'Safe zone';
    const uncertainty = boundaryUncertaintyMeters(location, radius);

    if (inside) {
      events.push({
        type: 'geofence_enter',
        severity: 'info',
        message: `Entered safe zone: ${name}`,
        payload: {
          geofenceId: doc.id,
          geofenceName: name,
          distanceMeters: Math.round(distance),
          radiusMeters: radius,
          boundaryUncertaintyMeters: Math.round(uncertainty),
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
          radiusMeters: radius,
          boundaryUncertaintyMeters: Math.round(uncertainty),
          viaWifi: wifiMatch,
          source: 'gateway',
        },
      });
    }
  }

  // Remove stale state for zones that are no longer active for this device.
  const prefix = `${imei}:`;
  for (const key of insideState.keys()) {
    if (key.startsWith(prefix) && !activeKeys.has(key)) {
      insideState.delete(key);
    }
  }

  devicePresenceState.set(imei, {
    hasActiveZones: activeZoneCount > 0,
    insideAny: insideZoneIds.length > 0,
    insideZoneIds,
  });

  return events;
}

function resetGeofenceStateForTests() {
  insideState.clear();
  devicePresenceState.clear();
  lastAlertAt.clear();
}

module.exports = {
  evaluateGeofenceTransitions,
  getGeofencePresence,
  resetGeofenceStateForTests,
  haversineMeters,
};
