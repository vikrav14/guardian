'use strict';

const {
  normalizeLocationSource,
  selectLocationForDisplay,
} = require('./location-provenance');
const {
  classifySosLocation,
  hasTrustworthyCoordinates,
  toDate,
} = require('./sos-location-policy');

const FALL_LOCATION_SNAPSHOT_VERSION = 1;

function safeAccuracy(value) {
  if (value == null || value === '') return null;
  const accuracy = Number(value);
  return Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : null;
}

function copyLocation(location, source) {
  if (!hasTrustworthyCoordinates(location)) return null;

  const resolvedSource = normalizeLocationSource(source || location.source);
  return {
    lat: Number(location.lat),
    lng: Number(location.lng),
    altitude: Number.isFinite(Number(location.altitude))
      ? Number(location.altitude)
      : null,
    recordedAt: toDate(location.recordedAt) || null,
    placeLabel: String(location.placeLabel || '').trim() || null,
    source: resolvedSource,
    gpsValid: resolvedSource === 'gps' || location.gpsValid === true,
    accuracyMeters: resolvedSource === 'gps'
      ? null
      : safeAccuracy(location.accuracyMeters),
  };
}

/**
 * Freeze the location Guardian selected when the fall occurred. Later device
 * observations may update devices/{imei}, but they must never rewrite this
 * event-specific evidence.
 */
function buildFallLocationSnapshot(device = {}, { now = new Date() } = {}) {
  const capturedAt = toDate(now) || new Date();
  const selection = selectLocationForDisplay(device);
  const location = copyLocation(selection.location, selection.source);
  const decision = classifySosLocation({
    device: { location },
    now: capturedAt,
  });

  return {
    version: FALL_LOCATION_SNAPSHOT_VERSION,
    capturedAt,
    state: decision.state,
    reason: decision.reason,
    ageSeconds: decision.ageSeconds,
    retainedSatellite: Boolean(selection.retainedSatellite),
    location,
  };
}

function readFallLocationSnapshot(alert = {}) {
  const snapshot = alert?.payload?.locationSnapshot;
  if (
    !snapshot ||
    Number(snapshot.version) !== FALL_LOCATION_SNAPSHOT_VERSION ||
    !['fresh', 'last_known', 'unavailable'].includes(snapshot.state)
  ) {
    return null;
  }
  return snapshot;
}

function withFallLocationSnapshot(
  alarmType,
  payload = {},
  device = {},
  { now = new Date() } = {}
) {
  if (String(alarmType || '').trim().toLowerCase() !== 'fall') {
    return payload;
  }
  return {
    ...payload,
    locationSnapshot: buildFallLocationSnapshot(device, { now }),
  };
}

/**
 * Build the device view used by fall copy. Missing legacy snapshots fail
 * closed to unavailable instead of borrowing a location observed later.
 */
function deviceAtFall(device = {}, alert = {}) {
  const snapshot = readFallLocationSnapshot(alert);
  const location = snapshot?.state === 'unavailable'
    ? null
    : copyLocation(snapshot?.location, snapshot?.location?.source);

  return {
    ...device,
    location,
    accuracySource: location?.source || null,
  };
}

module.exports = {
  FALL_LOCATION_SNAPSHOT_VERSION,
  buildFallLocationSnapshot,
  readFallLocationSnapshot,
  withFallLocationSnapshot,
  deviceAtFall,
};
