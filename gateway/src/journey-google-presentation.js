'use strict';

const { decodePolyline, encodePolyline } = require('./polyline');
const {
  assessRoadAlignment,
  selectTrustedGpsPoints,
  snapJourneyToRoads,
} = require('./journey-road-alignment');
const {
  estimateRouteGaps,
  findEstimatedRouteGaps,
  partitionGpsSegments,
} = require('./journey-route-estimation');
const { findNearbyLandmark } = require('./geolocate/nearby-place');

const PRESENTATION_VERSION = 1;
// Firestore TTL deletion can lag. Twenty-eight days leaves a safe margin under
// Google Maps Platform's 30-day cache ceiling.
const PRESENTATION_TTL_MS = 28 * 24 * 60 * 60 * 1000;

function asDate(value) {
  const candidate = value?.toDate?.() ?? (value instanceof Date ? value : new Date(value));
  return candidate instanceof Date && !Number.isNaN(candidate.getTime())
    ? candidate
    : null;
}

function journeyPoints(journey) {
  const coordinates = decodePolyline(journey?.polyline);
  const evidence = Array.isArray(journey?.pointEvidence)
    ? journey.pointEvidence
    : [];
  const startAt = asDate(journey?.startAt);
  if (!startAt || coordinates.length < 2 || coordinates.length !== evidence.length) {
    return [];
  }

  return coordinates.map((point, index) => ({
    lat: point.lat,
    lng: point.lng,
    originalJourneyIndex: index,
    recordedAt: new Date(
      startAt.getTime() + Number(evidence[index]?.offsetMs || 0)
    ).toISOString(),
    source: evidence[index]?.source || evidence[index]?.accuracySource || null,
    gpsValid: evidence[index]?.gpsValid,
    accuracyMeters: Number.isFinite(Number(evidence[index]?.accuracyMeters))
      ? Number(evidence[index].accuracyMeters)
      : null,
  }));
}

function offsetForPoint(journey, point) {
  const index = Number(point?.originalJourneyIndex);
  const evidence = Array.isArray(journey?.pointEvidence)
    ? journey.pointEvidence
    : [];
  return Number.isInteger(index) && Number.isFinite(Number(evidence[index]?.offsetMs))
    ? Math.max(0, Number(evidence[index].offsetMs))
    : 0;
}

function gpsSegment(journey, points, displayPoints, roadAligned) {
  if (!Array.isArray(points) || points.length < 2 || displayPoints.length < 2) {
    return null;
  }
  const from = points[0];
  const to = points[points.length - 1];
  return {
    source: 'gps',
    polyline: encodePolyline(displayPoints),
    fromPointIndex: from.originalJourneyIndex,
    toPointIndex: to.originalJourneyIndex,
    fromOffsetMs: offsetForPoint(journey, from),
    toOffsetMs: offsetForPoint(journey, to),
    roadAligned,
  };
}

async function buildGpsSegments(
  journey,
  sections,
  { roadsApiKey, fetchImpl = fetch } = {}
) {
  const output = [];
  for (const points of sections || []) {
    if (points.length < 2) continue;
    let displayPoints = points;
    let roadAligned = false;
    if (roadsApiKey) {
      try {
        const snapped = await snapJourneyToRoads(points, {
          apiKey: roadsApiKey,
          fetchImpl,
        });
        const assessment = assessRoadAlignment(points, snapped);
        if (assessment.eligibleForDisplay) {
          displayPoints = snapped;
          roadAligned = true;
        }
      } catch (_) {
        // Raw GPS remains the safe display fallback for this section.
      }
    }
    const segment = gpsSegment(journey, points, displayPoints, roadAligned);
    if (segment) output.push(segment);
  }
  return output;
}

