'use strict';

const { millis, validCoordinates, validHomeRadius, gpsHomeAgreement,
  deviceGpsFixes } = require('./wifi-home-gps-policy');

const POLICY = 'enrolled_home_radio_v3';
const SPATIAL_POLICY = 'enrolled_home_radio_v2';
const LEGACY_POLICY = 'enrolled_home_radio_v1';
const MAX_AGE_MS = 120_000;
const CONFLICT_REASONS = new Set(['gps_outside_home', 'gps_boundary_uncertain']);

function validAnchor(anchor) {
  return Boolean(anchor && typeof anchor.geofenceId === 'string' && anchor.geofenceId &&
    validCoordinates(anchor));
}

function evaluateHomeWifiDisplay(observation, binding, nowMs, gpsObservation = null) {
  const unavailable = reason => ({ value: null, reason });
  if (!binding?.ready) return unavailable(binding?.reason || 'awaiting_home_binding');
  if (!validAnchor(binding.anchor) || !validHomeRadius(binding.anchor.radiusMeters)) {
    return unavailable('home_pin_invalid');
  }
  if (!Number.isFinite(nowMs) || !Number.isFinite(binding.validUntilMs) || binding.validUntilMs <= nowMs) {
    return unavailable('home_binding_expired');
  }
  if (observation?.enabled !== true || observation?.configured !== true ||
      observation.matchState !== 'matched' || !Number.isInteger(observation.consecutiveMatches) ||
      observation.consecutiveMatches < 3) return unavailable(observation?.reason || 'awaiting_router_evidence');
  const observedAt = millis(observation.observedAt);
  const expiresAt = Math.min(millis(observation.expiresAt), binding.validUntilMs);
  if (!Number.isFinite(nowMs) || !Number.isFinite(observedAt) || !Number.isFinite(expiresAt) ||
      observedAt > nowMs || expiresAt <= nowMs || expiresAt > observedAt + MAX_AGE_MS) {
    return unavailable('observation_expired');
  }
  const gps = gpsHomeAgreement([gpsObservation], binding.anchor, nowMs);
  const conflict = CONFLICT_REASONS.has(gps.reason);
  if (!gps.allowsHome && !conflict) return unavailable(gps.reason);
  return { reason: conflict ? gps.reason : 'home_wifi_detected', value: {
    version: 3, policy: POLICY, pilot: true, state: conflict ? 'conflict' : 'matched', source: 'home_wifi',
    ...(conflict ? { conflictReason: gps.reason } : {}),
    observedAt: new Date(observedAt).toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
    anchor: { geofenceId: binding.anchor.geofenceId, label: 'Home',
      lat: binding.anchor.lat, lng: binding.anchor.lng, radiusMeters: binding.anchor.radiusMeters },
  } };
}

function buildHomeWifiDisplay(observation, binding, nowMs, gpsObservation) {
  return evaluateHomeWifiDisplay(observation, binding, nowMs, gpsObservation).value;
}

// Read-only presentation overlay. Never use this record as a GPS fix, journey
// point, geofence transition, weather position or frozen emergency snapshot.
function readHomeWifiEvidence(device, { now = new Date() } = {}) {
  const value = device?.homeWifiPresence;
  const legacy = value?.version === 1 && value.policy === LEGACY_POLICY;
  const spatial = value?.version === 2 && value.policy === SPATIAL_POLICY;
  const current = value?.version === 3 && value.policy === POLICY;
  const conflict = current && value.state === 'conflict' && CONFLICT_REASONS.has(value.conflictReason);
  if ((!legacy && !spatial && !current) || value.pilot !== true ||
      (value.state !== 'matched' && !conflict) ||
      (value.state === 'matched' && value.conflictReason != null) ||
      value.source !== 'home_wifi' || !validAnchor(value.anchor) ||
      (!legacy && !validHomeRadius(value.anchor.radiusMeters))) return null;
  const at = millis(value.observedAt);
  const expiry = millis(value.expiresAt);
  const clock = millis(now);
  if (!Number.isFinite(clock) || !Number.isFinite(at) || !Number.isFinite(expiry) ||
      at > clock || expiry <= clock || expiry <= at || expiry > at + MAX_AGE_MS) return null;
  return { value, legacy, clock, at, expiry, conflict };
}

function readHomeWifiDisplay(device, options) {
  const evidence = readHomeWifiEvidence(device, options);
  if (!evidence || evidence.conflict) return null;
  const { value, legacy, clock, at, expiry } = evidence;
  const fixes = deviceGpsFixes(device);
  // Cached v1 records keep their original conservative contract until expiry.
  // V2/v3 carry the verified Home radius required for spatial agreement.
  if (legacy ? fixes.some(fix => millis(fix.recordedAt) >= at) :
      !gpsHomeAgreement(fixes, value.anchor, clock).allowsHome) return null;
  return { lat: value.anchor.lat, lng: value.anchor.lng, placeLabel: 'Home',
    source: 'home_wifi', recordedAt: new Date(at), expiresAt: new Date(expiry),
    ageSeconds: Math.floor((clock - at) / 1000) };
}

// A conflict preserves the fact of a fresh router sighting, never selects the
// Home anchor, and never becomes an arrival/departure or emergency location.
// A stored conflict remains a conflict until the publisher explicitly resolves
// it; missing or older persisted GPS must not silently turn it into Home.
function readHomeWifiConflict(device, options) {
  const evidence = readHomeWifiEvidence(device, options);
  if (!evidence || evidence.legacy) return null;
  const { value, clock, at, expiry, conflict } = evidence;
  const reason = conflict ? value.conflictReason :
    gpsHomeAgreement(deviceGpsFixes(device), value.anchor, clock).reason;
  if (!CONFLICT_REASONS.has(reason)) return null;
  return { reason, observedAt: new Date(at), expiresAt: new Date(expiry),
    ageSeconds: Math.floor((clock - at) / 1000) };
}

module.exports = { POLICY, SPATIAL_POLICY, LEGACY_POLICY, MAX_AGE_MS, millis, validAnchor,
  evaluateHomeWifiDisplay, buildHomeWifiDisplay, readHomeWifiDisplay, readHomeWifiConflict };
