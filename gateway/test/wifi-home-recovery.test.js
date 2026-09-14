'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFirstSnapshot } = require('../src/firestore-first-snapshot');
const { createHomeWifiPublisher } = require('../src/wifi-home-display');
const { readHomeWifiDisplay } = require('../src/wifi-home-display-policy');
const drain = () => new Promise(resolve => setImmediate(resolve));

test('one-shot Firestore reads unsubscribe on success, error and cancellation, including synchronous adapters', async () => {
  for (const mode of ['success', 'error', 'abort', 'sync']) {
    let active = 0; let next; let fail;
    const controller = new AbortController();
    const promise = readFirstSnapshot({ onSnapshot(onNext, onError) {
      active++; next = onNext; fail = onError;
      if (mode === 'sync') onNext({ value: 1 });
      return () => { active--; };
    } }, controller.signal);
    if (mode === 'success') next({ value: 1 });
    if (mode === 'error') fail(new Error('synthetic read error'));
    if (mode === 'abort') controller.abort(new Error('synthetic timeout'));
    if (['success', 'sync'].includes(mode)) assert.deepEqual(await promise, { value: 1 });
    else await assert.rejects(promise);
    assert.equal(active, 0, mode);
    next({ value: 'late result' });
    assert.equal(active, 0, 'late callbacks cannot finish twice');
  }
  const controller = new AbortController(); controller.abort();
  await assert.rejects(readFirstSnapshot({ onSnapshot() { assert.fail('cancelled work cannot start'); } }, controller.signal));
});

test('stalled Home reads cancel, retry on schedule, ignore late results and never queue offline writes', async () => {
  let clock = Date.parse('2026-09-14T00:00:00Z');
  let active = 0; let reads = 0; let writes = 0; let timeout; let late;
  let online = false;
  const binding = () => ({ ready: true, key: 'synthetic-home-owner',
    validUntilMs: clock + 60_000,
    anchor: { geofenceId: 'home', lat: -20.15, lng: 57.15, radiusMeters: 50 } });
  const publisher = createHomeWifiPublisher({ now: () => clock,
    setTimer: callback => { timeout = callback; return { unref() {} }; }, clearTimer: () => {},
    readBinding: async (_, { signal }) => {
      reads++;
      await readFirstSnapshot({ onSnapshot(next) {
        active++; late = next;
        if (online) next({});
        return () => { active--; };
      } }, signal);
      return binding();
    },
    readObservation: () => null, resetObservation: () => {},
    persist: async () => { writes++; },
  });
  for (let attempt = 1; attempt <= 3; attempt++) {
    const pending = publisher.tick(); await drain();
    assert.equal(active, 1);
    await publisher.tick(); await publisher.tick();
    assert.equal(reads, attempt, 'polling cannot create concurrent reads');
    clock += 15_000; timeout(); await pending; await drain();
    assert.equal(active, 0, 'timed-out read is unsubscribed, not abandoned');
    assert.equal(publisher.getStatus().bindingReason, 'home_binding_timeout');
    assert.equal(publisher.getStatus().phase, 'idle');
    assert.equal(publisher.getStatus().bindingTimeouts, attempt);
    assert.equal(writes, 0, 'do not block recovery on an SDK write while backend reads fail');
    late({}); await drain();
    assert.equal(publisher.getStatus().homeBindingReady, false);
    clock += 15_000;
  }
  online = true;
  await publisher.tick();
  assert.equal(publisher.getStatus().homeBindingReady, true);
  assert.equal(publisher.getEvidence(), null, 'recovery cannot invent router evidence');
  assert.equal(active, 0);
  publisher.stop();
});

test('stopping a pending publisher cancels its read and prevents late publication', async () => {
  let unsubscribeCount = 0; let next; let writes = 0;
  const publisher = createHomeWifiPublisher({
    readBinding: (_, { signal }) => readFirstSnapshot({ onSnapshot(callback) {
      next = callback; return () => { unsubscribeCount++; };
    } }, signal),
    readObservation: () => null, resetObservation: () => {}, persist: async () => { writes++; },
  });
  const pending = publisher.tick(); await drain();
  publisher.stop(); await pending;
  assert.equal(unsubscribeCount, 1);
  next({ ready: true }); await drain();
  assert.equal(writes, 0);
  assert.equal(publisher.getStatus().active, false);
});

test('a read failure cannot renew fresh Home and does not erase its historical source', async () => {
  let clock = Date.parse('2026-09-14T00:00:00Z');
  let failing = false; let observation = null; let saved; let remembered; let writes = 0;
  const publisher = createHomeWifiPublisher({ now: () => clock,
    readBinding: at => {
      if (failing) throw new Error('network unavailable');
      return { ready: true, key: 'synthetic-home', validUntilMs: at + 60_000,
        anchor: { geofenceId: 'home', lat: -20.15, lng: 57.15, radiusMeters: 50 } };
    }, readObservation: () => observation, resetObservation: () => { observation = null; },
    persist: async (value, history) => { saved = value; remembered = history; writes++; },
  });
  await publisher.tick();
  observation = { enabled: true, configured: true, matchState: 'matched', consecutiveMatches: 3,
    observedAt: new Date(clock).toISOString(), expiresAt: new Date(clock + 120_000).toISOString() };
  await publisher.tick();
  const original = structuredClone(remembered); const written = writes;
  failing = true; clock += 30_000; await publisher.tick();
  assert.equal(publisher.getStatus().publishedHomeFresh, false);
  assert.equal(writes, written);
  clock += 30_000;
  assert.equal(readHomeWifiDisplay({ homeWifiPresence: saved }, { now: new Date(clock) }), null);
  failing = false; await publisher.tick();
  assert.deepEqual(remembered, original);
  assert.equal(saved, null);
  assert.equal(publisher.getEvidence(), null);
  publisher.stop();
});
