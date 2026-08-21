const { haversineMeters } = require('./geofence');
const { decodePolyline } = require('./polyline');

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RECORDED_PAIR_METRES = 300;
const DEFAULT_MAX_RECORDED_INTERVAL_SECONDS = 120;

function asTimeMs(value) {
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

function rounded(value, digits = 1) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function median(values) {
  const finite = (values || []).filter(Number.isFinite).sort((a, b) => a - b);
  if (finite.length === 0) return null;
  const middle = Math.floor(finite.length / 2);
  return finite.length % 2 === 0
    ? (finite[middle - 1] + finite[middle]) / 2
    : finite[middle];
}

function isApproximateObservation(point = {}) {
  const source = String(point.source || point.accuracySource || '')
    .trim()
    .toLowerCase();
  return source === 'wifi' || source === 'lbs' || point.gpsValid === false;
}

function findEstimatedRouteGaps(
  gpsPoints,
  allPoints,
  {
    maxRecordedPairMetres = DEFAULT_MAX_RECORDED_PAIR_METRES,
    maxRecordedIntervalSeconds = DEFAULT_MAX_RECORDED_INTERVAL_SECONDS,
  } = {}
) {
  if (!Array.isArray(gpsPoints) || gpsPoints.length < 2) return [];
  const evidencePoints = Array.isArray(allPoints) ? allPoints : [];
  const gaps = [];

  for (let index = 0; index < gpsPoints.length - 1; index += 1) {
    const from = gpsPoints[index];
    const to = gpsPoints[index + 1];
    const directDistanceMeters = haversineMeters(
      from.lat,
      from.lng,
      to.lat,
      to.lng
    );
    const fromMs = asTimeMs(from.recordedAt);
    const toMs = asTimeMs(to.recordedAt);
    const durationSeconds = fromMs != null && toMs != null && toMs >= fromMs
      ? Math.round((toMs - fromMs) / 1000)
      : null;
    const fromJourneyIndex = Number(from.originalJourneyIndex);
    const toJourneyIndex = Number(to.originalJourneyIndex);
    const between = Number.isInteger(fromJourneyIndex) && Number.isInteger(toJourneyIndex)
      ? evidencePoints.slice(fromJourneyIndex + 1, toJourneyIndex)
      : [];
    const approximatePoints = between.filter(isApproximateObservation);
    const reasons = [];
    if (directDistanceMeters > maxRecordedPairMetres) reasons.push('spatially_sparse');
    if (durationSeconds != null && durationSeconds > maxRecordedIntervalSeconds) {
      reasons.push('temporally_sparse');
    }
    if (approximatePoints.length > 0 && reasons.length > 0) {
      reasons.push('approximate_between_gps');
    }
    if (reasons.length === 0) continue;

    gaps.push({
      id: `gap-${index + 1}`,
      fromGpsIndex: index,
      toGpsIndex: index + 1,
      from,
      to,
      directDistanceMeters: rounded(directDistanceMeters),
      durationSeconds,
      approximatePoints,
      reasons,
    });
  }
  return gaps;
}

function partitionGpsSegments(gpsPoints, gaps) {
  if (!Array.isArray(gpsPoints) || gpsPoints.length === 0) return [];
  const breaks = new Set((gaps || []).map((gap) => gap.fromGpsIndex));
  const output = [];
  let start = 0;
  for (let index = 0; index < gpsPoints.length - 1; index += 1) {
    if (!breaks.has(index)) continue;
    output.push(gpsPoints.slice(start, index + 1));
    start = index + 1;
  }
  output.push(gpsPoints.slice(start));
  return output.filter((segment) => segment.length > 0);
}

function parseGoogleDurationSeconds(value) {
  const match = String(value || '').match(/^(\d+(?:\.\d+)?)s$/);
  return match ? Number(match[1]) : null;
}

function routeRequestBody(gap) {
  return {
    origin: {
      location: {
        latLng: { latitude: gap.from.lat, longitude: gap.from.lng },
      },
    },
    destination: {
      location: {
        latLng: { latitude: gap.to.lat, longitude: gap.to.lng },
      },
    },
    travelMode: 'DRIVE',
    routingPreference: 'TRAFFIC_UNAWARE',
    computeAlternativeRoutes: true,
    polylineQuality: 'HIGH_QUALITY',
    polylineEncoding: 'ENCODED_POLYLINE',
  };
}

async function fetchGoogleRouteCandidates(
  gap,
  { apiKey, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}
) {
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('A Google Routes API key is required.');
  if (!gap?.from || !gap?.to) {
    throw new Error('A route interval requires reliable start and end points.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(
      'https://routes.googleapis.com/directions/v2:computeRoutes',
      {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': key,
          'X-Goog-FieldMask': [
            'routes.duration',
            'routes.distanceMeters',
            'routes.polyline.encodedPolyline',
            'routes.routeLabels',
          ].join(','),
        },
        body: JSON.stringify(routeRequestBody(gap)),
      }
    );
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`Google Routes request timed out after ${timeoutMs} ms.`);
    }
    throw new Error(`Google Routes request failed: ${error?.message || error}`);
  } finally {
    clearTimeout(timer);
  }

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = String(body?.error?.message || `HTTP ${response.status}`)
      .replaceAll(key, '[redacted]');
    throw new Error(`Google Routes rejected the request: ${message}`);
  }

  return (Array.isArray(body.routes) ? body.routes : []).flatMap((route, index) => {
    const encodedPolyline = route?.polyline?.encodedPolyline;
    const points = decodePolyline(encodedPolyline);
    if (points.length < 2) return [];
    return [{
      candidateIndex: index,
      encodedPolyline,
      points,
      distanceMeters: Number.isFinite(Number(route.distanceMeters))
        ? Number(route.distanceMeters)
        : null,
      durationSeconds: parseGoogleDurationSeconds(route.duration),
      labels: Array.isArray(route.routeLabels) ? route.routeLabels : [],
      isDefault: Array.isArray(route.routeLabels)
        ? route.routeLabels.includes('DEFAULT_ROUTE')
        : index === 0,
    }];
  });
}

