const { encodePolyline } = require('./polyline');
const { haversineMeters } = require('./geofence');
const config = require('./config');
const { deriveJourneyStructure } = require('./journey-structure');
const { isJourneyGps } = require('./journey-source-evidence');

const STATIONARY_SPEED_KMH = 1;
const MAX_JOURNEY_SEGMENT_METRES = 5000;
const RETURN_CONFIRM_MS = 2 * 60 * 1000;
const ROUTE_GAP_THRESHOLD_MS = 5 * 60 * 1000;
const DEPARTURE_ANCHOR_MAX_AGE_MS = ROUTE_GAP_THRESHOLD_MS;
const MAX_DIAGNOSTIC_EVENTS = 512;

function emptyObservationAudit() {
  return {
    approximatePacketsReceived: 0,
    approximateResolved: 0,
    approximateResolutionFailed: 0,
    approximateAccepted: 0,
    approximateRejected: 0,
  };
}

function noteJourneyObservation(state, outcome) {
  const journey = state?.currentJourney;
  if (!journey) return false;
  journey.observationAudit ||= emptyObservationAudit();
  if (!Object.prototype.hasOwnProperty.call(journey.observationAudit, outcome)) {
    return false;
  }
  journey.observationAudit[outcome] += 1;
  return true;
}

function noteJourneyDiagnosticEvent(state, type, at = new Date(), details = {}) {
  const journey = state?.currentJourney;
  const eventAt = new Date(at);
  const startAt = new Date(journey?.startAt);
  if (
    !journey ||
    !String(type || '').trim() ||
    Number.isNaN(eventAt.getTime()) ||
    Number.isNaN(startAt.getTime())
  ) {
    return false;
  }

  journey.diagnosticEvents ||= [];
  if (journey.diagnosticEvents.length >= MAX_DIAGNOSTIC_EVENTS) return false;
  journey.diagnosticEvents.push({
    type: String(type).trim(),
    offsetMs: Math.max(0, eventAt.getTime() - startAt.getTime()),
    details: Object.fromEntries(
      Object.entries(details || {}).filter(([, value]) => value !== undefined)
    ),
  });
  return true;
}

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
  // A changing Wi-Fi/LBS estimate is not movement evidence, even if its
  // packet carries a stale/nonzero speed. Nor can it serve as a GPS baseline.
  if (!isJourneyGps(point)) return false;
  if (point.speedKmh != null && Number(point.speedKmh) >= STATIONARY_SPEED_KMH) {
    return true;
  }
  if (
    isJourneyGps(reference) &&
    typeof point.lat === 'number' &&
    typeof point.lng === 'number' &&
    typeof reference.lat === 'number' &&
    typeof reference.lng === 'number'
  ) {
    return haversineMeters(reference.lat, reference.lng, point.lat, point.lng) >= config.writeGateMinMetres;
  }
  return false;
}

function journeyDistanceKm(points, { excludeTrackingGaps = false, gpsOnly = false } = {}) {
  if (!Array.isArray(points) || points.length < 2) return 0;
  let meters = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (gpsOnly && (!isJourneyGps(a) || !isJourneyGps(b))) continue;
    if (gpsOnly && (!isPlausibleCoord(a.lat, a.lng) || !isPlausibleCoord(b.lat, b.lng))) continue;
    if (excludeTrackingGaps) {
      const aAt = recordedAtOrNow(a, new Date(0));
      const bAt = recordedAtOrNow(b, aAt);
      const elapsedMs = bAt.getTime() - aAt.getTime();
      if (elapsedMs > ROUTE_GAP_THRESHOLD_MS || (gpsOnly && elapsedMs <= 0)) continue;
    }
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
    source: point.source ?? point.accuracySource ?? null,
    gpsValid: point.gpsValid === true,
    accuracyMeters:
      Number.isFinite(Number(point.accuracyMeters)) &&
      Number(point.accuracyMeters) > 0
        ? Number(point.accuracyMeters)
        : null,
    satellites:
      Number.isFinite(Number(point.satellites))
        ? Number(point.satellites)
        : null,
    recordedAt: point.recordedAt || new Date(),
  };
}

