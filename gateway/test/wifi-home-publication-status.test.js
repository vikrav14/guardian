'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHomeWifiPublisher } = require('../src/wifi-home-display');
const { readHomeWifiDisplay } = require('../src/wifi-home-display-policy');

const start = Date.parse('2026-09-01T12:00:00Z');
const drain = () => new Promise(resolve => setImmediate(resolve));
function harness({ readBinding, persist } = {}) {
  const state = { now: start, observation: null, gps: null, saved: null, reads: 0, writes: 0, logs: [] };
  const binding = at => ({ ready: true, key: 'synthetic-owner-home', validUntilMs: at + 60_000,
    anchor: { geofenceId: 'synthetic-home', lat: -20.15, lng: 57.15, radiusMeters: 150 } });
  const run = createHomeWifiPublisher({
    now: () => state.now,
    readBinding: at => { state.reads++; return readBinding ? readBinding(at, binding) : binding(at); },
    readObservation: () => state.observation,
    readGpsObservation: () => state.gps,
    resetObservation: () => { state.observation = null; },
    persist: async value => { state.writes++; if (persist) await persist(value); state.saved = value; },
    report: value => state.logs.push(value),
  });
  const match = () => { state.observation = { enabled: true, configured: true,
    matchState: 'matched', consecutiveMatches: 8,
    observedAt: new Date(state.now).toISOString(),
    expiresAt: new Date(state.now + 120_000).toISOString() }; };
  return { ...run, state, match };
}

test('publication proof survives normal clearing without extending the Home display', async () => {
  const run = harness();
  await run.tick(); run.match(); await run.tick();
  const published = run.getStatus();
  assert.equal(published.publishedHomeFresh, true);
  assert.equal(published.homeEvidenceEligible, true);
  assert.ok(published.lastHomePublication);
  const beforeReads = run.state.reads;
  const beforeWrites = run.state.writes;
  const copy = run.getStatus(); copy.lastHomePublication.observedAt = 'modified by caller';
  assert.notEqual(run.getStatus().lastHomePublication.observedAt, 'modified by caller');
  assert.equal(run.state.reads, beforeReads);
  assert.equal(run.state.writes, beforeWrites, 'status has no Firestore side effects');
  run.state.now += 120_000;
  assert.equal(run.getStatus().publishedHomeFresh, false, 'expiry needs no packet or tick');
  await run.tick();
  const expired = run.getStatus();
  assert.equal(run.state.saved, null);
  assert.equal(expired.publishedHomeFresh, false);
  assert.equal(expired.homeEvidenceEligible, false);
  assert.deepEqual(expired.lastHomePublication, published.lastHomePublication);
  assert.equal(expired.lastClearedAt, new Date(run.state.now).toISOString());
  const json = JSON.stringify(expired);
  for (const secret of ['synthetic-owner-home', 'synthetic-home', '-20.15', '57.15']) {
    assert.ok(!json.includes(secret));
  }
});

test('a pending binding read is observable without duplicate reads and can recover', async () => {
  let release;
  const run = harness({ readBinding: (at, binding) => new Promise(resolve => {
    release = () => resolve(binding(at));
  }) });
  const pending = run.tick();
  assert.equal(run.getStatus().phase, 'home_binding_read');
  run.state.now += 16_000;
  await run.tick(); await run.tick();
  assert.equal(run.state.reads, 1, 'diagnostic polling must not multiply pending SDK work');
  assert.equal(run.getStatus().operationSlow, true);
  assert.equal(run.getStatus().pendingSeconds, 16);
  assert.equal(run.getStatus().publishedHomeFresh, false);
  assert.equal(run.state.logs.at(-1).reason, 'home_binding_read_pending');
  release(); await pending; await drain();
  run.match(); await run.tick();
  assert.equal(run.getStatus().phase, 'idle');
  assert.equal(run.getStatus().operationSlow, false);
  assert.equal(run.getStatus().publishedHomeFresh, true);
});

test('a pending write never counts as publication and a late expired write cannot claim success', async () => {
  let release;
  const run = harness({ persist: value => value && new Promise(resolve => { release = resolve; }) });
  await run.tick(); run.match();
  const pending = run.tick();
  run.state.now += 16_000;
  await run.tick();
  assert.equal(run.getStatus().phase, 'home_presence_write');
  assert.equal(run.getStatus().lastHomePublication, null);
  assert.equal(run.getStatus().publishedHomeFresh, false);
  assert.equal(run.state.logs.at(-1).reason, 'home_presence_write_pending');
  run.state.now += 120_000;
  release(); await pending; await drain();
  assert.equal(run.getStatus().lastHomePublication, null);
  assert.equal(run.getStatus().publishedHomeFresh, false);
  assert.equal(readHomeWifiDisplay({ homeWifiPresence: run.state.saved },
    { now: new Date(run.state.now) }), null);
});