function googleSegment(journey, estimate) {
  const selected = estimate?.selected?.candidate;
  const gap = estimate?.gap;
  if (!estimate?.accepted || !selected || !gap) return null;
  const polyline = selected.encodedPolyline || encodePolyline(selected.points || []);
  if (!polyline) return null;
  return {
    source: 'google',
    polyline,
    fromPointIndex: gap.from.originalJourneyIndex,
    toPointIndex: gap.to.originalJourneyIndex,
    fromOffsetMs: offsetForPoint(journey, gap.from),
    toOffsetMs: offsetForPoint(journey, gap.to),
    confidence: estimate.confidence,
    supportedByApproximateObservations:
      Array.isArray(gap.approximatePoints) && gap.approximatePoints.length > 0,
  };
}

async function buildStopPlaces(
  stops,
  { placesApiKey, fetchImpl = fetch } = {}
) {
  if (!placesApiKey || !Array.isArray(stops)) return [];
  const output = [];
  for (const stop of stops) {
    const lat = Number(stop?.centerLat);
    const lng = Number(stop?.centerLng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    try {
      const place = await findNearbyLandmark(lat, lng, {
        apiKey: placesApiKey,
        fetchImpl,
        areaName: stop.placeName,
      });
      if (!place?.label) continue;
      output.push({
        stopId: stop.id,
        pointStartIndex: stop.pointStartIndex,
        pointEndIndex: stop.pointEndIndex,
        ...place,
      });
    } catch (_) {
      // Area-only reverse-geocoded labels remain available on the raw journey.
    }
  }
  return output;
}

async function buildJourneyGooglePresentation(
  journey,
  {
    roadsApiKey,
    routesApiKey,
    placesApiKey,
    fetchImpl = fetch,
    now = new Date(),
  } = {}
) {
  const points = journeyPoints(journey);
  if (points.length < 2) return null;
  const gpsPoints = selectTrustedGpsPoints(points, journey.pointEvidence);
  if (gpsPoints.length < 2 && !placesApiKey) return null;

  const gaps = findEstimatedRouteGaps(gpsPoints, points);
  const gpsSections = partitionGpsSegments(gpsPoints, gaps);
  const [gpsSegments, estimatedGaps, stopPlaces] = await Promise.all([
    buildGpsSegments(journey, gpsSections, { roadsApiKey, fetchImpl }),
    routesApiKey
      ? estimateRouteGaps(gaps, { apiKey: routesApiKey, fetchImpl })
      : Promise.resolve([]),
    buildStopPlaces(journey.stops, { placesApiKey, fetchImpl }),
  ]);

  const googleSegments = estimatedGaps
    .map((estimate) => googleSegment(journey, estimate))
    .filter(Boolean);
  const unresolvedIntervals = estimatedGaps
    .filter((estimate) => !estimate.accepted)
    .map((estimate) => ({
      id: estimate.gap?.id || null,
      fromPointIndex: estimate.gap?.from?.originalJourneyIndex ?? null,
      toPointIndex: estimate.gap?.to?.originalJourneyIndex ?? null,
      reason: estimate.reason || 'unresolved',
      attempts: estimate.attempts || 1,
    }));
  const segments = [...gpsSegments, ...googleSegments]
    .sort((left, right) => left.fromOffsetMs - right.fromOffsetMs);
  if (segments.length === 0 && stopPlaces.length === 0) return null;

  const generatedAt = asDate(now) || new Date();
  return {
    version: PRESENTATION_VERSION,
    journeyStartAt: asDate(journey.startAt),
    generatedAt,
    expiresAt: new Date(generatedAt.getTime() + PRESENTATION_TTL_MS),
    attribution: 'Google Maps',
    segments,
    stopPlaces,
    coverage: {
      gpsSegmentCount: gpsSegments.length,
      googleSegmentCount: googleSegments.length,
      unresolvedIntervalCount: Math.max(0, gaps.length - googleSegments.length),
      unresolvedIntervals,
    },
  };
}

module.exports = {
  PRESENTATION_TTL_MS,
  PRESENTATION_VERSION,
  buildGpsSegments,
  buildJourneyGooglePresentation,
  buildStopPlaces,
  journeyPoints,
};