function nearestPathDistanceMeters(point, path) {
  if (!point || !Array.isArray(path) || path.length === 0) return null;
  return Math.min(...path.map((candidate) => haversineMeters(
    point.lat,
    point.lng,
    candidate.lat,
    candidate.lng
  )));
}

function candidateMetrics(gap, candidate) {
  const approximateDistances = gap.approximatePoints
    .map((point) => nearestPathDistanceMeters(point, candidate.points))
    .filter(Number.isFinite);
  const endpointDistances = [
    nearestPathDistanceMeters(gap.from, [candidate.points[0]]),
    nearestPathDistanceMeters(gap.to, [candidate.points[candidate.points.length - 1]]),
  ].filter(Number.isFinite);
  const directDistance = Number(gap.directDistanceMeters);
  const routeDistance = Number(candidate.distanceMeters);
  const duration = Number(candidate.durationSeconds);
  const available = Number(gap.durationSeconds);

  return {
    directDistanceMeters: rounded(directDistance),
    routeDistanceMeters: rounded(routeDistance),
    availableDurationSeconds: Number.isFinite(available)
      ? Math.round(available)
      : null,
    routeDurationSeconds: Number.isFinite(duration)
      ? Math.round(duration)
      : null,
    approximateMedianDistanceMeters: rounded(median(approximateDistances)),
    approximatePointCount: approximateDistances.length,
    endpointMaxCorrectionMeters: rounded(
      endpointDistances.length > 0 ? Math.max(...endpointDistances) : null
    ),
    detourRatio: directDistance > 0 && Number.isFinite(routeDistance)
      ? rounded(routeDistance / directDistance, 2)
      : null,
    durationOverrunSeconds: Number.isFinite(duration) && Number.isFinite(available)
      ? Math.max(0, Math.round(duration - available))
      : null,
  };
}

