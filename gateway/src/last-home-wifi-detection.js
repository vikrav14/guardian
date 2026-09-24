'use strict';

const { createHash } = require('node:crypto');
const { millis, validCoordinates, validHomeRadius, deviceGpsFixes } = require('./wifi-home-gps-policy');
const { readHomeWifiDisplay, readHomeWifiConflict, validAnchor, MAX_AGE_MS } = require('./wifi-home-display-policy');

const POLICY = 'last_detected_home_v1';
const bindingHash = binding => typeof binding?.key === 'string'
  ? createHash('sha256').update(binding.key).digest('hex') : null;

function buildLastHomeWifiDetection(value, binding) {
  const hash = bindingHash(binding);
  if (!hash || value?.version !== 4 || value.state !== 'matched') return null;
  return { version: 1, policy: POLICY, source: 'home_wifi',
    observedAt: value.observedAt, qualifiedUntil: value.expiresAt,
    anchor: { ...value.anchor }, bindingHash: hash };
}

function validLastHomeWifiDetection(value, now) {
  const at = millis(value?.observedAt);
  const until = millis(value?.qualifiedUntil);
  const clock = millis(now);
  return value?.version === 1 && value.policy === POLICY && value.source === 'home_wifi' && value.conflictReason == null &&
    /^[a-f0-9]{64}$/.test(value.bindingHash || '') && validAnchor(value.anchor) &&
    validHomeRadius(value.anchor.radiusMeters) && Number.isFinite(clock) &&
    Number.isFinite(at) && Number.isFinite(until) && at <= clock &&
    until > at && until <= at + MAX_AGE_MS;
}

function matchesHomeBinding(value, binding, now) {
  return binding?.ready === true && validLastHomeWifiDetection(value, now) &&
    value.bindingHash === bindingHash(binding) &&
    ['geofenceId', 'lat', 'lng', 'radiusMeters'].every(key => value.anchor[key] === binding.anchor?.[key]);
}

// Historical presentation only. Never pass this record to presence, journey,
// geofence, intelligence suppression, "is at Home?", or SOS selection.
function readLastHomeWifiDetection(device, { now = new Date() } = {}) {
  const value = device?.lastHomeWifiDetection;
  if (!validLastHomeWifiDetection(value, now) ||
      readHomeWifiDisplay(device, { now }) || readHomeWifiConflict(device, { now })) return null;
  const at = millis(value.observedAt);
  const clock = millis(now);
  // A newer accepted GPS fix wins even after it grows old. Network estimates
  // and heartbeats cannot erase/renew the historical Home observation.
  if (deviceGpsFixes(device).some(fix => validCoordinates(fix) &&
      millis(fix.recordedAt) > at && millis(fix.recordedAt) <= clock)) return null;
  return { lat: value.anchor.lat, lng: value.anchor.lng, placeLabel: 'Home',
    source: 'home_wifi_last_detected', recordedAt: new Date(at),
    ageSeconds: Math.floor((clock - at) / 1000) };
}

module.exports = { POLICY, buildLastHomeWifiDetection, validLastHomeWifiDetection,
  matchesHomeBinding, readLastHomeWifiDetection };
