'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const api = require('../src/wifi-home-observer');
const { parseLocationData } = require('../src/protocol/gt06');
const { POLICY, normalizeRouterId, fingerprintRouter, createWifiHomeObserver } = api;

const imei = '359633100123456';
const routerId = '02:00:00:00:00:01';
const otherRouter = '02:00:00:00:00:02';
const hashKey = 'ab'.repeat(32);
const routerHash = fingerprintRouter({ imei, routerId, hashKey });
const start = Date.parse('2026-09-01T12:00:00Z');
const options = { enabled: true, imei, routerHash, hashKey };

function packet(offset = 0, overrides = {}) {
  return { type: 'location', imei, gpsValid: false, accuracySource: 'wifi',
    location: { recordedAt: new Date(start + offset), gpsValid: false, source: 'wifi',
      lat: -20.1, lng: 57.1, accuracyMeters: 519 },
    wifiAccessPoints: [{ macAddress: routerId, signalStrength: -60 }], ...overrides };
}

function matched(observer = createWifiHomeObserver(options)) {
  for (const at of [0, 10_000, 20_000]) observer.observe(packet(at), start + at);
  assert.equal(observer.snapshot(start + 20_000).matchState, 'matched');
  return observer;
}

test('router fingerprint is normalized, keyed and scoped to one watch', () => {
  assert.equal(normalizeRouterId(' 02-00-00-00-00-01 '), routerId);
  assert.equal(fingerprintRouter({ imei, routerId: routerId.toUpperCase(), hashKey }), routerHash);
  assert.notEqual(fingerprintRouter({ imei: '359633100123457', routerId, hashKey }), routerHash);
  assert.notEqual(fingerprintRouter({ imei, routerId, hashKey: 'cd'.repeat(32) }), routerHash);
  for (const invalid of ['Home', '', '00:00:00:00:00:00', 'ff:ff:ff:ff:ff:ff', '01:00:00:00:00:01']) {
    assert.equal(normalizeRouterId(invalid), null);
    assert.throws(() => fingerprintRouter({ imei, routerId: invalid, hashKey }), /Valid pilot/);
  }
});

test('disabled, malformed and unscoped observations fail closed', () => {
  for (const overrides of [{ enabled: false }, { enabled: 'true' }, { imei: 'short' },
    { routerHash: '' }, { hashKey: 'weak' }]) {
    const observer = createWifiHomeObserver({ ...options, ...overrides });
    assert.equal(observer.observe(packet(), start).matchState, 'disabled');
    assert.equal(observer.snapshot(start).counts.reports, 0);
  }
  const observer = createWifiHomeObserver(options);
  observer.observe(packet(0, { imei: '359633100123457' }), start);
  assert.equal(observer.snapshot(start).counts.reports, 0);
});

test('three fresh strong reports over twenty seconds match without claiming Home', () => {
  const observer = createWifiHomeObserver(options);
  assert.equal(observer.observe(packet(), start).matchState, 'candidate');
  assert.equal(observer.observe(packet(10_000), start + 10_000).matchState, 'candidate');
  const status = observer.observe(packet(20_000), start + 20_000);
  assert.equal(status.matchState, 'matched');
  assert.equal(status.consecutiveMatches, 3);
  assert.equal(status.homeClaim, false);
  assert.equal(status.customerActive, false);
  assert.equal(status.observeOnly, true);
});

test('canonical V52 passive packets feed the observer before provider geolocation', () => {
  const observer = createWifiHomeObserver(options);
  for (const second of [0, 10, 20]) {
    const decoded = parseLocationData([
      '010926', `1200${String(second).padStart(2, '0')}`, 'V', '0', 'N', '0', 'E',
      '0', '0', '0', '0', '70', '90', '0', '0', '00000000',
      '1', '0', '617', '1', '53', '203778', '-80', '1', routerId, '-60',
    ]);
    assert.equal(decoded.needsGeolocation, true);
    assert.equal(decoded.location.lat, null);
    observer.observe({ type: 'location', imei, ...decoded }, start + second * 1000);
  }
  assert.equal(observer.snapshot(start + 20_000).matchState, 'matched');
});

