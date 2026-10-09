'use strict';

const { classifySosLocation, toDate, MAX_FUTURE_CLOCK_SKEW_SECONDS, SOS_FRESH_LOCATION_MAX_SECONDS } = require('./sos-location-policy');
const { readHomeWifiDisplay } = require('./wifi-home-display-policy');

const VERSION = 2;
const POLICY = 'fresh_incident_evidence_v2';
const SOURCES = new Set(['gps', 'wifi', 'lbs']);
const date = value => { try { return toDate(value); } catch { return null; } };
// Lazy import keeps the legacy snapshot reader independent and backwards compatible.
const copy = (value, source, at) => require('./sos-location-snapshot').copySosLocation(value, source, at);
const freshAt = (point, at) => SOURCES.has(point.source) && point.recordedAt &&
  at - point.recordedAt <= SOS_FRESH_LOCATION_MAX_SECONDS * 1000 &&
  classifySosLocation({ device: { location: point }, now: at }).state === 'fresh';

function copyObservation(value, source, at) {
  const point = copy(value, source, at);
  if (!point) return null;
  if (value.timeBasis === 'gateway_receipt_clock_skew') {
    const original = date(value.deviceRecordedAt);
    if (!original || !point.recordedAt || point.recordedAt.getTime() !== at.getTime() ||
        original <= at || original - at > MAX_FUTURE_CLOCK_SKEW_SECONDS * 1000) return null;
    point.timeBasis = 'gateway_receipt_clock_skew';
    point.deviceRecordedAt = original;
  }
  return point;
}

/** Only the packet received for this incident may use bounded device clock skew.
 * A later database observation can never acquire the incident's receipt time. */
function alarmObservation(value, at) {
  if (!value) return null;
  const recorded = date(value.recordedAt);
  if (recorded && recorded > at && recorded - at <= MAX_FUTURE_CLOCK_SKEW_SECONDS * 1000) {
    return copyObservation({ ...value, recordedAt: at, deviceRecordedAt: recorded,
      timeBasis: 'gateway_receipt_clock_skew' }, null, at);
  }
  return copyObservation(value, null, at);
}

function homeAt(evidence, device, at) {
  if (evidence?.version !== 4) return null;
  const home = readHomeWifiDisplay({ ...device, homeWifiPresence: evidence }, { now: at });
  return home ? { ...home, gpsValid: false, accuracyMeters: null } : null;
}

/** Current evidence only. Older fixes remain history, never the emergency map.
 * Home means proximity to an enrolled router's saved pin, not a measured GPS fix. */
function buildIncidentLocationSnapshot(device = {}, options = {}) {
  const capturedAt = new Date((date(options.now) || new Date()).getTime());
  const incoming = alarmObservation(options.observation, capturedAt);
  const observations = [incoming,
    copyObservation(device.lastLocationObservation, device.accuracySource, capturedAt),
    copyObservation(device.location, device.accuracySource, capturedAt),
    copyObservation(device.lastApproximateLocation, null, capturedAt),
    copyObservation(device.lastSatelliteLocation, 'gps', capturedAt)]
    .filter(Boolean).sort((a, b) => (b.recordedAt?.getTime() || 0) - (a.recordedAt?.getTime() || 0));
  const latestObservation = observations[0] || null;
  const fresh = observations.find(point => freshAt(point, capturedAt));
  // An explicit null from the runtime means no valid enrolled binding. Do not
  // fall back to a database record after enrollment revocation or runtime expiry.
  const evidence = Object.hasOwn(options, 'homeEvidence') ? options.homeEvidence : device.homeWifiPresence;
  const home = homeAt(evidence, device, capturedAt);
  const location = home || fresh || null;
  const homeWifiEvidence = home ? {
    version: evidence.version, policy: evidence.policy, pilot: evidence.pilot,
    state: evidence.state, source: evidence.source, observedAt: evidence.observedAt,
    expiresAt: evidence.expiresAt, anchor: { ...evidence.anchor },
  } : null;
  return {
    version: VERSION, policy: POLICY, capturedAt,
    state: location ? 'fresh' : 'unavailable',
    reason: home ? 'home_wifi_detected' : fresh ? 'recent_location_evidence' : 'no_recent_location_evidence',
    ageSeconds: location ? Math.max(0, Math.round((capturedAt - location.recordedAt) / 1000)) : null,
    retainedSatellite: false, location, latestObservation, homeWifiEvidence,
  };
}

function readIncidentLocationSnapshot(raw) {
  if (!raw || raw.version !== VERSION || raw.policy !== POLICY || raw.retainedSatellite !== false ||
      !['fresh', 'unavailable'].includes(raw.state)) return null;
  const capturedAt = date(raw.capturedAt);
  if (!capturedAt) return null;
  let location = null;
  if (raw.location?.source === 'home_wifi') {
    location = homeAt(raw.homeWifiEvidence, {}, capturedAt);
    const at = date(raw.location.recordedAt);
    if (!location || raw.location.lat !== location.lat || raw.location.lng !== location.lng ||
        !at || at.getTime() !== location.recordedAt.getTime()) return null;
  } else if (raw.location != null) {
    location = copyObservation(raw.location, null, capturedAt);
    if (!location || !freshAt(location, capturedAt)) return null;
  }
  if ((raw.state === 'fresh') !== Boolean(location)) return null;
  return { version: VERSION, policy: POLICY, capturedAt, state: raw.state,
    reason: location?.source === 'home_wifi' ? 'home_wifi_detected'
      : location ? 'recent_location_evidence' : 'no_recent_location_evidence',
    ageSeconds: location ? Math.max(0, Math.round((capturedAt - location.recordedAt) / 1000)) : null,
    retainedSatellite: false, location,
    latestObservation: copyObservation(raw.latestObservation, null, capturedAt),
    homeWifiEvidence: location?.source === 'home_wifi' ? raw.homeWifiEvidence : null };
}

module.exports = { VERSION, POLICY, buildIncidentLocationSnapshot, readIncidentLocationSnapshot };
