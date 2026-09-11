'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('../../docs/testing/wifi-home-display.json');
const { readHomeWifiDisplay, buildHomeWifiDisplay } = require('../src/wifi-home-display-policy');
const { loadHomeWifiBinding, createHomeWifiPublisher } = require('../src/wifi-home-display');
const { buildLocationReplyData, formatLocationReply } = require('../src/location-reply');
const { buildSosLocationSnapshot } = require('../src/sos-location-snapshot');

for (const fixture of fixtures) {
  test(`Home display contract: ${fixture.name}`, () => {
    const before = structuredClone(fixture.device);
    const options = { now: new Date(fixture.now) };
    const home = readHomeWifiDisplay(fixture.device, options);
    assert.equal(Boolean(home), fixture.expectedHome);
    const result = buildLocationReplyData(fixture.device, options);
    assert.equal(result.homeWifiDetected, fixture.expectedHome);
    const withoutHome = { ...fixture.device, homeWifiPresence: null };
    assert.deepEqual(buildSosLocationSnapshot(fixture.device, options),
      buildSosLocationSnapshot(withoutHome, options), 'Home display must not change a frozen SOS');
    if (fixture.expectedHome) {
      const reply = formatLocationReply({ name: 'Test wearer', ...result });
      assert.equal(result.lat, fixture.device.homeWifiPresence.anchor.lat);
      assert.equal(result.lng, fixture.device.homeWifiPresence.anchor.lng);
      assert.equal(result.recordedAt, new Date(fixture.device.homeWifiPresence.observedAt).toISOString());
      assert.equal(result.accuracyMeters, null);
      assert.match(reply, /Home Wi-Fi detected for Test wearer/);
      assert.match(reply, /at or near your saved Home location/);
      assert.match(reply, /View saved Home location/);
      assert.equal((reply.match(/https:/g) || []).length, 1);
      assert.doesNotMatch(reply, /519 m|is indoors|connected to.*router/);
    } else {
      const fallback = buildLocationReplyData(withoutHome, options);
      assert.equal(result.mapsUrl, fallback.mapsUrl);
      assert.equal(result.locationState, fallback.locationState);
    }
    assert.deepEqual(fixture.device, before, 'presentation must not modify raw evidence');
  });
}

const imei = '359633100123456';
const clock = Date.parse('2026-09-01T12:00:00Z');
function bindingDb(edit = () => {}) {
  const data = {
    geofences: { home: { imei, name: 'Home', active: true, createdBy: 'owner',
      center: { lat: -20.15, lng: 57.15, radiusMeters: 150 } } },
    users: { owner: { linkedImeis: [imei] } },
    serviceSubscriptions: { owner: { version: 1, managedBy: 'guardian_admin', plan: 'family', status: 'active' } },
  };
  edit(data);
  return { collection(name) {
    const query = {
      where(field, operator, value) {
        assert.equal(operator, '==');
        assert.ok(['imei', 'active'].includes(field));
        assert.ok(value === imei || value === true);
        return query;
      },
      async get() { return { docs: Object.entries(data[name]).map(([id, item]) => ({ id, data: () => item })) }; },
      doc(id) { return { async get() {
        const item = data[name][id];
        return { exists: Boolean(item), data: () => item };
      } }; },
    };
    return query;
  } };
}

test('Home binding requires exactly one valid saved pin and a linked Family/Care owner', async () => {
  const good = await loadHomeWifiBinding(bindingDb(), imei, clock);
  assert.equal(good.ready, true);
  assert.equal(good.anchor.radiusMeters, 150);
  assert.equal(good.validUntilMs, clock + 60_000);
  for (const edit of [
    d => { d.geofences = {}; },
    d => { d.geofences.second = { ...d.geofences.home }; },
    d => { d.geofences.home.active = false; },
    d => { d.geofences.home.imei = 'another-watch'; },
    d => { d.geofences.home.center.lat = 91; },
    d => { d.geofences.home.radiusMeters = 0; },
    d => { d.geofences.home.radiusMeters = '150'; },
    d => { d.geofences.home.radiusMeters = -1; },
    d => { d.users.owner.linkedImeis = []; },
    d => { d.users.owner.serviceOwnerUid = 'unverified-owner'; },
    d => { d.serviceSubscriptions.owner.plan = 'essential'; },
    d => { d.serviceSubscriptions.owner.status = 'expired'; },
    d => { d.serviceSubscriptions.owner.managedBy = 'client'; },
  ]) assert.equal((await loadHomeWifiBinding(bindingDb(edit), imei, clock)).ready, false);
  const expiring = await loadHomeWifiBinding(bindingDb(d => {
    d.serviceSubscriptions.owner.plan = 'care';
    d.serviceSubscriptions.owner.currentPeriodEnd = new Date(clock + 10_000);
  }), imei, clock);
  assert.equal(expiring.validUntilMs, clock + 10_000);
});