function buildRouteEvidence(points, journeyStartAt) {
  const startAt = new Date(journeyStartAt);
  const safeStartMs = Number.isNaN(startAt.getTime())
    ? recordedAtOrNow(points[0], new Date()).getTime()
    : startAt.getTime();
  const pointEvidence = [];
  const routeGaps = [];
  const routeSegments = [];
  let segmentStartIndex = 0;
  let gpsPointCount = 0;
  let approximatePointCount = 0;
  let unknownSourcePointCount = 0;

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const pointAt = recordedAtOrNow(point, new Date(safeStartMs));
    const source = String(point.source || point.accuracySource || '')
      .trim()
      .toLowerCase();
    const gpsValid =
      point.gpsValid === true ||
      (source === 'gps' && point.gpsValid !== false);

    if (gpsValid) gpsPointCount += 1;
    else if (source === 'wifi' || source === 'lbs') approximatePointCount += 1;
    else unknownSourcePointCount += 1;

    pointEvidence.push({
      offsetMs: Math.max(0, pointAt.getTime() - safeStartMs),
      source: source || null,
      gpsValid,
      accuracyMeters: point.accuracyMeters ?? null,
      satellites: point.satellites ?? null,
      speedKmh: point.speedKmh ?? null,
    });

    if (index === 0) continue;
    const previousAt = recordedAtOrNow(points[index - 1], pointAt);
    const gapMs = pointAt.getTime() - previousAt.getTime();
    if (gapMs > ROUTE_GAP_THRESHOLD_MS) {
      routeGaps.push({
        fromPointIndex: index - 1,
        toPointIndex: index,
        fromOffsetMs: Math.max(0, previousAt.getTime() - safeStartMs),
        toOffsetMs: Math.max(0, pointAt.getTime() - safeStartMs),
        durationSeconds: Math.round(gapMs / 1000),
      });
      const segmentPoints = points.slice(segmentStartIndex, index);
      routeSegments.push({
        startPointIndex: segmentStartIndex,
        endPointIndex: index - 1,
        pointCount: segmentPoints.length,
        distanceKm:
          Math.round(journeyDistanceKm(segmentPoints, { gpsOnly: true }) * 1000) / 1000,
        polyline: encodePolyline(segmentPoints),
      });
      segmentStartIndex = index;
    }
  }

  const finalSegmentPoints = points.slice(segmentStartIndex);
  routeSegments.push({
    startPointIndex: segmentStartIndex,
    endPointIndex: points.length - 1,
    pointCount: finalSegmentPoints.length,
    distanceKm:
      Math.round(journeyDistanceKm(finalSegmentPoints, { gpsOnly: true }) * 1000) / 1000,
    polyline: encodePolyline(finalSegmentPoints),
  });

  const largestGapSeconds = routeGaps.reduce(
    (largest, gap) => Math.max(largest, gap.durationSeconds),
    0
  );

  return {
    evidenceVersion: 3,
    pointEvidence,
    routeGaps,
    routeSegments,
    routeCoverage: {
      pointCount: points.length,
      gpsPointCount,
      approximatePointCount,
      unknownSourcePointCount,
      gapCount: routeGaps.length,
      largestGapSeconds,
      interrupted: routeGaps.length > 0,
      structureReliable: routeGaps.length === 0 && points.every(isJourneyGps),
    },
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

function gpsPointIsTrusted(point) {
  const source = String(point?.source || point?.accuracySource || '')
    .trim()
    .toLowerCase();
  return point?.gpsValid === true || (source === 'gps' && point?.gpsValid !== false);
}

function rememberConfirmedSafeZonePoint(
  state,
  point,
  now,
  insideSafeZoneIds = []
) {
  if (!gpsPointIsTrusted(point)) return false;

  const zoneIds = [...new Set((insideSafeZoneIds || []).filter(Boolean))];
  if (zoneIds.length === 0) return false;

  const normalized = normalizePoint(point);
  const pointAt = recordedAtOrNow(normalized, now);
  if (state.lastJourneyEndAt) {
    const lastJourneyEndAt = new Date(state.lastJourneyEndAt);
    if (
      !Number.isNaN(lastJourneyEndAt.getTime()) &&
      pointAt.getTime() <= lastJourneyEndAt.getTime()
    ) {
      return false;
    }
  }

  const previous = state.lastConfirmedSafeZonePoint;
  if (previous) {
    const previousAt = recordedAtOrNow(previous, new Date(0));
    if (pointAt.getTime() <= previousAt.getTime()) return false;
  }

  state.lastConfirmedSafeZonePoint = {
    ...normalized,
    geofenceIds: zoneIds,
  };
  return true;
}

function departureAnchorForExit(state, geofenceId, outsidePoint, now) {
  const anchor = state.lastConfirmedSafeZonePoint;
  if (!anchor || !geofenceId) return null;
  if (!Array.isArray(anchor.geofenceIds) || !anchor.geofenceIds.includes(geofenceId)) {
    return null;
  }

  const anchorAt = recordedAtOrNow(anchor, new Date(0));
  const outsideAt = recordedAtOrNow(outsidePoint, now);
  const ageMs = outsideAt.getTime() - anchorAt.getTime();
  if (ageMs < 0 || ageMs > DEPARTURE_ANCHOR_MAX_AGE_MS) return null;
  if (!shouldAcceptJourneyPoint(outsidePoint, anchor)) return null;
  return anchor;
}

function startJourney(state, point, now, { routeAnchor = null } = {}) {
  state.journeyResumeReference = null;
  const normalized = normalizePoint(point);
  const points = [];
  let routeStartEvidence = null;

  if (routeAnchor) {
    const normalizedAnchor = normalizePoint(routeAnchor);
    const anchorAt = recordedAtOrNow(normalizedAnchor, now);
    const pointAt = recordedAtOrNow(normalized, now);
    if (
      anchorAt.getTime() < pointAt.getTime() &&
      shouldAcceptJourneyPoint(normalized, normalizedAnchor)
    ) {
      points.push(normalizedAnchor);
      routeStartEvidence = {
        recordedAt: anchorAt,
        source: normalizedAnchor.source,
        gpsValid: normalizedAnchor.gpsValid,
        accuracyMeters: normalizedAnchor.accuracyMeters,
        satellites: normalizedAnchor.satellites,
        geofenceIds: [...(routeAnchor.geofenceIds || [])],
      };
    }
  }

  points.push(normalized);
  state.currentJourney = {
    startAt: points[0].recordedAt,
    departureAt: normalized.recordedAt,
    lastMovementAt: now,
    lastPointAt: now,
    points,
    events: [],
    originGeofenceId: null,
    originGeofenceName: null,
    departureEvidence: null,
    routeStartAnchored: routeStartEvidence != null,
    routeStartEvidence,
    returnEvidence: null,
    returnCandidateAt: null,
    observationAudit: emptyObservationAudit(),
    diagnosticEvents: [],
  };
}

function addJourneyPoint(state, point, now) {
  const journey = state.currentJourney;
  if (!journey) return false;

  const normalized = normalizePoint(point);
  const last = journey.points[journey.points.length - 1];
  const normalizedAt = recordedAtOrNow(normalized, now);
  const lastAt = recordedAtOrNow(last, now);
  const source = String(normalized.source || normalized.accuracySource || '')
    .trim()
    .toLowerCase();
  const approximate = source === 'wifi' || source === 'lbs';

  // Duplicate and out-of-order fixes must never mutate an outing. Besides
  // keeping the polyline clean, this prevents an old packet from moving a
  // journey's clock backwards and later overlapping another journey.
  if (normalizedAt.getTime() <= lastAt.getTime()) {
    if (approximate) noteJourneyObservation(state, 'approximateRejected');
    return false;
  }
  if (!shouldAcceptJourneyPoint(normalized, last)) {
    if (approximate) noteJourneyObservation(state, 'approximateRejected');
    return false;
  }

  journey.points.push(normalized);
  if (approximate) noteJourneyObservation(state, 'approximateAccepted');
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

  // Stops and legs are derived from the completed factual GPS path.
  // They enrich one outing; they never create additional journeys or infer purpose.
  const routeEvidence = buildRouteEvidence(journey.points, startAt);
  // Approximate clusters must not become alleged stops at nearby businesses.
  const structure = journey.points.every(isJourneyGps)
    ? deriveJourneyStructure(journey.points)
    : { stops: [], legs: [], stopCount: 0, legCount: 0 };

  const doc = {
    startAt: journey.startAt,
    endAt: normalizedEndAt,
    // Count only connected observed segments. The distance between the last
    // point before an upload gap and the first point after it is unknown.
    distanceKm:
      Math.round(
        journeyDistanceKm(journey.points, { excludeTrackingGaps: true, gpsOnly: true }) * 1000
      ) / 1000,
    polyline: encodePolyline(journey.points),
    events,
    pointCount: journey.points.length,
    stops: structure.stops,
    legs: structure.legs,
    stopCount: structure.stopCount,
    legCount: structure.legCount,
    compressed: true,
    closeReason: reason,
    observationAudit: {
      ...emptyObservationAudit(),
      ...(journey.observationAudit || {}),
    },
    diagnosticEvents: [...(journey.diagnosticEvents || [])],
    ...routeEvidence,
    ...(journey.originGeofenceId
      ? {
          originGeofenceId: journey.originGeofenceId,
          originGeofenceName: journey.originGeofenceName || null,
          departureAt: journey.departureAt || journey.startAt,
          returnAt: reason === 'return_to_origin' ? normalizedEndAt : null,
          departureEvidence: journey.departureEvidence || null,
          routeStartAnchored: journey.routeStartAnchored === true,
          routeStartEvidence: journey.routeStartEvidence || null,
          returnEvidence: journey.returnEvidence || null,
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

function assignOriginFromExit(
  journey,
  geofenceId,
  geofenceName,
  transitionEvidence = null,
  departureAt = null
) {
  if (!journey || journey.originGeofenceId || !geofenceId) return;
  journey.originGeofenceId = geofenceId;
  journey.originGeofenceName = geofenceName || null;
  journey.departureAt = departureAt || journey.departureAt;
  journey.departureEvidence = transitionEvidence || null;
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
  const {
    geofenceTransition,
    transitionType,
    geofenceName,
    geofenceId,
    transitionEvidence = null,
    hasActiveSafeZones = false,
    insideAnySafeZone = false,
    insideSafeZoneIds = [],
    hasUncertainSafeZones = false,
  } = options;
  const flushes = [];
  const pointAt = recordedAtOrNow(point, now);
  const satelliteObservation = isJourneyGps(point);

  // First GPS after Home starts a new movement baseline. Never compare it with
  // indoor GPS retained for diagnostics or join it to a pre-Home route anchor.
  if (state.journeyResumePending && satelliteObservation) {
    state.journeyResumePending = false;
    state.journeyResumeReference = normalizePoint(point);
  }
  const idleReference = state.journeyResumeReference || state.lastPersistedLocation;
  if (!state.currentJourney && state.journeyResumeReference && satelliteObservation) {
    state.journeyResumeReference = normalizePoint(point);
  }

  if (!state.currentJourney && !satelliteObservation) {
    return { flushes, started: false };
  }

  if (
    !state.currentJourney &&
    hasActiveSafeZones &&
    insideAnySafeZone &&
    !hasUncertainSafeZones
  ) {
    rememberConfirmedSafeZonePoint(
      state,
      point,
      now,
      insideSafeZoneIds
    );
  }

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

  if (satelliteObservation && geofenceTransition && transitionType === 'geofence_exit') {
    const exitEvent = {
      type: 'geofence_exit',
      geofenceId: geofenceId || null,
      name: geofenceName || null,
      at: pointAt,
      evidence: transitionEvidence || null,
    };

    // A safe-zone exit is a departure, not the end of an outing.
    if (!state.currentJourney) {
      const reference = idleReference;
      if (shouldAcceptJourneyPoint(point, reference)) {
        const routeAnchor = departureAnchorForExit(
          state,
          geofenceId,
          point,
          now
        );
        startJourney(state, point, now, { routeAnchor });
        assignOriginFromExit(
          state.currentJourney,
          geofenceId,
          geofenceName,
          transitionEvidence,
          pointAt
        );
        state.currentJourney.events.push(exitEvent);
        return { flushes, started: true };
      }
    } else {
      assignOriginFromExit(
        state.currentJourney,
        geofenceId,
        geofenceName,
        transitionEvidence,
        pointAt
      );

      // If the device only dipped back into the origin briefly and exits again
      // before confirmation, cancel the pending return and keep the outing open.
      if (isOriginTransition(state.currentJourney, geofenceId)) {
        state.currentJourney.returnCandidateAt = null;
      }

      state.currentJourney.events.push(exitEvent);
    }
  }

  if (
    satelliteObservation &&
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
      evidence: transitionEvidence || null,
    };

    journey.events.push(enterEvent);

    if (isOriginTransition(journey, geofenceId)) {
      // Keep the first inside-origin fix as the route endpoint, then wait for
      // another location sample before closing. This prevents a single noisy
      // boundary fix from ending the outing.
      addJourneyPoint(state, point, now);
      journey.returnCandidateAt = pointAt;
      journey.returnEvidence = transitionEvidence || null;
      return { flushes, started: false };
    }
  }

  if (state.currentJourney && state.currentJourney.returnCandidateAt) {
    const journey = state.currentJourney;
    const candidateAt = new Date(journey.returnCandidateAt);

    if (
      satelliteObservation && !hasUncertainSafeZones &&
      pointAt.getTime() - candidateAt.getTime() >= RETURN_CONFIRM_MS
    ) {
      const closed = closeJourney(state, candidateAt, 'return_to_origin', {
        type: 'outing_return',
        geofenceId: journey.originGeofenceId,
        name: journey.originGeofenceName || null,
        at: candidateAt,
        confirmedAt: pointAt,
        evidence: journey.returnEvidence || null,
      });

      rememberConfirmedSafeZonePoint(
        state,
        point,
        now,
        insideSafeZoneIds
      );
      if (closed) flushes.push(closed);
      return { flushes, started: false };
    }

    // While confirmation is pending, do not append interior safe-zone jitter to
    // the route. An origin exit transition above will cancel this candidate.
    return { flushes, started: false };
  }

  const reference = state.currentJourney
    ? state.currentJourney.points[state.currentJourney.points.length - 1]
    : idleReference;

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
    // While the watch is currently inside a configured safe zone, departure
    // semantics are authoritative: wait for geofence_exit rather than letting
    // GPS/WiFi/LBS drift manufacture an outing.
    //
    // If active zones exist but the watch is already outside all of them
    // (for example after a gateway restart away from Home), keep the generic
    // movement fallback so tracking is not disabled for the whole day.
    if (
      hasActiveSafeZones &&
      (insideAnySafeZone || hasUncertainSafeZones)
    ) {
      return { flushes, started: false };
    }

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
  buildRouteEvidence,
  noteJourneyObservation,
  noteJourneyDiagnosticEvent,
  ROUTE_GAP_THRESHOLD_MS,
  DEPARTURE_ANCHOR_MAX_AGE_MS,
};
