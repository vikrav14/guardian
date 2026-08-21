const { haversineMeters } = require('./geofence');

const MAX_POINTS_PER_REQUEST = 100;
const DEFAULT_TIMEOUT_MS = 10_000;

function trustedGpsEvidence(evidence = {}) {
  const source = String(evidence.source || '').trim().toLowerCase();
  return evidence.gpsValid === true || (source === 'gps' && evidence.gpsValid !== false);
}

function selectTrustedGpsPoints(points = [], pointEvidence = []) {
  if (!Array.isArray(points) || !Array.isArray(pointEvidence)) return [];
  if (points.length !== pointEvidence.length) return [];

  return points.flatMap((point, index) => {
    const evidence = pointEvidence[index] || {};
    if (!trustedGpsEvidence(evidence)) return [];
    return [{
      lat: Number(point.lat),
      lng: Number(point.lng),
      originalJourneyIndex: index,
      recordedAt: point.recordedAt || null,
      satellites: Number.isFinite(Number(evidence.satellites))
        ? Number(evidence.satellites)
        : null,
    }];
  }).filter((point) =>
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lng) &&
    Math.abs(point.lat) <= 90 &&
    Math.abs(point.lng) <= 180
  );
}

function chunkWithOverlap(points, size = MAX_POINTS_PER_REQUEST) {
  if (!Array.isArray(points) || points.length === 0) return [];
  if (!Number.isInteger(size) || size < 2) {
    throw new Error('Road-alignment chunk size must be at least 2.');
  }

  const chunks = [];
  let start = 0;
  while (start < points.length) {
    const end = Math.min(points.length, start + size);
    chunks.push({ start, points: points.slice(start, end) });
    if (end === points.length) break;
    start = end - 1;
  }
  return chunks;
}

function rounded(value, digits = 1) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function percentile(values, ratio) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.round((sorted.length - 1) * ratio))
  );
  return sorted[index];
}

function assessRoadAlignment(originalPoints, snappedPoints) {
  const corrections = [];
  const matchedOriginalIndexes = new Set();
  for (const snapped of snappedPoints || []) {
    if (!Number.isInteger(snapped.originalIndex)) continue;
    const original = originalPoints[snapped.originalIndex];
    if (!original) continue;
    corrections.push(
      haversineMeters(original.lat, original.lng, snapped.lat, snapped.lng)
    );
    matchedOriginalIndexes.add(snapped.originalIndex);
  }

  const adjacentDistances = [];
  for (let index = 1; index < originalPoints.length; index += 1) {
    const previous = originalPoints[index - 1];
    const current = originalPoints[index];
    adjacentDistances.push(
      haversineMeters(previous.lat, previous.lng, current.lat, current.lng)
    );
  }

  const coverage = originalPoints.length > 0
    ? matchedOriginalIndexes.size / originalPoints.length
    : 0;
  const medianCorrection = percentile(corrections, 0.5);
  const p95Correction = percentile(corrections, 0.95);
  const maxCorrection = corrections.length > 0 ? Math.max(...corrections) : null;
  const adjacentOver300 = adjacentDistances.filter((distance) => distance > 300).length;
  const sparseRatio = adjacentDistances.length > 0
    ? adjacentOver300 / adjacentDistances.length
    : 0;

  // These are Guardian display-safety thresholds, not claims made by Google.
  // A failed assessment keeps the result diagnostic-only.
  const eligible =
    originalPoints.length >= 2 &&
    coverage >= 0.9 &&
    medianCorrection != null &&
    medianCorrection <= 75 &&
    p95Correction != null &&
    p95Correction <= 150 &&
    sparseRatio <= 0.35;

  const warnings = [];
  if (coverage < 0.9) warnings.push('Google did not map at least 90% of GPS samples.');
  if (medianCorrection != null && medianCorrection > 75) {
    warnings.push('The median road correction is greater than 75 m.');
  }
  if (p95Correction != null && p95Correction > 150) {
    warnings.push('At least one of the largest corrections is greater than 150 m.');
  }
  if (sparseRatio > 0.35) {
    warnings.push('Too many adjacent GPS samples are more than 300 m apart.');
  }

  return {
    eligibleForDisplayExperiment: eligible,
    originalGpsPointCount: originalPoints.length,
    matchedGpsPointCount: matchedOriginalIndexes.size,
    coveragePercent: rounded(coverage * 100),
    medianCorrectionMeters: rounded(medianCorrection),
    p95CorrectionMeters: rounded(p95Correction),
    maxCorrectionMeters: rounded(maxCorrection),
    adjacentPairCount: adjacentDistances.length,
    adjacentPairsOver300Meters: adjacentOver300,
    maxAdjacentDistanceMeters: rounded(
      adjacentDistances.length > 0 ? Math.max(...adjacentDistances) : null
    ),
    warnings,
  };
}

async function snapJourneyToRoads(
  points,
  { apiKey, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}
) {
  if (!String(apiKey || '').trim()) {
    throw new Error('GOOGLE_ROADS_API_KEY is required for the read-only experiment.');
  }
  if (!Array.isArray(points) || points.length < 2) {
    throw new Error('At least two trusted GPS points are required.');
  }

  const output = [];
  for (const chunk of chunkWithOverlap(points)) {
    const path = chunk.points
      .map((point) => `${point.lat},${point.lng}`)
      .join('|');
    const params = new URLSearchParams({
      path,
      interpolate: 'true',
      key: apiKey,
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(
        `https://roads.googleapis.com/v1/snapToRoads?${params}`,
        { signal: controller.signal }
      );
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error(`Google Roads request timed out after ${timeoutMs} ms.`);
      }
      throw new Error(`Google Roads request failed: ${error?.message || error}`);
    } finally {
      clearTimeout(timer);
    }

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = String(body?.error?.message || `HTTP ${response.status}`)
        .replaceAll(apiKey, '[redacted]');
      throw new Error(`Google Roads rejected the request: ${message}`);
    }

    const snapped = Array.isArray(body.snappedPoints) ? body.snappedPoints : [];
    for (let index = 0; index < snapped.length; index += 1) {
      const item = snapped[index];
      const lat = Number(item?.location?.latitude);
      const lng = Number(item?.location?.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

      const originalIndex = Number.isInteger(item.originalIndex)
        ? chunk.start + item.originalIndex
        : null;
      const candidate = {
        lat,
        lng,
        placeId: item.placeId || null,
        originalIndex,
        interpolated: originalIndex == null,
      };

      const previous = output[output.length - 1];
      const duplicateOverlap =
        index === 0 &&
        chunk.start > 0 &&
        previous &&
        Math.abs(previous.lat - candidate.lat) < 1e-9 &&
        Math.abs(previous.lng - candidate.lng) < 1e-9;
      if (!duplicateOverlap) output.push(candidate);
    }
  }

  if (output.length < 2) {
    throw new Error('Google Roads returned fewer than two usable road points.');
  }
  return output;
}

module.exports = {
  MAX_POINTS_PER_REQUEST,
  assessRoadAlignment,
  chunkWithOverlap,
  selectTrustedGpsPoints,
  snapJourneyToRoads,
  trustedGpsEvidence,
};
