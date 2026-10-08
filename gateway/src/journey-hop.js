'use strict';

const { haversineMeters } = require('./geofence');
const { isJourneyGps } = require('./journey-source-evidence');

const JOURNEY_CONTEXT_MAX_AGE_MS = 60 * 60 * 1000;
const MAX_JOURNEY_SPEED_KMH = 250;

function observationMillis(point) {
  const value = point?.recordedAt;
  return value == null ? NaN : +new Date(value?.toDate?.() ?? value);
}

// Distance alone cannot distinguish a GPS jump from ten minutes on a motorway.
// Only timestamped satellite evidence may relax the legacy distance guard.
function isPlausibleJourneyHop(previous, point) {
  const metres = haversineMeters(previous.lat, previous.lng, point.lat, point.lng);
  const elapsed = observationMillis(point) - observationMillis(previous);
  if (isJourneyGps(previous) && isJourneyGps(point) && Number.isFinite(elapsed)) {
    // Home resume seeds the first outside fix as its own baseline. Duplicate
    // route insertion is guarded separately by the journey's timestamp checks.
    if (elapsed === 0 && metres === 0) return true;
    return elapsed > 0 && metres / elapsed * 3600 <= MAX_JOURNEY_SPEED_KMH;
  }
  return metres <= 5000;
}

module.exports = { isPlausibleJourneyHop, JOURNEY_CONTEXT_MAX_AGE_MS };