for (const [name, overrides, reason] of [
  ['unknown router', { wifiAccessPoints: [{ macAddress: otherRouter, signalStrength: -40 }] }, 'router_not_seen'],
  ['SSID alone', { wifiAccessPoints: [{ ssid: 'Home', signalStrength: -40 }] }, 'router_not_seen'],
  ['weak signal', { wifiAccessPoints: [{ macAddress: routerId, signalStrength: -95 }] }, 'signal_weak'],
  ['missing signal', { wifiAccessPoints: [{ macAddress: routerId }] }, 'signal_unknown'],
  ['string signal', { wifiAccessPoints: [{ macAddress: routerId, signalStrength: '-40' }] }, 'signal_unknown'],
  ['impossible signal', { wifiAccessPoints: [{ macAddress: routerId, signalStrength: 20 }] }, 'signal_unknown'],
  ['cellular label contradicting a Wi-Fi scan', { accuracySource: 'lbs' }, 'no_wifi_evidence'],
  ['unknown GPS validity', { gpsValid: undefined }, 'no_wifi_evidence'],
  ['missing scan', { wifiAccessPoints: undefined }, 'invalid_scan'],
  ['oversized scan', { wifiAccessPoints: Array.from({ length: 33 }, () => ({ macAddress: routerId, signalStrength: -40 })) }, 'invalid_scan'],
]) {
  test(`${name} cannot establish or retain a router match`, () => {
    const observer = matched();
    const status = observer.observe(packet(30_000, overrides), start + 30_000);
    assert.equal(status.matchState, 'unknown');
    assert.equal(status.reason, reason);
    assert.equal(status.consecutiveMatches, 0);
  });
}

test('contradictory source fields cannot establish a Wi-Fi match', () => {
  const observer = matched();
  const event = packet(30_000);
  event.location.source = 'gps';
  assert.equal(observer.observe(event, start + 30_000).reason, 'no_wifi_evidence');
});

test('duplicate timestamps and duplicate AP entries never count as separate reports', () => {
  const observer = createWifiHomeObserver(options);
  const event = packet();
  event.wifiAccessPoints = Array.from({ length: 10 }, () => ({ macAddress: routerId, signalStrength: -55 }));
  observer.observe(event, start);
  observer.observe(event, start + 10_000);
  const status = observer.observe(event, start + 20_000);
  assert.equal(status.matchState, 'candidate');
  assert.equal(status.consecutiveMatches, 1);
  assert.equal(status.counts.qualified, 1);
  assert.equal(status.counts.duplicates, 2);
  assert.equal(observer.snapshot(start + POLICY.maxAgeMs).matchState, 'expired');
});

test('older packets and fresh heartbeats do not renew the last router observation', () => {
  const observer = matched();
  observer.observe(packet(5_000), start + 40_000);
  const heartbeat = packet(100_000, { type: 'heartbeat' });
  const before = observer.snapshot(start + 100_000);
  observer.observe(heartbeat, start + 100_000);
  assert.deepEqual(observer.snapshot(start + 100_000), before);
  assert.equal(observer.snapshot(start + 140_000).matchState, 'expired');
  assert.equal(observer.snapshot(start + 140_000).counts.qualified, 3);
});

test('stale, future and missing source timestamps cannot create a match', () => {
  for (const sourceTime of [new Date(start - 120_000), new Date(start + 16_000), undefined, 'invalid']) {
    const observer = createWifiHomeObserver(options);
    const event = packet(); event.location.recordedAt = sourceTime;
    for (const at of [0, 1, 2]) observer.observe(event, start + at);
    const status = observer.snapshot(start + 2);
    assert.equal(status.matchState, 'unknown');
    assert.equal(status.counts.qualified, 0);
    assert.equal(status.counts.ignoredTime, 3);
  }
});

