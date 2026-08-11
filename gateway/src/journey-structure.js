const { haversineMeters } = require('./geofence');

const DEFAULT_STOP_MIN_MINUTES = 3;
const DEFAULT_STOP_RADIUS_METRES = 80;
const STATIONARY_SPEED_KMH = 1;

function asDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function roundedMinutes(ms) {
  return Math.round((ms / 60_000) * 10) / 10;
}

function roundedKm(meters) {
  return Math.round((meters / 1000) * 1000) / 1000;
}

function pointDistanceMeters(a, b) {
  if (!a || !b) return 0;
  return haversineMeters(a.lat, a.lng, b.lat, b.lng);
}

function pathDistanceMeters(points, startIndex, endIndex) {
  let meters = 0;
  for (let i = startIndex + 1; i <= endIndex; i += 1) {
    meters += pointDistanceMeters(points[i - 1], points[i]);
  }
  return meters;
}

function isStationaryCandidate(point) {
  if (point.speedKmh == null) return true;
  const speed = Number(point.speedKmh);
  return Number.isFinite(speed) && speed < STATIONARY_SPEED_KMH;
}

function averageCoordinate(points, startIndex, endIndex, key) {
  let total = 0;
  let count = 0;

  for (let i = startIndex; i <= endIndex; i += 1) {
    const value = Number(points[i]?.[key]);
    if (!Number.isFinite(value)) continue;
    total += value;
    count += 1;
  }

  return count > 0 ? total / count : null;
}

function makeStop(points, startIndex, endIndex, ordinal) {
  const startAt = asDate(points[startIndex].recordedAt);
  const endAt = asDate(points[endIndex].recordedAt);

  return {
    id: `stop_${ordinal}`,
    startAt,
    endAt,
    durationMinutes: roundedMinutes(endAt.getTime() - startAt.getTime()),
    centerLat: averageCoordinate(points, startIndex, endIndex, 'lat'),
    centerLng: averageCoordinate(points, startIndex, endIndex, 'lng'),
    pointStartIndex: startIndex,
    pointEndIndex: endIndex,
    placeName: null,
    source: 'gps_dwell',
  };
}

function detectStops(points, options = {}) {
  if (!Array.isArray(points) || points.length < 2) return [];

  const minStopMinutes =
    Number(options.minStopMinutes) > 0
      ? Number(options.minStopMinutes)
      : DEFAULT_STOP_MIN_MINUTES;
  const radiusMetres =
    Number(options.radiusMetres) > 0
      ? Number(options.radiusMetres)
      : DEFAULT_STOP_RADIUS_METRES;
  const minStopMs = minStopMinutes * 60_000;

  const stops = [];
  let i = 0;

  while (i < points.length - 1) {
    const startPoint = points[i];
    const startAt = asDate(startPoint.recordedAt);

    if (!startAt || !isStationaryCandidate(startPoint)) {
      i += 1;
      continue;
    }

    let endIndex = i;
    for (let j = i + 1; j < points.length; j += 1) {
      const candidate = points[j];
      const candidateAt = asDate(candidate.recordedAt);

      if (!candidateAt || !isStationaryCandidate(candidate)) break;
      if (pointDistanceMeters(startPoint, candidate) > radiusMetres) break;

      endIndex = j;
    }

    if (endIndex > i) {
      const endAt = asDate(points[endIndex].recordedAt);
      if (endAt && endAt.getTime() - startAt.getTime() >= minStopMs) {
        stops.push(makeStop(points, i, endIndex, stops.length + 1));
        i = endIndex + 1;
        continue;
      }
    }

    i += 1;
  }

  return stops;
}

function makeLeg(points, startIndex, endIndex, ordinal, fromStopId, toStopId) {
  const startAt = asDate(points[startIndex].recordedAt);
  const endAt = asDate(points[endIndex].recordedAt);

  return {
    id: `leg_${ordinal}`,
    startAt,
    endAt,
    durationMinutes: roundedMinutes(endAt.getTime() - startAt.getTime()),
    distanceKm: roundedKm(pathDistanceMeters(points, startIndex, endIndex)),
    pointStartIndex: startIndex,
    pointEndIndex: endIndex,
    fromStopId: fromStopId || null,
    toStopId: toStopId || null,
  };
}

function deriveLegs(points, stops) {
  if (!Array.isArray(points) || points.length < 2) return [];

  const legs = [];
  let startIndex = 0;
  let previousStopId = null;

  for (const stop of stops) {
    if (stop.pointStartIndex > startIndex) {
      legs.push(
        makeLeg(
          points,
          startIndex,
          stop.pointStartIndex,
          legs.length + 1,
          previousStopId,
          stop.id
        )
      );
    }

    startIndex = stop.pointEndIndex;
    previousStopId = stop.id;
  }

  const finalIndex = points.length - 1;
  if (finalIndex > startIndex) {
    legs.push(
      makeLeg(
        points,
        startIndex,
        finalIndex,
        legs.length + 1,
        previousStopId,
        null
      )
    );
  }

  if (stops.length === 0 && legs.length === 0 && points.length >= 2) {
    legs.push(makeLeg(points, 0, finalIndex, 1, null, null));
  }

  return legs;
}

function deriveJourneyStructure(points, options = {}) {
  const stops = detectStops(points, options);
  const legs = deriveLegs(points, stops);

  return {
    stops,
    legs,
    stopCount: stops.length,
    legCount: legs.length,
  };
}

module.exports = {
  DEFAULT_STOP_MIN_MINUTES,
  DEFAULT_STOP_RADIUS_METRES,
  detectStops,
  deriveLegs,
  deriveJourneyStructure,
};
