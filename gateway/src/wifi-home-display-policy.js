'use strict';

const POLICY = 'enrolled_home_radio_v1';
const MAX_AGE_MS = 120_000;

function millis(value) {
  try {
    const date = value?.toDate?.() || (value instanceof Date ? value :
      typeof value === 'string' ? new Date(value) : null);
    return date ? date.getTime() : NaN;
  } catch { return NaN; }
}

function validAnchor(anchor) {
  return Boolean(anchor && typeof anchor.geofenceId === 'string' && anchor.geofenceId &&
    Number.isFinite(anchor.lat) && Math.abs(anchor.lat) <= 90 &&
    Number.isFinite(anchor.lng) && Math.abs(anchor.lng) <= 180 &&
    (anchor.lat !== 0 || anchor.lng !== 0));
}

function buildHomeWifiDisplay(observation, binding, nowMs) {
  if (!binding?.ready || !validAnchor(binding.anchor) ||
      observation?.enabled !== true || observation?.configured !== true ||
      observation.matchState !== 'matched' || !Number.isInteger(observation.consecutiveMatches) ||
      observation.consecutiveMatches < 3) return null;
  const observedAt = millis(observation.observedAt);
  const expiresAt = Math.min(millis(observation.expiresAt), binding.validUntilMs);
  if (!Number.isFinite(nowMs) || !Number.isFinite(observedAt) || !Number.isFinite(expiresAt) ||
      observedAt > nowMs || expiresAt <= nowMs || expiresAt > observedAt + MAX_AGE_MS) return null;
  return {
    version: 1, policy: POLICY, pilot: true, state: 'matched', source: 'home_wifi',
    observedAt: new Date(observedAt).toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
    anchor: { geofenceId: binding.anchor.geofenceId, label: 'Home',
      lat: binding.anchor.lat, lng: binding.anchor.lng },
  };
}

// Read-only presentation overlay. Never use this record as a GPS fix, journey
// point, geofence transition, weather position or frozen emergency snapshot.
function readHomeWifiDisplay(device, { now = new Date() } = {}) {
  const value = device?.homeWifiPresence;
  if (value?.version !== 1 || value.policy !== POLICY || value.pilot !== true ||
      value.state !== 'matched' || value.source !== 'home_wifi' || !validAnchor(value.anchor)) return null;
  const at = millis(value.observedAt);
  const expiry = millis(value.expiresAt);
  const clock = millis(now);
  if (!Number.isFinite(clock) || !Number.isFinite(at) || !Number.isFinite(expiry) ||
      at > clock || expiry <= clock || expiry <= at || expiry > at + MAX_AGE_MS) return null;
  const fixes = [device.lastSatelliteLocation, device.lastLocationObservation, device.location];
  if (fixes.some((fix, index) => fix && fix.gpsValid !== false &&
      (index === 0 || fix.source === 'gps' || (index === 2 && device.accuracySource === 'gps')) &&
      millis(fix.recordedAt) >= at)) return null;
  return { lat: value.anchor.lat, lng: value.anchor.lng, placeLabel: 'Home',
    source: 'home_wifi', recordedAt: new Date(at), expiresAt: new Date(expiry),
    ageSeconds: Math.floor((clock - at) / 1000) };
}

module.exports = { POLICY, MAX_AGE_MS, millis, validAnchor, buildHomeWifiDisplay, readHomeWifiDisplay };