function publisherHarness() {
  const state = { now: clock, writes: [], resets: 0, diagnostics: [], failRead: false,
    failWrite: false, home: true, key: 'first-home', observation: null };
  state.match = (at = state.now) => { state.observation = {
    configured: true, enabled: true, matchState: 'matched', consecutiveMatches: 3,
    observedAt: new Date(at).toISOString(), expiresAt: new Date(at + 120_000).toISOString(),
  }; };
  const publisher = createHomeWifiPublisher({
    now: () => state.now,
    async readBinding(at) {
      if (state.failRead) throw new Error('Synthetic read failure');
      return { ready: state.home, reason: 'home_zone_missing', key: state.key,
        anchor: { geofenceId: 'home', lat: -20.15, lng: 57.15, radiusMeters: 150 }, validUntilMs: at + 60_000 };
    },
    readObservation: () => state.observation,
    resetObservation: () => { state.resets++; state.observation = null; },
    async persist(value) {
      if (state.failWrite) throw new Error('Synthetic write failure');
      state.writes.push(structuredClone(value));
    },
    report: value => state.diagnostics.push(value),
  });
  return { state, ...publisher };
}

test('publisher bounds verified binding renewals by the original radio time and expiry', async () => {
  const run = publisherHarness();
  await run.tick(); // Initial binding must require new radio observations.
  run.state.match();
  await run.tick();
  const saved = run.state.writes.at(-1);
  assert.equal(saved.state, 'matched');
  assert.equal(saved.expiresAt, new Date(clock + 60_000).toISOString());
  run.state.now += 30_000;
  await run.tick(); // A verified binding may renew its lease, never the radio time.
  assert.equal(run.state.writes.length, 3);
  assert.equal(run.state.writes.at(-1).observedAt, saved.observedAt);
  assert.equal(run.state.writes.at(-1).expiresAt, new Date(clock + 90_000).toISOString());
  assert.equal(readHomeWifiDisplay({ homeWifiPresence: saved },
    { now: new Date(clock + 60_000) }), null, 'app/chat cache must expire even if the publisher stops');
  run.state.now = clock + 60_000;
  await run.tick();
  assert.equal(run.state.diagnostics.at(-1).displayingHome, true);
  assert.equal(run.state.writes.at(-1).observedAt, saved.observedAt);
  assert.equal(run.state.writes.at(-1).expiresAt, new Date(clock + 120_000).toISOString());
  run.state.now = clock + 120_000;
  await run.tick();
  assert.equal(run.state.writes.at(-1), null);
});

test('publisher clears on GPS/weak evidence, revocation and failed binding reads', async () => {
  for (const invalidate of [
    s => { s.observation = { reason: 'satellite_observation' }; },
    s => { s.observation = { reason: 'signal_weak' }; },
    s => { s.home = false; },
    s => { s.failRead = true; },
    s => { s.key = 'edited-home-pin'; },
  ]) {
    const run = publisherHarness();
    await run.tick(); run.state.match(); await run.tick();
    run.state.now += 30_000;
    invalidate(run.state);
    await run.tick();
    assert.equal(run.state.writes.at(-1), null);
    assert.equal(run.state.diagnostics.at(-1).displayingHome, false);
  }
});

test('renewals are bounded, failed writes retry, and stopping prevents new writes', async () => {
  const run = publisherHarness();
  await run.tick(); run.state.match(); await run.tick();
  run.state.now += 10_000; run.state.match(); await run.tick();
  assert.equal(run.state.writes.length, 2);
  run.state.now += 10_000; run.state.match(); run.state.failWrite = true;
  await run.tick();
  assert.equal(run.state.diagnostics.at(-1).reason, 'home_display_write_unavailable');
  run.state.failWrite = false; await run.tick();
  assert.equal(run.state.writes.length, 3);
  run.stop(); run.state.now += 120_000; await run.tick();
  assert.equal(run.state.writes.length, 3);
});

test('display publication rejects candidates and never extends beyond the source lifetime', () => {
  const run = publisherHarness(); run.state.match();
  const binding = { ready: true, anchor: { geofenceId: 'home', lat: -20.15, lng: 57.15, radiusMeters: 150 },
    validUntilMs: clock + 300_000 };
  assert.equal(buildHomeWifiDisplay({ ...run.state.observation, consecutiveMatches: 2 }, binding, clock), null);
  const value = buildHomeWifiDisplay(run.state.observation, binding, clock);
  assert.equal(value.expiresAt, run.state.observation.expiresAt);
  assert.deepEqual(Object.keys(value.anchor).sort(), ['geofenceId', 'label', 'lat', 'lng', 'radiusMeters']);
  assert.doesNotMatch(JSON.stringify(value), /hash|routerId|imei|signal|password/i);
});
