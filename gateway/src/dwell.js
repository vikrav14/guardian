const { haversineMeters } = require('./geofence');
const config = require('./config');

const STATIONARY_SPEED_KMH = 1;

function isStationary(point, reference) {
  if (point.speedKmh != null && point.speedKmh < STATIONARY_SPEED_KMH) {
    return true;
  }
  if (
    reference &&
    typeof point.lat === 'number' &&
    typeof point.lng === 'number' &&
    typeof reference.lat === 'number' &&
    typeof reference.lng === 'number'
  ) {
    return (
      haversineMeters(reference.lat, reference.lng, point.lat, point.lng) <
      config.writeGateMinMetres
    );
  }
  return false;
}

function trackDwellPoint(state, point, now = new Date()) {
  if (!point || typeof point.lat !== 'number' || typeof point.lng !== 'number') {
    return;
  }

  const dwell = state.currentDwell;
  const stationary = dwell
    ? isStationary(point, { lat: dwell.centerLat, lng: dwell.centerLng })
    : isStationary(point, state.lastPersistedLocation);

  if (!stationary) {
    return;
  }

  if (!dwell) {
    state.currentDwell = {
      type: 'dwell',
      from: now,
      to: now,
      centerLat: point.lat,
      centerLng: point.lng,
      placeName: point.placeName || null,
      geofenceId: point.geofenceId || null,
    };
    return;
  }

  dwell.to = now;
}

function flushDwellSegment(state, now = new Date(), force = false) {
  const dwell = state.currentDwell;
  if (!dwell) return null;

  const minMs = config.dwellMinMinutes * 60 * 1000;
  const durationMs = now.getTime() - new Date(dwell.from).getTime();
  if (!force && durationMs < minMs) {
    return null;
  }

  state.currentDwell = null;
  return {
    type: 'dwell',
    placeName: dwell.placeName,
    geofenceId: dwell.geofenceId,
    from: dwell.from,
    to: now,
    centerLat: dwell.centerLat,
    centerLng: dwell.centerLng,
  };
}

module.exports = {
  isStationary,
  trackDwellPoint,
  flushDwellSegment,
};
