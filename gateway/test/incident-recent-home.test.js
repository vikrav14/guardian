'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildIncidentLocationSnapshot: build, readIncidentLocationSnapshot: read } = require('../src/incident-location-evidence');
const { buildLastHomeWifiDetection } = require('../src/last-home-wifi-detection');
const { createHomeWifiPublisher } = require('../src/wifi-home-display');
const { compactLocation, compactAlertParameters } = require('../src/incident-message-copy');
const { buildSosTemplatePlan } = require('../src/guardian-sos-plan');
const { buildFallTemplatePlan } = require('../src/guardian-fall-plan');
const now = new Date('2026-10-09T13:06:44.563Z');
const at = new Date('2026-10-09T13:04:07Z');
const binding = { ready: true, key: 'fixture-binding', validUntilMs: +now + 60000,
  anchor: { geofenceId: 'fixture-home', lat: -20.1, lng: 57.5, radiusMeters: 50 } };
const history = () => buildLastHomeWifiDetection({ version: 4, state: 'matched',
  observedAt: at.toISOString(), expiresAt: new Date(+at + 120000).toISOString(), anchor: binding.anchor }, binding);
const network = { lat: -20.106, lng: 57.504, source: 'wifi', gpsValid: false,
  recordedAt: now, placeLabel: 'Grand Baie', accuracyMeters: 555.239 };
const buildCase = (device = {}, options = {}) => build(device, { now, observation: network,
  homeEvidence: null, lastHomeEvidence: history(), ...options });

test('17:06 fall replay retains recent Home explicitly as history, with the coarse estimate separate', () => {
  const snapshot = buildCase();
  assert.equal(snapshot.version, 3);
  assert.equal(snapshot.state, 'last_known');
  assert.equal(snapshot.location.source, 'home_wifi_last_detected');
  assert.equal(+snapshot.location.recordedAt, +at);
  assert.equal(snapshot.ageSeconds, 158);
  assert.equal(snapshot.latestObservation.placeLabel, 'Grand Baie');
  assert.equal(snapshot.latestObservation.accuracyMeters, 555.239);
  assert.deepEqual(read(snapshot), snapshot);
  const copy = compactLocation(read(snapshot));
  assert.match(copy, /Last detected at Home/);
  assert.match(copy, /Current position unconfirmed/);
  assert.match(copy, /saved Home pin, not live GPS/);
  assert.match(copy, /radius 555 m/);
  assert.doesNotMatch(copy, /Approximate location: Grand Baie/);
  for (const type of ['sos', 'fall']) {
    const alert = { type, eventAt: now, sosLocationSnapshot: snapshot, payload: { locationSnapshot: snapshot } };
    const plan = type === 'sos' ? buildSosTemplatePlan({alert, now}) : buildFallTemplatePlan({alert, now});
    assert.equal(plan.locationState, 'last_known');
    assert.equal(plan.buttonUrlParameter, '-20.1,57.5');
    assert.match(compactAlertParameters({type, alert, plan})[2], /Last detected at Home/);
    assert.match(plan.bodyParameters[2], /current position unconfirmed/);
  }
});

test('recent Home needs the live runtime binding; database history alone cannot revive it', () => {
  for (const evidence of [undefined, null]) {
    const snapshot = buildCase({lastHomeWifiDetection: history()}, {lastHomeEvidence: evidence});
    assert.equal(snapshot.version, 2);
    assert.equal(snapshot.location.source, 'wifi');
  }
});

test('newer GPS or precise network evidence supersedes historical Home without borrowing its name', () => {
  for (const p of [{...network, source: 'gps', gpsValid: true, accuracyMeters: null, placeLabel: 'Outside'},
    {...network, accuracyMeters: 50, placeLabel: 'New place'}]) {
    const snapshot = buildCase({}, {observation: p});
    assert.equal(snapshot.version, 2);
    assert.equal(snapshot.location.placeLabel, p.placeLabel);
  }
  const laterGps = {...network, source:'gps', gpsValid:true, recordedAt:new Date(+at + 1000)};
  assert.equal(buildCase({lastSatelliteLocation:laterGps}).version, 2);
});

test('Home older than ten minutes, future, malformed or altered cannot create a historical map', () => {
  for (const age of [600001, -1]) {
    const observed = new Date(+now - age);
    const evidence = {...history(), observedAt:observed.toISOString(), qualifiedUntil:new Date(+observed + 120000).toISOString()};
    assert.equal(buildCase({}, {lastHomeEvidence:evidence}).version, 2);
  }
  for (const mutate of [s=>s.state='fresh',s=>s.retainedSatellite=true,s=>s.location.lat=-21,
    s=>s.location.recordedAt=now,s=>s.lastHomeWifiEvidence.bindingHash='invalid',
    s=>s.lastHomeWifiEvidence.qualifiedUntil=new Date(+at+121000).toISOString(),
    s=>s.lastHomeWifiEvidence.conflictReason='gps_outside_home']) {
    const snapshot=buildCase(); mutate(snapshot); assert.equal(read(snapshot),null);
  }
  const expired=buildCase(); expired.capturedAt=new Date(+at+600001); assert.equal(read(expired),null);
});

test('fresh qualified Home still wins; historical selection never renews evidence', () => {
  const evidence = history(), before=structuredClone(evidence);
  const fresh={version:4,policy:'enrolled_home_radio_v4',pilot:true,state:'matched',source:'home_wifi',
    observedAt:now.toISOString(),expiresAt:new Date(+now+120000).toISOString(),anchor:binding.anchor};
  assert.equal(buildCase({}, {homeEvidence:fresh}).location.source,'home_wifi');
  buildCase({}, {lastHomeEvidence:evidence}); assert.deepEqual(evidence,before);
});

test('publisher historical reader revalidates binding, expires on read failure, and returns copies', async () => {
  let clock=+now, enabled=true;
  const publisher=createHomeWifiPublisher({now:()=>clock,
    readBinding:async()=>enabled?{...binding,validUntilMs:clock+60000,storedLastDetection:history()}:{ready:false,reason:'revoked'},
    readObservation:()=>null,resetObservation:()=>{},persist:async()=>{}});
  await publisher.tick();
  assert.equal(publisher.getEvidence(clock),null);
  const detected=publisher.getLastDetection(clock); assert.equal(detected.observedAt,at.toISOString());
  detected.anchor.lat=-21; assert.equal(publisher.getLastDetection(clock).anchor.lat,binding.anchor.lat);
  assert.equal(publisher.getLastDetection(clock+60001),null);
  enabled=false;clock+=31000;await publisher.tick();assert.equal(publisher.getLastDetection(clock),null);
  publisher.stop();assert.equal(publisher.getLastDetection(clock),null);
});
