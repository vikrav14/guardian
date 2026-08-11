const { encodePolyline } = require('./polyline');
const { haversineMeters } = require('./geofence');
const config = require('./config');

const STATIONARY_SPEED_KMH = 1;
const MAX_JOURNEY_SEGMENT_METRES = 5000;
const RETURN_CONFIRM_MS = 2 * 60 * 1000;

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

function recordedAtOrNow(point, now) {
  const value = point.recordedAt ? new Date(point.recordedAt) : new Date(now);
  return Number.isNaN(value.getTime()) ? new Date(now) : value;
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
    originGeofenceId: null,
    originGeofenceName: null,
    returnCandidateAt: null,
  };
}

function addJourneyPoint(state, point, now) {
  const journey = state.currentJourney;
  if (!journey) return false;

  const normalized = normalizePoint(point);
  const last = journey.points[journey.points.length - 1];
  const normalizedAt = recordedAtOrNow(normalized, now);
  const lastAt = recordedAtOrNow(last, now);

  // Duplicate and out-of-order fixes must never mutate an outing. Besides
  // keeping the polyline clean, this prevents an old packet from moving a
  // journey's clock backwards and later overlapping another journey.
  if (normalizedAt.getTime() <= lastAt.getTime()) return false;
  if (!shouldAcceptJourneyPoint(normalized, last)) return false;

  journey.points.push(normalized);
  journey.lastPointAt = now;

  if (isMoving(normalized, last)) {
    journey.lastMovementAt = now;
  }

  return true;
}

function shouldCloseForIdle(journey, now) {
  if (!journey) return false;

  // Once an outing has a safe-zone origin, idle periods away from home are
  // stops inside that outing, not trip boundaries. A destination-dwell policy
  // can close one-way outings later; the generic idle fallback must not split
  // Home -> stop -> Home into multiple journeys.
  if (journey.originGeofenceId) return false;

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

  const startAt = new Date(journey.startAt);
  const normalizedEndAt = new Date(endAt);
  if (
    Number.isNaN(startAt.getTime()) ||
    Number.isNaN(normalizedEndAt.getTime()) ||
    normalizedEndAt.getTime() < startAt.getTime()
  ) {
    state.currentJourney = null;
    return null;
  }

  const events = [...journey.events];
  if (extraEvent) events.push(extraEvent);

  const doc = {
    startAt: journey.startAt,
    endAt: normalizedEndAt,
    distanceKm: Math.round(journeyDistanceKm(journey.points) * 1000) / 1000,
    polyline: encodePolyline(journey.points),
    events,
    pointCount: journey.points.length,
    compressed: true,
    closeReason: reason,
    ...(journey.originGeofenceId
      ? {
          originGeofenceId: journey.originGeofenceId,
          originGeofenceName: journey.originGeofenceName || null,
        }
      : {}),
  };

  state.currentJourney = null;
  state.lastJourneyEndAt = normalizedEndAt;
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

function assignOriginFromExit(journey, geofenceId, geofenceName) {
  if (!journey || journey.originGeofenceId || !geofenceId) return;
  journey.originGeofenceId = geofenceId;
  journey.originGeofenceName = geofenceName || null;
}

function isOriginTransition(journey, geofenceId) {
  return Boolean(
    journey &&
      journey.originGeofenceId &&
      geofenceId &&
      journey.originGeofenceId === geofenceId
  );
}

/**
 * Track a GPS fix and optionally return a closed journey to flush.
 * @returns {{ flushes: object[], started: boolean }}
 */
function trackJourneyPoint(state, point, now = new Date(), options = {}) {
  const { geofenceTransition, transitionType, geofenceName, geofenceId } = options;
  const flushes = [];
  const pointAt = recordedAtOrNow(point, now);

  if (state.currentJourney) {
    const lastPoint =
      state.currentJourney.points[state.currentJourney.points.length - 1];
    const lastPointAt = recordedAtOrNow(lastPoint, now);

    if (pointAt.getTime() <= lastPointAt.getTime()) {
      return { flushes, started: false };
    }
  } else if (state.lastJourneyEndAt) {
    const lastJourneyEndAt = new Date(state.lastJourneyEndAt);
    if (
      !Number.isNaN(lastJourneyEndAt.getTime()) &&
      pointAt.getTime() <= lastJourneyEndAt.getTime()
    ) {
      return { flushes, started: false };
    }
  }

  if (state.currentJourney && !sameCalendarDay(state.currentJourney.startAt, pointAt)) {
    const lastPoint =
      state.currentJourney.points[state.currentJourney.points.length - 1];
    const boundaryEndAt = recordedAtOrNow(lastPoint, now);
    const closed = closeJourney(state, boundaryEndAt, 'daily_boundary');
    if (closed) flushes.push(closed);
  }

  if (geofenceTransition && transitionType === 'geofence_exit') {
    const exitEvent = {
      type: 'geofence_exit',
      geofenceId: geofenceId || null,
      name: geofenceName || null,
      at: pointAt,
    };

    // A safe-zone exit is a departure, not the end of an outing.
    if (!state.currentJourney) {
      const reference = state.lastPersistedLocation;
      if (shouldAcceptJourneyPoint(point, reference)) {
        startJourney(state, point, now);
        assignOriginFromExit(state.currentJourney, geofenceId, geofenceName);
        state.currentJourney.events.push(exitEvent);
        return { flushes, started: true };
      }
    } else {
      assignOriginFromExit(state.currentJourney, geofenceId, geofenceName);

      // If the device only dipped back into the origin briefly and exits again
      // before confirmation, cancel the pending return and keep the outing open.
      if (isOriginTransition(state.currentJourney, geofenceId)) {
        state.currentJourney.returnCandidateAt = null;
      }

      state.currentJourney.events.push(exitEvent);
    }
  }

  if (
    geofenceTransition &&
    transitionType === 'geofence_enter' &&
    state.currentJourney
  ) {
    const journey = state.currentJourney;
    const enterEvent = {
      type: 'geofence_enter',
      geofenceId: geofenceId || null,
      name: geofenceName || null,
      at: pointAt,
    };

    journey.events.push(enterEvent);

    if (isOriginTransition(journey, geofenceId)) {
      // Keep the first inside-origin fix as the route endpoint, then wait for
      // another location sample before closing. This prevents a single noisy
      // boundary fix from ending the outing.
      addJourneyPoint(state, point, now);
      journey.returnCandidateAt = pointAt;
      return { flushes, started: false };
    }
  }

  if (state.currentJourney && state.currentJourney.returnCandidateAt) {
    const journey = state.currentJourney;
    const candidateAt = new Date(journey.returnCandidateAt);

    if (pointAt.getTime() - candidateAt.getTime() >= RETURN_CONFIRM_MS) {
      const closed = closeJourney(state, candidateAt, 'return_to_origin', {
        type: 'outing_return',
        geofenceId: journey.originGeofenceId,
        name: journey.originGeofenceName || null,
        at: candidateAt,
        confirmedAt: pointAt,
      });

      if (closed) flushes.push(closed);
      return { flushes, started: false };
    }

    // While confirmation is pending, do not append interior safe-zone jitter to
    // the route. An origin exit transition above will cancel this candidate.
    return { flushes, started: false };
  }

  const reference = state.currentJourney
    ? state.currentJourney.points[state.currentJourney.points.length - 1]
    : state.lastPersistedLocation;

  const moving = isMoving(point, reference);

  if (state.currentJourney) {
    addJourneyPoint(state, point, now);

    if (shouldCloseForIdle(state.currentJourney, now)) {
      const closed = closeJourney(state, pointAt, 'idle');
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