test('a backlog burst cannot impersonate sustained fresh radio observations', () => {
  const observer = createWifiHomeObserver(options);
  for (const [sourceOffset, receivedOffset] of [[-40_000, 0], [-30_000, 1], [-20_000, 2]]) {
    observer.observe(packet(sourceOffset), start + receivedOffset);
  }
  assert.equal(observer.snapshot(start + 2).matchState, 'candidate');
});

test('long gaps and process restarts require a new observation sequence', () => {
  const observer = matched();
  const status = observer.observe(packet(81_000), start + 81_000);
  assert.equal(status.matchState, 'candidate');
  assert.equal(status.consecutiveMatches, 1);
  const restarted = createWifiHomeObserver(options);
  assert.equal(restarted.observe(packet(81_000), start + 81_000).matchState, 'candidate');
});

test('fresh satellite evidence ends a match; stale satellite evidence does not overwrite it', () => {
  const observer = matched();
  const gps = packet(30_000, { gpsValid: true, accuracySource: 'gps' });
  gps.location.gpsValid = true; gps.location.source = 'gps';
  const staleGps = structuredClone(gps); staleGps.location.recordedAt = new Date(start - 7_200_000);
  assert.equal(observer.observe(staleGps, start + 30_000).matchState, 'matched');
  assert.equal(observer.observe(gps, start + 30_000).reason, 'satellite_observation');
});

test('clock rollback removes any current match from diagnostic presentation', () => {
  const observer = matched();
  assert.equal(observer.snapshot(start + 10_000).matchState, 'unknown');
  assert.equal(observer.snapshot(start + 10_000).reason, 'clock_unconfirmed');
});

test('observer leaves raw location evidence unchanged and diagnostics omit all identifiers', () => {
  const observer = createWifiHomeObserver(options);
  const event = packet(); const original = structuredClone(event);
  Object.freeze(event.location); Object.freeze(event.wifiAccessPoints[0]);
  Object.freeze(event.wifiAccessPoints); Object.freeze(event);
  const result = observer.observe(event, start);
  assert.deepEqual(event, original);
  const publicText = JSON.stringify(result);
  for (const privateValue of [imei, routerId, routerHash, hashKey, '-20.1', '57.1']) {
    assert.ok(!publicText.includes(privateValue));
  }
});

function runtime(config) {
  const logs = [];
  const sandbox = { module: { exports: {} }, console: { log: line => logs.push(line) },
    require: name => name === './config' ? config : api };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/wifi-home-runtime.js'), 'utf8'), sandbox);
  return { observe: sandbox.module.exports.observeWifiHomeEvent, logs };
}

test('running-gateway observer is silent by default and for unrelated watches', () => {
  const run = runtime({}); run.observe(packet(), new Date(start));
  assert.deepEqual(run.logs, []);
  const enabled = runtime({ wifiHomeObserveEnabled: true, wifiHomePilotImei: imei,
    wifiHomeRouterHash: routerHash, wifiHomeHashKey: hashKey });
  enabled.observe(packet(0, { imei: '359633100123457' }), new Date(start));
  assert.deepEqual(enabled.logs, []);
});

test('gateway diagnostics use the live observation sequence and remain redacted', () => {
  const run = runtime({ wifiHomeObserveEnabled: true, wifiHomePilotImei: imei,
    wifiHomeRouterHash: routerHash, wifiHomeHashKey: hashKey });
  for (const at of [0, 10_000, 20_000]) run.observe(packet(at), new Date(start + at));
  const last = JSON.parse(run.logs.at(-1).slice('[wifi-home] '.length));
  assert.equal(last.matchState, 'matched');
  for (const secret of [imei, routerId, routerHash, hashKey]) assert.ok(!run.logs.join('').includes(secret));
  run.observe(packet(140_000, { type: 'heartbeat' }), new Date(start + 140_000));
  assert.equal(JSON.parse(run.logs.at(-1).slice('[wifi-home] '.length)).matchState, 'expired');
});
