'use strict';

const { millis, validCoordinates, validHomeRadius, gpsHomeAgreement,
  deviceGpsFixes } = require('./wifi-home-gps-policy');

const POLICY = 'enrolled_home_radio_v2';
const LEGACY_POLICY = 'enrolled_home_radio_v1';
const MAX_AGE_MS = 120_000;

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
  if (!gps.allowsHome) return unavailable(gps.reason);
  return { reason: 'home_wifi_detected', value: {
    version: 2, policy: POLICY, pilot: true, state: 'matched', source: 'home_wifi',
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
function readHomeWifiDisplay(device, { now = new Date() } = {}) {
  const value = device?.homeWifiPresence;
  const legacy = value?.version === 1 && value.policy === LEGACY_POLICY;
  const current = value?.version === 2 && value.policy === POLICY;
  if ((!legacy && !current) || value.pilot !== true ||
      value.state !== 'matched' || value.source !== 'home_wifi' || !validAnchor(value.anchor)) return null;
  const at = millis(value.observedAt);
  const expiry = millis(value.expiresAt);
  const clock = millis(now);
  if (!Number.isFinite(clock) || !Number.isFinite(at) || !Number.isFinite(expiry) ||
      at > clock || expiry <= clock || expiry <= at || expiry > at + MAX_AGE_MS) return null;
  const fixes = deviceGpsFixes(device);
  // Cached v1 records keep their original conservative contract until expiry.
  // Only v2 carries the verified Home radius required for spatial agreement.
  if (legacy ? fixes.some(fix => millis(fix.recordedAt) >= at) :
      !gpsHomeAgreement(fixes, value.anchor, clock).allowsHome) return null;
  return { lat: value.anchor.lat, lng: value.anchor.lng, placeLabel: 'Home',
    source: 'home_wifi', recordedAt: new Date(at), expiresAt: new Date(expiry),
    ageSeconds: Math.floor((clock - at) / 1000) };
}

module.exports = { POLICY, LEGACY_POLICY, MAX_AGE_MS, millis, validAnchor,
  evaluateHomeWifiDisplay, buildHomeWifiDisplay, readHomeWifiDisplay };
