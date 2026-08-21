const { haversineMeters } = require('./geofence');

const MAX_POINTS_PER_REQUEST = 100;
const DEFAULT_TIMEOUT_MS = 10_000;

function trustedGpsEvidence(evidence = {}) {
  const source = String(evidence.source || '').trim().toLowerCase();
  return evidence.gpsValid === true ||
    (source === 'gps' && evidence.gpsValid !== false);
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

function percentile(values, ratio) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.round((sorted.length - 1) * ratio))
  );
  return sorted[index];
}

function rounded(value, digits = 1) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
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
  const adjacentOver300 = adjacentDistances.filter((distance) => distance > 300).length;
  const sparseRatio = adjacentDistances.length > 0
    ? adjacentOver300 / adjacentDistances.length
    : 0;

  // Guardian accepts a Google-aligned blue section only when the correction
  // remains strongly grounded in the original GPS samples.
  return {
    eligibleForDisplay:
      originalPoints.length >= 2 &&
      coverage >= 0.9 &&
      medianCorrection != null &&
      medianCorrection <= 75 &&
      p95Correction != null &&
      p95Correction <= 150 &&
      sparseRatio <= 0.35,
    coveragePercent: rounded(coverage * 100),
    medianCorrectionMeters: rounded(medianCorrection),
    p95CorrectionMeters: rounded(p95Correction),
    adjacentPairsOver300Meters: adjacentOver300,
  };
}

async function snapJourneyToRoads(
  points,
  { apiKey, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}
) {
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('GOOGLE_ROADS_API_KEY is required.');
  if (!Array.isArray(points) || points.length < 2) {
    throw new Error('At least two trusted GPS points are required.');
  }

  const output = [];
  for (const chunk of chunkWithOverlap(points)) {
    const params = new URLSearchParams({
      path: chunk.points.map((point) => `${point.lat},${point.lng}`).join('|'),
      interpolate: 'true',
      key,
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
        .replaceAll(key, '[redacted]');
      throw new Error(`Google Roads rejected the request: ${message}`);
    }

    for (const [index, item] of (body.snappedPoints || []).entries()) {
      const lat = Number(item?.location?.latitude);
      const lng = Number(item?.location?.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const originalIndex = Number.isInteger(item.originalIndex)
        ? chunk.start + item.originalIndex
        : null;
      const candidate = {
        lat,
        lng,
        originalIndex,
        interpolated: originalIndex == null,
      };
      const previous = output[output.length - 1];
      const duplicateOverlap = index === 0 && chunk.start > 0 && previous &&
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
