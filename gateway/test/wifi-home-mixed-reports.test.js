'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLocationData } = require('../src/protocol/gt06');
const { createWifiHomeObserver, fingerprintRouter } = require('../src/wifi-home-observer');
const { createHomeWifiPublisher } = require('../src/wifi-home-display');
const { buildLocationReplyData, formatLocationReply } = require('../src/location-reply');

const start = Date.parse('2026-09-01T12:00:00Z');
const imei = '359633100123456';
const routerId = '02:00:00:00:00:01';
const hashKey = 'ab'.repeat(32);
const options = { enabled: true, imei, hashKey,
  routerHash: fingerprintRouter({ imei, routerId, hashKey }) };

// Canonical V52 frames with synthetic identifiers/coordinates. Wi-Fi and LBS
// packets differ only in whether a radio scan is present in the decoded frame.
function report(seconds, wifi) {
  const time = new Date(start + seconds * 1000).toISOString().slice(11, 19).replace(/:/g, '');
  const decoded = parseLocationData([
    '010926', time, 'V', '0', 'N', '0', 'E', '0', '0', '0',
    '0', '70', '90', '0', '0', '00000000', '1', '0', '617', '1', '53', '203778', '-80',
    ...(wifi ? ['1', routerId, '-48'] : ['0']),
  ]);
  assert.equal(decoded.accuracySource, wifi ? 'wifi' : 'lbs');
  assert.equal(decoded.wifiAccessPoints.length, wifi ? 1 : 0);
  return { type: 'location', imei, ...decoded };
}

test('alternating real decoded Wi-Fi/LBS frames can establish Home without cellular credit', () => {
  const observer = createWifiHomeObserver(options);
  for (const [seconds, wifi] of [[0, true], [10, false], [20, true], [30, false], [40, true]]) {
    const event = report(seconds, wifi);
    const before = structuredClone(event);
    observer.observe(event, start + seconds * 1000);
    assert.deepEqual(event, before, 'raw telemetry must remain unchanged');
  }
  const result = observer.snapshot(start + 40_000);
  assert.equal(result.matchState, 'matched');
  assert.equal(result.consecutiveMatches, 3);
  assert.equal(result.counts.reports, 5);
  assert.equal(result.counts.qualified, 3);
  assert.equal(result.observedAt, new Date(start + 40_000).toISOString());
});

test('cellular-only reports cannot create, refresh or indefinitely retain Home evidence', () => {
  const observer = createWifiHomeObserver(options);
  for (const seconds of [0, 10, 20]) observer.observe(report(seconds, false), start + seconds * 1000);
  assert.equal(observer.snapshot(start + 20_000).matchState, 'unknown');
  assert.equal(observer.snapshot(start + 20_000).counts.qualified, 0);
  for (const seconds of [30, 40, 50]) observer.observe(report(seconds, true), start + seconds * 1000);
  const matched = observer.snapshot(start + 50_000);
  for (const seconds of [60, 90, 120, 150]) {
    const result = observer.observe(report(seconds, false), start + seconds * 1000);
    assert.equal(result.matchState, 'matched');
    assert.equal(result.consecutiveMatches, matched.consecutiveMatches);
    assert.equal(result.observedAt, matched.observedAt);
    assert.equal(result.expiresAt, matched.expiresAt);
    assert.equal(result.counts.qualified, 3);
  }
  assert.equal(observer.observe(report(170, false), start + 170_000).matchState, 'expired');
  const resumed = observer.observe(report(175, true), start + 175_000);
  assert.equal(resumed.matchState, 'matched');
  assert.equal(resumed.consecutiveMatches, 1, 'cellular packets cannot bridge a long router gap');
});

