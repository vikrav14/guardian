'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildIncidentLocationSnapshot: build, readIncidentLocationSnapshot: read } = require('../src/incident-location-evidence');
const { readSosLocationSnapshot } = require('../src/sos-location-snapshot');
const { buildSosTemplatePlan } = require('../src/guardian-sos-plan');
const { buildFallTemplatePlan } = require('../src/guardian-fall-plan');
const { compactLocation } = require('../src/incident-message-copy');
const now = new Date('2026-10-08T19:05:40.596Z');
const point = (source, secondsAgo, extra = {}) => ({ lat: -20.1, lng: 57.5, source,
  recordedAt: new Date(now - secondsAgo * 1000), accuracyMeters: source === 'gps' ? null : 500, ...extra });
const oldGps = point('gps', 9 * 3600 + 35 * 60, { placeLabel: 'Old town' });
const home = { version: 4, policy: 'enrolled_home_radio_v4', pilot: true, state: 'matched', source: 'home_wifi',
  observedAt: new Date(now - 30000).toISOString(), expiresAt: new Date(+now + 90000).toISOString(),
  anchor: { geofenceId: 'fixture-home', label: 'Home', lat: -20.2, lng: 57.6, radiusMeters: 100 } };

test('fresh network replaces hours-old GPS without borrowing its name, time or precision', () => {
  const snapshot = build({ lastSatelliteLocation: oldGps }, { now,
    observation: point('lbs', 0, { lat: -20.2, placeLabel: 'New town' }) });
  assert.equal(snapshot.state, 'fresh');
  assert.equal(snapshot.location.source, 'lbs');
  assert.equal(snapshot.location.placeLabel, 'New town');
  assert.equal(snapshot.location.accuracyMeters, 500);
  assert.equal(snapshot.ageSeconds, 0);
  assert.match(compactLocation(read(snapshot)), /Approximate location: New town.*radius 500 m/);
  const plan = buildSosTemplatePlan({ alert: { sosLocationSnapshot: snapshot }, now: new Date(+now + 3600000) });
  assert.equal(plan.buttonUrlParameter, '-20.2,57.5');
  assert.doesNotMatch(plan.bodyParameters.join(' '), /Old town/);
});

test('same SOS packet tolerates the observed 1.404 second device clock lead, retaining its original time', () => {
  const observation = point('lbs', -1.404, { placeLabel: 'New town' });
  const snapshot = build({ lastSatelliteLocation: oldGps }, { now, observation });
  assert.equal(snapshot.location.timeBasis, 'gateway_receipt_clock_skew');
  assert.equal(snapshot.location.recordedAt.getTime(), +now);
  assert.equal(snapshot.location.deviceRecordedAt.getTime(), +now + 1404);
  assert.equal(read(snapshot).location.deviceRecordedAt.getTime(), +now + 1404);
  assert.equal(observation.recordedAt.getTime(), +now + 1404, 'raw telemetry is not rewritten');
});

test('later database observations and out-of-window packet times cannot borrow receipt freshness', () => {
  for (const seconds of [-1.404, -121]) {
    assert.equal(build({ location: point('gps', seconds) }, { now }).state, 'unavailable');
  }
  assert.equal(build({}, { now, observation: point('gps', -121) }).state, 'unavailable');
  const forged = build({}, { now, observation: point('gps', -1) });
  forged.location.deviceRecordedAt = new Date(+now + 121000);
  assert.equal(read(forged), null);
});

test('stale, missing-time, unknown-source and invalid GPS cannot produce an emergency map', () => {
  for (const location of [oldGps, point('gps', 600.001), point('gps', 601), point('wifi', 0, { recordedAt: null }),
    point('unknown', 0), point('gps', 0, { gpsValid: false }), point('gps', 0, { lat: 0, lng: 0 })]) {
    const snapshot = build({ location }, { now });
    assert.equal(snapshot.state, 'unavailable');
    assert.equal(snapshot.location, null);
    const alert = { sosLocationSnapshot: snapshot, payload: { locationSnapshot: snapshot } };
    assert.equal(buildSosTemplatePlan({ alert, now }).buttonUrlParameter, null);
    assert.equal(buildFallTemplatePlan({ alert, now }).buttonUrlParameter, null);
    assert.match(compactLocation(readSosLocationSnapshot(alert)), /unavailable/);
  }
});

test('fresh enrolled Home radio wins and is frozen with saved-pin disclosure for SOS and fall', () => {
  const snapshot = build({ lastSatelliteLocation: oldGps, homeWifiPresence: home }, { now });
  assert.equal(snapshot.location.source, 'home_wifi');
  assert.equal(snapshot.location.placeLabel, 'Home');
  assert.equal(read(snapshot).location.lat, home.anchor.lat);
  assert.match(compactLocation(snapshot), /Home Wi-Fi detected.*saved Home pin \(not GPS\)/);
  const alert = { sosLocationSnapshot: snapshot, payload: { locationSnapshot: snapshot } };
  assert.equal(buildSosTemplatePlan({ alert, now }).buttonUrlParameter, '-20.2,57.6');
  const plan = buildFallTemplatePlan({ alert, now });
  assert.equal(plan.buttonUrlParameter, '-20.2,57.6');
  assert.match(plan.bodyParameters[2], /Home Wi-Fi detected.*not GPS/);
});

test('expired, future, conflicted, legacy or explicitly revoked Home evidence cannot claim Home', () => {
  for (const evidence of [{ ...home, expiresAt: now }, { ...home, observedAt: new Date(+now + 1) },
    { ...home, conflictReason: 'gps_outside_home' }, { ...home, version: 3 },
    { ...home, expiresAt: new Date(+now + 1000000) }]) {
    assert.equal(build({ homeWifiPresence: evidence }, { now }).state, 'unavailable');
  }
  assert.equal(build({ homeWifiPresence: home }, { now, homeEvidence: null }).state, 'unavailable');
  const tampered = build({ homeWifiPresence: home }, { now });
  tampered.location.lat = -21;
  assert.equal(read(tampered), null);
});

test('newest valid report determines selection; a new outside GPS defeats expired Home', () => {
  const recent = point('gps', 5, { lat: -21, placeLabel: 'Outside' });
  const snapshot = build({ location: point('wifi', 30), lastSatelliteLocation: recent,
    homeWifiPresence: { ...home, expiresAt: now } }, { now });
  assert.equal(snapshot.location.lat, -21);
  assert.equal(snapshot.location.placeLabel, 'Outside');
});

test('snapshot reader fails closed if a current snapshot is relabeled with stale coordinates', () => {
  const snapshot = build({}, { now, observation: point('gps', 0) });
  snapshot.location = oldGps;
  assert.equal(read(snapshot), null);
});
