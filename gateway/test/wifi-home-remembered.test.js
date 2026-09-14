'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('../../docs/testing/wifi-home-remembered.json');
const { readLastHomeWifiDetection, matchesHomeBinding } = require('../src/last-home-wifi-detection');
const { readHomeWifiPriority } = require('../src/wifi-home-display-policy');
const { createHomeWifiTrackingPolicy } = require('../src/wifi-home-tracking');
const { createHomeWifiPublisher } = require('../src/wifi-home-display');
const { buildLocationReplyData, formatLocationReply } = require('../src/location-reply');
const { buildSosLocationSnapshot } = require('../src/sos-location-snapshot');
const { isAtGeofence } = require('../src/assistant/tools');

for (const fixture of fixtures) {
  test(`remembered Home app/chat contract: ${fixture.name}`, () => {
    const device = structuredClone(fixture.device);
    const options = { now: new Date(fixture.now) };
    const remembered = readLastHomeWifiDetection(device, options);
    assert.equal(Boolean(remembered), fixture.expectedRemembered);
    const reply = buildLocationReplyData(device, options);
    assert.equal(reply.lastDetectedAtHome, fixture.expectedRemembered);
    const without = { ...device, lastHomeWifiDetection: null };
    assert.deepEqual(buildSosLocationSnapshot(device, options), buildSosLocationSnapshot(without, options));
    assert.deepEqual(readHomeWifiPriority(device, options), readHomeWifiPriority(without, options));
    if (remembered) {
      assert.equal(reply.homeWifiDetected, false);
      assert.equal(reply.locationState, 'last_known');
      assert.equal(reply.recordedAt, device.lastHomeWifiDetection.observedAt);
      assert.equal(reply.lat, device.lastHomeWifiDetection.anchor.lat);
      const text = formatLocationReply({ ...reply, name: 'Test wearer' });
      assert.match(text, /Last detected at Home/);
      assert.match(text, /Current presence at Home is unconfirmed/);
      assert.doesNotMatch(text, /watch is at or near|has left|has arrived|Home Wi-Fi detected for/);
      assert.equal((text.match(/https:/g) || []).length, 1);
    } else {
      assert.equal(reply.mapsUrl, buildLocationReplyData(without, options).mapsUrl);
    }
    assert.deepEqual(device, fixture.device, 'presentation cannot mutate evidence');
  });
}

const start = Date.parse('2026-09-14T00:10:00Z');
const anchor = fixtures[0].device.lastHomeWifiDetection.anchor;
function harness({ stored, key = 'synthetic-owner-home' } = {}) {
  const state = { now: start, observation: null, saved: null, remembered: null, binding: true, writes: 0 };
  const publisher = createHomeWifiPublisher({ now: () => state.now,
    readBinding: (at, options) => ({ ready: state.binding, reason: 'home_owner_unverified', key,
      anchor, validUntilMs: at + 60_000, ...(options.restorePresence ? { storedLastDetection: stored } : {}) }),
    readObservation: () => state.observation, resetObservation: () => { state.observation = null; },
    persist: async (value, remembered) => { state.saved = value; state.remembered = remembered; state.writes++; },
  });
  const match = () => { state.observation = { enabled: true, configured: true, matchState: 'matched',
    consecutiveMatches: 3, observedAt: new Date(state.now).toISOString(),
    expiresAt: new Date(state.now + 120_000).toISOString() }; };
  return { ...publisher, state, match };
}

test('expiry preserves history, while fresh tracking priority ends and accepted GPS resumes movement', async () => {
  const run = harness();
  await run.tick(); run.match(); await run.tick();
  const recorded = structuredClone(run.state.remembered);
  const hold = createHomeWifiTrackingPolicy({ suspend: () => [], seedHome: () => {} });
  assert.equal(hold('synthetic-watch', null, run.getEvidence(), new Date(run.state.now)).hold, true);
  run.state.now += 180_000;
  run.state.observation = { reason: 'observation_expired' };
  await run.tick();
  assert.equal(run.state.saved, null);
  assert.deepEqual(run.state.remembered, recorded, 'expiry cannot renew historical source time');
  assert.equal(run.getEvidence(), null);
  assert.equal(run.getStatus().publishedHomeFresh, false);
  assert.equal(hold('synthetic-watch', { lat: -20.17, lng: 57.17, source: 'gps', gpsValid: true,
    recordedAt: new Date(run.state.now) }, run.state.remembered, new Date(run.state.now)).hold, false,
  'even mistakenly passing the historical record cannot grant active Home priority');
  const historical = readLastHomeWifiDetection({ lastHomeWifiDetection: run.state.remembered },
    { now: new Date(run.state.now) });
  assert.equal(historical.ageSeconds, 180);
  run.match(); await run.tick();
  assert.equal(run.getStatus().publishedHomeFresh, true, 'new router reports can establish fresh Home again');
  run.stop();
});

test('restart restores only historical evidence for the same verified binding', async () => {
  const stored = fixtures[0].device.lastHomeWifiDetection;
  for (const key of ['synthetic-owner-home', 'replacement-owner-same-pin']) {
    const run = harness({ stored, key });
    run.state.now += 600_000;
    await run.tick();
    assert.equal(Boolean(run.state.remembered), key === 'synthetic-owner-home');
    assert.equal(run.state.saved, null);
    assert.equal(run.getEvidence(), null, 'restart never promotes history to current presence');
    run.state.binding = false; run.state.now += 30_000;
    await run.tick();
    assert.equal(run.state.remembered, null, 'verified loss of ownership clears historical display');
    run.stop();
  }
  assert.equal(matchesHomeBinding(stored, { ready: true, key: 'synthetic-owner-home',
    anchor: { ...anchor, lat: anchor.lat + 0.01 } }, new Date(start + 600_000)), false);
});

test('assistant Home check returns unknown rather than asserting presence from history or network coordinates', async () => {
  const device = structuredClone(fixtures[0].device);
  device.imei = 'synthetic-watch'; device.nickname = 'Test wearer';
  const db = { collection: () => ({ where() { return this; },
    get: async () => ({ docs: [{ id: anchor.geofenceId, data: () => ({ name: 'Home', center: anchor }) }] }) }) };
  // Source time in the real past; the fixture clock itself is intentionally fixed.
  const clock = Date.now();
  device.lastHomeWifiDetection.observedAt = new Date(clock - 600_000).toISOString();
  device.lastHomeWifiDetection.qualifiedUntil = new Date(clock - 480_000).toISOString();
  device.lastSatelliteLocation.recordedAt = new Date(clock - 86_400_000).toISOString();
  const result = await isAtGeofence(db, { devices: [device] }, { geofence_name: 'Home' });
  assert.equal(result.atGeofence, null);
  assert.equal(result.reason, 'last_detected_home_only');
  assert.match(result.disclosure, /unconfirmed/);
});