function selectLikelyGoogleRoute(gap, candidates) {
  const measured = (candidates || []).map((candidate) => {
    const metrics = candidateMetrics(gap, candidate);
    const available = Number(gap.durationSeconds);
    const routeDuration = Number(candidate.durationSeconds);
    const routeDistance = Number(candidate.distanceMeters);
    const directDistance = Number(gap.directDistanceMeters);
    const reasons = [];
    if (Number.isFinite(available) && Number.isFinite(routeDuration) &&
        routeDuration > Math.max(available * 2, available + 180)) {
      reasons.push('route_longer_than_recorded_time_allows');
    }
    if (Number.isFinite(directDistance) && Number.isFinite(routeDistance) &&
        routeDistance > Math.max(directDistance * 4, directDistance + 5000)) {
      reasons.push('route_is_an_extreme_detour');
    }
    if (metrics.endpointMaxCorrectionMeters != null &&
        metrics.endpointMaxCorrectionMeters > 500) {
      reasons.push('route_endpoints_are_too_far_from_gps');
    }
    if (metrics.approximateMedianDistanceMeters != null &&
        metrics.approximateMedianDistanceMeters > 2000) {
      reasons.push('route_conflicts_with_approximate_observations');
    }
    return {
      candidate,
      metrics,
      plausible: reasons.length === 0,
      reasons,
      score:
        (metrics.approximateMedianDistanceMeters ?? 500) +
        ((metrics.durationOverrunSeconds ?? 0) * 0.5) +
        ((metrics.detourRatio ?? 1) * 25) +
        (candidate.isDefault ? -15 : 0),
    };
  });

  const plausible = measured.filter((item) => item.plausible)
    .sort((left, right) => left.score - right.score);
  if (plausible.length === 0) {
    return {
      accepted: false,
      confidence: 'unresolved',
      selected: null,
      evaluated: measured,
      reason: measured.length === 0
        ? 'google_returned_no_route'
        : 'google_routes_failed_basic_sanity_checks',
    };
  }

  const selected = plausible[0];
  return {
    accepted: true,
    confidence: selected.metrics.approximatePointCount > 0 &&
      selected.metrics.approximateMedianDistanceMeters <= 500
      ? 'supported_estimate'
      : 'google_estimate',
    selected,
    evaluated: measured,
    reason: null,
  };
}

async function estimateRouteGaps(
  gaps,
  {
    apiKey,
    fetchImpl = fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxAttempts = 2,
  } = {}
) {
  const output = [];
  for (const gap of gaps || []) {
    const attemptLimit = Math.max(1, Number(maxAttempts) || 1);
    let lastError = null;
    let resolved = false;
    for (let attempt = 1; attempt <= attemptLimit; attempt += 1) {
      try {
        const candidates = await fetchGoogleRouteCandidates(gap, {
          apiKey,
          fetchImpl,
          timeoutMs,
        });
        output.push({
          gap,
          ...selectLikelyGoogleRoute(gap, candidates),
          error: null,
          attempts: attempt,
        });
        resolved = true;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!resolved) {
      output.push({
        gap,
        accepted: false,
        confidence: 'unresolved',
        selected: null,
        reason: 'google_routes_request_failed',
        error: apiKey
          ? String(lastError?.message || lastError).replaceAll(
              String(apiKey),
              '[redacted]'
            )
          : String(lastError?.message || lastError),
        attempts: attemptLimit,
      });
    }
  }
  return output;
}

module.exports = {
  DEFAULT_MAX_RECORDED_INTERVAL_SECONDS,
  DEFAULT_MAX_RECORDED_PAIR_METRES,
  estimateRouteGaps,
  fetchGoogleRouteCandidates,
  findEstimatedRouteGaps,
  isApproximateObservation,
  parseGoogleDurationSeconds,
  partitionGpsSegments,
  routeRequestBody,
  selectLikelyGoogleRoute,
};
