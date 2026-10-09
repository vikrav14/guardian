'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { normalizeReceivedLocationEvent: normalize } = require('../src/location-receipt-time');
const { createJourneyReliability } = require('../src/journey-reliability');
const { normalizeGps } = require('../src/journey-history-recovery');
const { createWifiHomeObserver, fingerprintRouter } = require('../src/wifi-home-observer');
const { parseLocationData } = require('../src/protocol/gt06');
const now = Date.parse('2026-10-09T10:00:00Z');
const imei = '359633100123456', routerId = '02:00:00:00:00:01', hashKey = 'ab'.repeat(32);
const packet = at => ({ type: 'location', imei, gpsValid: true, accuracySource: 'gps',
  location: { lat: -20.1, lng: 57.5, gpsValid: true, source: 'gps', recordedAt: new Date(at) } });
function reliability(t, clock) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'guardian-location-clock-'));
  const runtime = createJourneyReliability({ directory, now: clock });
  t.after(() => { runtime.journal.release(); fs.rmSync(directory, { recursive: true, force: true }); });
  return runtime;
}

test('a three-second clock lead preserves both times and GPS durability before processing', t => {
  const raw = packet(now + 3000), receipt = new Date(now);
  const fixed = normalize(raw, receipt);
  assert.equal(+raw.location.recordedAt, now + 3000);
  assert.equal(+fixed.location.recordedAt, now);
  assert.equal(+fixed.location.deviceRecordedAt, now + 3000);
  assert.equal(fixed.location.lat, raw.location.lat);
  const runtime = reliability(t, () => now);
  const id = runtime.capture(fixed, receipt);
  assert.ok(id);
  const stored = runtime.journal.read(imei).points[id].point;
  assert.equal(+normalizeGps(stored, now).deviceRecordedAt, now + 3000);
  assert.equal(runtime.route(fixed, receipt).live, true);
  runtime.processed(imei, id);
  assert.equal(runtime.route(fixed, receipt).reason, 'duplicate_record');
});

test('real V52 enrolled-router reports with clock lead reach Home qualification', t => {
  let clock = now;
  const runtime = reliability(t, () => clock);
  const observer = createWifiHomeObserver({ enabled: true, imei, hashKey,
    routerHash: fingerprintRouter({ imei, routerId, hashKey }) });
  for (const seconds of [0, 10, 20]) {
    clock = now + seconds * 1000;
    const raw = { type: 'location', imei, ...parseLocationData([
      '091026', `1000${String(seconds + 3).padStart(2, '0')}`, 'V', '0', 'N', '0', 'E',
      '0', '0', '0', '0', '70', '90', '0', '0', '00000000',
      '1', '0', '617', '1', '53', '203778', '-80', '1', routerId, '-65',
    ]) };
    const fixed = normalize(raw, new Date(clock));
    assert.equal(runtime.route(fixed, new Date(clock)).live, true);
    observer.observe(fixed, clock);
    assert.equal(+raw.location.recordedAt, clock + 3000);
  }
  assert.equal(observer.snapshot(clock).matchState, 'matched');
  assert.equal(observer.snapshot(clock).signalDbm, -65);
  assert.equal(observer.snapshot(clock + 120000).matchState, 'expired');
});

test('old, undated and larger future reports cannot borrow current receipt freshness', t => {
  const runtime = reliability(t, () => now);
  for (const at of [now - 120000, now + 15001, NaN]) {
    const raw = packet(at);
    assert.equal(normalize(raw, new Date(now)), raw);
    assert.equal(runtime.route(raw, new Date(now)).live, false);
  }
  const current = packet(now - 1000);
  assert.equal(normalize(current, new Date(now)), current);
  for (const type of ['alarm', 'heartbeat']) {
    const raw = { ...packet(now + 3000), type };
    assert.equal(normalize(raw, new Date(now)), raw);
  }
});

test('replayed future-radio reports cannot become a sustained twenty-second match', () => {
  const observer = createWifiHomeObserver({ enabled: true, imei, hashKey,
    routerHash: fingerprintRouter({ imei, routerId, hashKey }) });
  const raw = { ...packet(now + 15000), gpsValid: false, accuracySource: 'wifi',
    location: { ...packet(now + 15000).location, source: 'wifi', gpsValid: false },
    wifiAccessPoints: [{ macAddress: routerId, signalStrength: -95 }] };
  for (const delay of [0, 5000, 10000, 15000, 20000, 30000]) {
    observer.observe(normalize(raw, new Date(now + delay)), now + delay);
    assert.notEqual(observer.snapshot(now + delay).matchState, 'matched');
  }
});