test('a failed binding read clears Home and recovery still requires new radio evidence', async () => {
  let failing = false;
  const run = harness({ readBinding: (at, binding) => {
    if (failing) throw new Error('Synthetic connection failure');
    return binding(at);
  } });
  await run.tick(); run.match(); await run.tick();
  const original = run.getStatus().lastHomePublication;
  run.state.now += 30_000; failing = true;
  await run.tick();
  assert.equal(run.getStatus().bindingReason, 'home_binding_unavailable');
  assert.equal(run.getStatus().publishedHomeFresh, false);
  assert.deepEqual(run.getStatus().lastHomePublication, original);
  run.state.now += 30_000; failing = false;
  await run.tick();
  assert.equal(run.getStatus().homeBindingReady, true);
  assert.equal(run.getStatus().homeEvidenceEligible, false);
  run.match(); await run.tick();
  assert.equal(run.getStatus().publishedHomeFresh, true);
  run.stop();
  assert.equal(run.getStatus().active, false);
  assert.equal(run.getStatus().homeEvidenceEligible, false);
});

test('outside GPS during a pending write cannot veto Home; only acknowledged writes count', async () => {
  let release;
  const run = harness({ persist: value => value && new Promise(resolve => { release = resolve; }) });
  await run.tick(); run.match();
  const pending = run.tick();
  run.state.now += 1_000;
  run.state.gps = { source: 'gps', gpsValid: true, lat: -20.16, lng: 57.15,
    recordedAt: new Date(run.state.now).toISOString() };
  assert.equal(run.getStatus().selectionReason, 'home_wifi_detected');
  assert.equal(run.getStatus().publishedHomeFresh, false);
  assert.equal(run.getEvidence().state, 'matched', 'tracking can read qualified evidence without awaiting Firestore');
  release(); await pending;
  assert.ok(run.getStatus().lastHomePublication);
  assert.equal(run.getStatus().publishedHomeFresh, true);
  assert.equal(readHomeWifiDisplay({ homeWifiPresence: run.state.saved, lastSatelliteLocation: run.state.gps },
    { now: new Date(run.state.now) }).source, 'home_wifi');
  assert.equal(run.getStatus().publishedConflictFresh, false);
});

test('changing GPS does not add writes, renew radio time or prevent expiry', async () => {
  const run = harness();
  await run.tick(); run.match(); await run.tick();
  const original = run.getStatus().lastHomePublication;
  const writes = run.state.writes;
  for (const lat of [-20.16, -20.15, -20.17]) {
    run.state.now += 1000;
    run.state.gps = { lat, lng: 57.15, gpsValid: true,
      recordedAt: new Date(run.state.now).toISOString() };
    await run.tick();
    assert.equal(run.state.saved.state, 'matched');
    assert.equal(run.getStatus().publishedHomeFresh, true);
    assert.equal(run.getStatus().publishedConflictFresh, false);
    assert.deepEqual(run.getStatus().lastHomePublication, original);
  }
  assert.equal(run.state.writes, writes);
  run.state.now = start + 120_000;
  assert.equal(run.getStatus().publishedHomeFresh, false);
  assert.equal(run.getEvidence(), null);
  await run.tick();
  assert.equal(run.state.saved, null);
});

test('radio loss clears immediately despite renewal throttling; a failed write is not publication', async () => {
  const run = harness();
  await run.tick(); run.match(); await run.tick();
  run.state.now += 1000;
  run.state.observation = { ...run.state.observation, matchState: 'unknown', reason: 'router_not_seen' };
  assert.equal(run.getEvidence(), null);
  await run.tick();
  assert.equal(run.state.saved, null);
  assert.equal(run.getStatus().lastClearedReason, 'router_not_seen');

  const failed = harness({ persist: value => { if (value) throw new Error('Synthetic failure'); } });
  await failed.tick(); failed.match(); await failed.tick();
  assert.equal(failed.getStatus().lastHomePublication, null);
  assert.equal(failed.getStatus().publishedHomeFresh, false);
  failed.stop();
  assert.equal(failed.getEvidence(), null);
});