test('reported long pause then mixed scans reaches the Home publisher and expires without a new radio', async () => {
  let now = start;
  let observer = createWifiHomeObserver(options);
  let homeWifiPresence = null;
  const writes = [];
  const publisher = createHomeWifiPublisher({
    now: () => now,
    readBinding: async at => ({ ready: true, key: 'synthetic-home-owner',
      validUntilMs: at + 60_000,
      anchor: { geofenceId: 'synthetic-home', lat: -20.15, lng: 57.15, radiusMeters: 150 } }),
    readObservation: at => observer.snapshot(at),
    resetObservation: () => { observer = createWifiHomeObserver(options); },
    persist: async value => { homeWifiPresence = value; writes.push({ at: now, value }); },
  });
  await publisher.tick();
  const sequence = new Map([[0, true], [184, true], [194, true], [208, false],
    [232, true], [250, false], [274, true], [292, false], [330, false], [370, false]]);
  const gps = { lat: -20.1, lng: 57.1, source: 'gps', gpsValid: true,
    recordedAt: new Date(start - 7_200_000) };
  for (let second = 0; second <= 394; second++) {
    now = start + second * 1000;
    if (sequence.has(second)) observer.observe(report(second, sequence.get(second)), now);
    await publisher.tick();
    const data = buildLocationReplyData({ homeWifiPresence, lastSatelliteLocation: gps,
      lastHeartbeatAt: new Date(now) }, { now: new Date(now) });
    if ((second >= 120 && second < 184) || second === 394) {
      assert.equal(data.homeWifiDetected, false, `Home unavailable at ${second}s`);
      assert.equal(data.lat, null, 'old GPS is not a current fallback');
    } else {
      assert.equal(data.homeWifiDetected, true, `Home must stay usable at ${second}s`);
      assert.equal(data.lat, -20.15);
      assert.match(formatLocationReply({ name: 'Test wearer', ...data }), /Home Wi-Fi detected/);
      const observedAt = Date.parse(homeWifiPresence.observedAt);
      assert.ok([0, 184, 194, 232, 274].includes((observedAt - start) / 1000));
      assert.equal(data.recordedAt, homeWifiPresence.observedAt);
      // Renewals may wait for the 20-second write bound. They must keep the
      // actual prior source age until the next radio observation is published.
      if (second >= 294) assert.equal(observedAt, start + 274_000);
      assert.ok(Date.parse(homeWifiPresence.expiresAt) <= observedAt + 120_000);
    }
  }
  assert.equal(homeWifiPresence, null);
  for (let index = 1; index < writes.length; index++) {
    const previous = writes[index - 1], current = writes[index];
    if (previous.value && current.value && current.value.expiresAt >= previous.value.expiresAt) {
      assert.ok(current.at - previous.at >= 20_000, 'valid Home renewals remain rate-limited');
    }
  }
  publisher.stop();
});

test('normal ten-minute router reports republish Home after expiry without faster reporting', async () => {
  let now = start;
  const observer = createWifiHomeObserver(options);
  let homeWifiPresence = null;
  const publisher = createHomeWifiPublisher({ now: () => now,
    readBinding: async at => ({ ready: true, key: 'synthetic-home-owner', validUntilMs: at + 60_000,
      anchor: { geofenceId: 'synthetic-home', lat: -20.15, lng: 57.15, radiusMeters: 150 } }),
    readObservation: at => observer.snapshot(at), resetObservation: () => {},
    persist: async value => { homeWifiPresence = value; },
  });
  await publisher.tick();
  for (const second of [0, 600, 1200]) {
    now = start + second * 1000;
    observer.observe(report(second, true), now);
    await publisher.tick();
    assert.equal(buildLocationReplyData({ homeWifiPresence }, { now: new Date(now) }).homeWifiDetected, true);
    assert.equal(homeWifiPresence.observedAt, new Date(now).toISOString());
    now += 120_000;
    observer.observe(report(second + 120, false), now);
    await publisher.tick();
    assert.equal(homeWifiPresence, null, 'time and cellular-only reports cannot restore Home');
  }
  publisher.stop();
});
