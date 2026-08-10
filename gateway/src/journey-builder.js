const { encodePolyline } = require('./polyline');
const { haversineMeters } = require('./geofence');
const config = require('./config');

const STATIONARY_SPEED_KMH = 1;
const MAX_JOURNEY_SEGMENT_METRES = 5000;

function isPlausibleCoord(lat, lng) {
  if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) return false;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
  if (Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001) return false;
  if (Math.abs(lat - 22.68) < 0.05 && Math.abs(lng - 113.99) < 0.05) return false;
  if (lat > -5 && lat < 5 && lng > 55 && lng < 60) return false;
  return true;
}

function sameCalendarDay(a, b) {
  const d1 = a instanceof Date ? a : new Date(a);
  const d2 = b instanceof Date ? b : new Date(b);
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

function isMoving(point, reference) {
  if (point.speedKmh != null && Number(point.speedKmh) >= STATIONARY_SPEED_KMH) {
    return true;
  }
  if (
    reference &&
    typeof point.lat === 'number' &&
    typeof point.lng === 'number' &&
    typeof reference.lat === 'number' &&
    typeof reference.lng === 'number'
  ) {
    return haversineMeters(reference.lat, reference.lng, point.lat, point.lng) >= config.writeGateMinMetres;
  }
  return false;
}

function journeyDistanceKm(points) {
  if (!Array.isArray(points) || points.length < 2) return 0;
  let meters = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    meters += haversineMeters(a.lat, a.lng, b.lat, b.lng);
  }
  return meters / 1000;
}

function normalizePoint(point) {
  return {
    lat: point.lat,
    lng: point.lng,
    speedKmh: point.speedKmh ?? null,
    accuracySource: point.accuracySource ?? null,
    recordedAt: point.recordedAt || new Date(),
  };
}

function shouldAcceptJourneyPoint(point, reference) {
  if (!isPlausibleCoord(point.lat, point.lng)) return false;
  if (
    reference &&
    typeof reference.lat === 'number' &&
    typeof reference.lng === 'number'
  ) {
    const hop = haversineMeters(reference.lat, reference.lng, point.lat, point.lng);
    if (hop > MAX_JOURNEY_SEGMENT_METRES) return false;
  }
  return true;
}

function startJourney(state, point, now) {
  const normalized = normalizePoint(point);
  state.currentJourney = {
    startAt: normalized.recordedAt,
    lastMovementAt: now,
    lastPointAt: now,
    points: [normalized],
    events: [],
  };
}

function addJourneyPoint(state, point, now) {
  const journey = state.currentJourney;
  if (!journey) return;

  const normalized = normalizePoint(point);
  const last = journey.points[journey.points.length - 1];
  if (!shouldAcceptJourneyPoint(normalized, last)) return;

  journey.points.push(normalized);
  journey.lastPointAt = now;

  if (isMoving(normalized, last)) {
    journey.lastMovementAt = now;
  }
}

function shouldCloseForIdle(journey, now) {
  if (!journey) return false;
  const idleMs = config.journeyIdleMinutes * 60 * 1000;
  return now.getTime() - new Date(journey.lastMovementAt).getTime() >= idleMs;
}

/**
 * Build a Firestore journey document from in-memory state.
 * @returns {object|null}
 */
function buildJourneyDoc(state, endAt, reason, extraEvent = null) {
  const journey = state.currentJourney;
  if (!journey || journey.points.length < 2) {
    state.currentJourney = null;
    return null;
  }

  const events = [...journey.events];
  if (extraEvent) events.push(extraEvent);

  const doc = {
    startAt: journey.startAt,
    endAt,
    distanceKm: Math.round(journeyDistanceKm(journey.points) * 1000) / 1000,
    polyline: encodePolyline(journey.points),
    events,
    pointCount: journey.points.length,
    compressed: true,
    closeReason: reason,
  };

  state.currentJourney = null;
  return doc;
}

function closeJourney(state, now, reason, extraEvent = null) {
  return buildJourneyDoc(state, now, reason, extraEvent);
}

function forceCloseJourney(state, now, reason = 'disconnect') {
  const journey = state.currentJourney;
  if (!journey) return null;
  if (journey.points.length < 2) {
    state.currentJourney = null;
    return null;
  }
  return closeJourney(state, now, reason);
}

/**
 * Track a GPS fix and optionally return a closed journey to flush.
 * @returns {{ flush: object|null, started: boolean }}
 */
function trackJourneyPoint(state, point, now = new Date(), options = {}) {
  const { geofenceTransition, transitionType, geofenceName, geofenceId } = options;
  const flushes = [];

  if (state.currentJourney && !sameCalendarDay(state.currentJourney.startAt, now)) {
    const closed = closeJourney(state, now, 'daily_boundary');
    if (closed) flushes.push(closed);
  }

  if (geofenceTransition && transitionType === 'geofence_exit') {
    const exitEvent = {
      type: 'geofence_exit',
      geofenceId: geofenceId || null,
      name: geofenceName || null,
      at: point.recordedAt || now,
    };

    // A safe-zone exit is a departure, not the end of an outing.
    // Start immediately from the exit fix so a low-speed departure is not lost.
    if (!state.currentJourney) {
      const reference = state.lastPersistedLocation;
      if (shouldAcceptJourneyPoint(point, reference)) {
        startJourney(state, point, now);
        state.currentJourney.events.push(exitEvent);
        return { flushes, started: true };
      }
    } else {
      state.currentJourney.events.push(exitEvent);
    }
  }

  const reference = state.currentJourney
    ? state.currentJourney.points[state.currentJourney.points.length - 1]
    : state.lastPersistedLocation;

  const moving = isMoving(point, reference);

  if (state.currentJourney) {
    addJourneyPoint(state, point, now);

    if (shouldCloseForIdle(state.currentJourney, now)) {
      const closed = closeJourney(state, now, 'idle');
      if (closed) flushes.push(closed);
    }

    return { flushes, started: false };
  }

  if (moving) {
    if (!shouldAcceptJourneyPoint(point, reference)) {
      return { flushes, started: false };
    }
    startJourney(state, point, now);
    return { flushes, started: true };
  }

  return { flushes, started: false };
}

function hasActiveJourney(state) {
  return Boolean(state.currentJourney);
}

module.exports = {
  trackJourneyPoint,
  closeJourney,
  forceCloseJourney,
  hasActiveJourney,
  journeyDistanceKm,
  isMoving,
  isPlausibleCoord,
  shouldAcceptJourneyPoint,
  sameCalendarDay,
};
