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

function locationSource(location) {
  return String(location?.source || location?.accuracySource || '')
    .trim()
    .toLowerCase();
}

function boundaryUncertaintyMeters(location) {
  const rawAccuracy = Number(location?.accuracyMeters);
  if (Number.isFinite(rawAccuracy) && rawAccuracy > 0) return rawAccuracy;

  const source = locationSource(location);
  if (
    location?.gpsValid === true ||
    (source === 'gps' && location?.gpsValid !== false)
  ) {
    // V52 satellite packets expose validity/satellite count but no horizontal
    // accuracy radius. Keep a conservative boundary margin instead of claiming
    // metre-level precision that the packet does not provide.
    return MIN_BOUNDARY_HYSTERESIS_METERS;
  }

  // An approximate WiFi/LBS observation without a supplied radius cannot prove
  // either side of a safe-zone boundary.
  if (source === 'wifi' || source === 'lbs' || location?.gpsValid === false) {
    return Number.POSITIVE_INFINITY;
  }

  // Legacy/test observations without provenance retain the established margin.
  return MIN_BOUNDARY_HYSTERESIS_METERS;
}

function classifyBoundaryObservation({ distance, radius, wifiMatch, location }) {
  if (wifiMatch) {
    return { classification: 'inside', uncertaintyMeters: 0 };
  }

  const uncertaintyMeters = boundaryUncertaintyMeters(location);
  if (!Number.isFinite(uncertaintyMeters)) {
    return { classification: 'uncertain', uncertaintyMeters: null };
  }

  // The complete uncertainty circle must fit inside the zone before Guardian
  // calls the watch inside. It must sit wholly outside before Guardian calls it
  // outside. Any overlap is explicitly uncertain and cannot change state.
  if (distance + uncertaintyMeters <= radius) {
    return { classification: 'inside', uncertaintyMeters };
  }
  if (distance - uncertaintyMeters > radius) {
    return { classification: 'outside', uncertaintyMeters };
  }
  return { classification: 'uncertain', uncertaintyMeters };
}

function resolveInsideState({ distance, radius, previous, wifiMatch, location }) {
  const observation = classifyBoundaryObservation({
    distance,
    radius,
    wifiMatch,
    location,
  });

  if (observation.classification === 'uncertain') {
    return { inside: previous, observation };
  }

  return {
    inside: observation.classification === 'inside',
    observation,
  };
}

function getGeofencePresence(imei) {
  const presence = devicePresenceState.get(imei);
  if (!presence) {
    return {
      hasActiveZones: false,
      insideAny: false,
      insideZoneIds: [],
      hasUncertainZones: false,
      uncertainZoneIds: [],
    };
  }

  return {
    hasActiveZones: presence.hasActiveZones,
    insideAny: presence.insideAny,
    insideZoneIds: [...presence.insideZoneIds],
    hasUncertainZones: presence.uncertainZoneIds.length > 0,
    uncertainZoneIds: [...presence.uncertainZoneIds],
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
  const uncertainZoneIds = [];
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
    const resolvedState = resolveInsideState({
      distance,
      radius,
      previous: prev,
      wifiMatch,
      location,
    });
    const { inside, observation } = resolvedState;

    if (inside !== undefined) insideState.set(key, inside);
    if (inside === true) insideZoneIds.push(doc.id);
    if (observation.classification === 'uncertain') {
      uncertainZoneIds.push(doc.id);
    }

    // First sample: seed state only, don't alert.
    if (prev === undefined) continue;
    // Uncertainty preserves the last confirmed state but never creates a
    // transition, alert, or journey boundary.
    if (observation.classification === 'uncertain') continue;
    if (prev === inside) continue;

    const cooldownKey = `${key}:${inside ? 'enter' : 'exit'}`;
    const last = lastAlertAt.get(cooldownKey) || 0;
    if (now - last < COOLDOWN_MS) continue;
    lastAlertAt.set(cooldownKey, now);

    const name = data.name || 'Safe zone';
    const observationEvidence = {
      classification: observation.classification,
      recordedAt: location.recordedAt || null,
      source: locationSource(location) || null,
      gpsValid: location.gpsValid === true,
      accuracyMeters:
        Number.isFinite(Number(location.accuracyMeters)) &&
        Number(location.accuracyMeters) > 0
          ? Number(location.accuracyMeters)
          : null,
      satellites:
        Number.isFinite(Number(location.satellites))
          ? Number(location.satellites)
          : null,
      distanceMeters: Math.round(distance),
      radiusMeters: radius,
      boundaryUncertaintyMeters: observation.uncertaintyMeters,
      viaWifi: wifiMatch,
    };

    if (inside) {
      events.push({
        type: 'geofence_enter',
        severity: 'info',
        message: `Entered safe zone: ${name}`,
        eventAt: location.recordedAt || new Date(now),
        payload: {
          geofenceId: doc.id,
          geofenceName: name,
          distanceMeters: Math.round(distance),
          radiusMeters: radius,
          boundaryUncertaintyMeters: observation.uncertaintyMeters,
          viaWifi: wifiMatch,
          source: 'gateway',
          observationEvidence,
        },
      });
    } else {
      events.push({
        type: 'geofence_exit',
        severity: 'warning',
        message: `Left safe zone: ${name}`,
        eventAt: location.recordedAt || new Date(now),
        payload: {
          geofenceId: doc.id,
          geofenceName: name,
          distanceMeters: Math.round(distance),
          radiusMeters: radius,
          boundaryUncertaintyMeters: observation.uncertaintyMeters,
          viaWifi: wifiMatch,
          source: 'gateway',
          observationEvidence,
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
    uncertainZoneIds,
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
  boundaryUncertaintyMeters,
  classifyBoundaryObservation,
};
