'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ActivityStepsStore, normalizeActivityObservation } = require('../src/activity-steps');
const { reduceCounterLedger, deleteExpiredActivityIntervals } = require('../src/activity-counter-ledger');
const { loadActivityReport } = require('../scripts/inspect-activity-counter');
const { summarizeActivityDay } = require('../src/activity-counter-diagnostics');

const imei = '999999999999999';
function replay(samples, options = {}) {
  let state = null;
  const days = new Map(), intervals = [];
  for (const [raw, at] of samples) {
    const observation = normalizeActivityObservation({ imei, stepsRaw: raw, command: 'LK' }, { receivedAt: new Date(at) });
    const result = reduceCounterLedger(state, days.get(observation.localDate), observation, options);
    if (result.status !== 'stored') continue;
    state = result.state; days.set(observation.localDate, result.day); intervals.push(result.interval);
  }
  return { state, days, intervals, today: [...days.values()].at(-1) };
}

test('first counter is a baseline and the controlled 98-step increase is counted exactly', () => {
  const result = replay([[15624, '2026-09-14T17:20:00Z'], [15722, '2026-09-14T17:25:00Z']]);
  assert.equal(result.today.recordedSteps, 98);
  assert.equal(result.today.reportedSteps, null);
  assert.equal(result.today.displayable, false);
  assert.equal(result.today.coverage, 'partial');
});

test('Mauritius midnight carries a stable baseline and never copies the running total into today', () => {
  const result = replay([[19900, '2026-09-14T19:50:00Z'], [20000, '2026-09-14T19:59:00Z'],
    [20000, '2026-09-14T20:01:00Z'], [20098, '2026-09-14T20:06:00Z']]);
  assert.equal(result.days.get('2026-09-14').recordedSteps, 100);
  assert.equal(result.today.recordedSteps, 98);
  assert.equal(result.today.unallocatedSteps, 0);
});

test('an increase straddling midnight is retained separately and never guessed into either day', () => {
  const result = replay([[20000, '2026-09-14T19:55:00Z'], [20098, '2026-09-14T20:05:00Z'],
    [20110, '2026-09-14T20:10:00Z']]);
  assert.equal(result.days.get('2026-09-14').recordedSteps, 0);
  assert.equal(result.today.recordedSteps, 12);
  assert.equal(result.today.unallocatedSteps, 98);
  assert.equal(result.intervals[1].reason, 'cross_midnight_unallocated');
});

test('reset detection preserves earlier steps and waits for a stable new baseline', () => {
  const result = replay([[1000, '2026-09-14T17:00:00Z'], [1098, '2026-09-14T17:05:00Z'],
    [0, '2026-09-14T17:10:00Z'], [0, '2026-09-14T17:11:00Z'], [25, '2026-09-14T17:15:00Z']]);
  assert.equal(result.today.recordedSteps, 123);
  assert.equal(result.today.resetCount, 1);
  assert.equal(result.today.confirmedResetCount, 1);
  assert.equal(result.state.segment, 2);
});

test('a midnight reset does not seed today from an unproven reset value', () => {
  const result = replay([[5000, '2026-09-14T19:59:00Z'], [20, '2026-09-14T20:01:00Z'],
    [20, '2026-09-14T20:02:00Z'], [118, '2026-09-14T20:06:00Z']]);
  assert.equal(result.today.recordedSteps, 98);
  assert.equal(result.today.resetCount, 1);
  assert.ok(result.today.coverageReasons.includes('counter_discontinuity'));
});

test('a late low counter followed by a rebound cannot fabricate steps', () => {
  const result = replay([[1000, '2026-09-14T17:00:00Z'], [900, '2026-09-14T17:01:00Z'],
    [1000, '2026-09-14T17:02:00Z'], [1000, '2026-09-14T17:03:00Z']]);
  assert.equal(result.today.recordedSteps, 0);
  assert.equal(result.state.segment, 1);
  assert.equal(result.intervals[2].reason, 'discontinuity_rebounded');
});

test('spikes and long silent periods never become confident activity or inactivity', () => {
  const spike = replay([[100, '2026-09-14T17:00:00Z'], [10000, '2026-09-14T17:01:00Z'],
    [10000, '2026-09-14T17:02:00Z'], [10010, '2026-09-14T17:03:00Z']]);
  assert.equal(spike.today.recordedSteps, 10);
  assert.equal(spike.today.anomalyCount, 1);
  const gap = replay([[100, '2026-09-14T17:00:00Z'], [198, '2026-09-14T19:00:00Z']]);
  assert.equal(gap.today.recordedSteps, 0);
  assert.equal(gap.today.unallocatedSteps, 98);
  assert.equal(gap.today.gapCount, 1);
  const still = replay([[100, '2026-09-14T17:00:00Z'], [100, '2026-09-14T19:00:00Z']]);
  assert.equal(still.today.coverage, 'partial');
  assert.equal(still.today.gapCount, 1);
});

test('customer visibility applies only to observed-delta estimates and retains partial coverage', () => {
  for (const mode of ['unverified', 'observed_delta']) for (const customerEnabled of [false, true]) {
    const result = replay([[100, '2026-09-14T17:00:00Z'], [198, '2026-09-14T17:05:00Z']],
      { counterMode: mode, customerEnabled });
    assert.equal(result.today.displayable, mode === 'observed_delta' && customerEnabled);
    assert.equal(result.today.reportedSteps, result.today.displayable ? 98 : null);
    assert.equal(result.today.coverage, 'partial');
  }
});

// Atomic test double with serialized commits; actual cross-process transaction
// contention and client authorization also run in the Firestore emulator suite.
function database() {
  const docs = new Map(); let tail = Promise.resolve();
  const db = { docs, fail: false, commits: 0,
    collection: path => reference(path),
    runTransaction: callback => {
      const task = tail.catch(() => {}).then(async () => {
        const writes = [];
        const result = await callback({ get: ref => ref.get(), set: (ref, data) => writes.push([ref.path, data]) });
        if (db.fail) { db.fail = false; throw new Error('fixture commit failed'); }
        for (const [path, data] of writes) docs.set(path, structuredClone(data));
        if (writes.length) db.commits++;
        return result;
      });
      tail = task;
      return task;
    },
  };
  const reference = path => ({ path, collection: name => reference(`${path}/${name}`),
    doc: name => reference(`${path}/${name}`),
    orderBy: () => reference(path), limit: () => reference(path),
    get: async () => ({ exists: docs.has(path), data: () => structuredClone(docs.get(path)),
      docs: [...docs].filter(([key]) => key.startsWith(path + '/')).map(([, value]) => ({ data: () => value })) }),
  });
  return db;
}
const store = db => new ActivityStepsStore(db, { enabled: true });
const ingest = (instance, raw, at) => instance.ingest({ imei, stepsRaw: raw }, new Date(at));

test('restart and duplicate replay preserve an atomic baseline/day/interval without double counting', async () => {
  const db = database();
  await ingest(store(db), 20000, '2026-09-14T19:59:00Z');
  await ingest(store(db), 20000, '2026-09-14T20:01:00Z');
  const result = await ingest(store(db), 20098, '2026-09-14T20:06:00Z');
  assert.equal(result.day.recordedSteps, 98);
  assert.equal((await ingest(store(db), 20098, '2026-09-14T20:06:00Z')).status, 'ignored_stale');
  assert.equal((await ingest(store(db), 20098, '2026-09-14T20:07:00Z')).status, 'deduplicated');
  assert.equal(db.commits, 3);
});

test('a failed commit advances nothing and retry records the increase once', async () => {
  const db = database();
  await ingest(store(db), 1000, '2026-09-14T17:00:00Z');
  const before = structuredClone([...db.docs]); db.fail = true;
  await assert.rejects(ingest(store(db), 1098, '2026-09-14T17:05:00Z'), /commit failed/);
  assert.deepEqual([...db.docs], before);
  assert.equal((await ingest(store(db), 1098, '2026-09-14T17:05:00Z')).day.recordedSteps, 98);
});

test('pending resets survive restart; concurrent stores cannot double-credit one observation', async () => {
  const db = database();
  await ingest(store(db), 1000, '2026-09-14T17:00:00Z');
  await ingest(store(db), 0, '2026-09-14T17:05:00Z');
  await ingest(store(db), 0, '2026-09-14T17:06:00Z');
  const results = await Promise.all([store(db), store(db)].map(instance => ingest(instance, 98, '2026-09-14T17:10:00Z')));
  assert.deepEqual(results.map(result => result.status).sort(), ['ignored_stale', 'stored']);
  assert.equal(results[0].day.recordedSteps, 98);
});

test('historical/future device timestamps are excluded and cannot move the baseline', async () => {
  const db = database();
  for (const at of ['2026-09-13T17:00:00Z', '2026-09-14T18:00:00Z']) {
    assert.equal((await store(db).ingest({ imei, stepsRaw: 1000, location: { recordedAt: at } },
      new Date('2026-09-14T17:00:00Z'))).status, 'ignored_invalid');
  }
  assert.equal(db.commits, 0);
});

test('pilot report exposes bounded diagnostic totals and no identity or health values', async () => {
  const db = database();
  await ingest(store(db), 1000, '2026-09-14T17:00:00Z');
  await ingest(store(db), 1098, '2026-09-14T17:05:00Z');
  const report = await loadActivityReport(db, imei, {}, new Date('2026-09-14T17:06:00Z'));
  assert.equal(report.persistedGatewayState.schemaVersion, 2);
  assert.equal(report.days[0].recordedSteps, 98);
  assert.equal(report.days[0].reportedSteps, null);
  assert.doesNotMatch(JSON.stringify(report), /999999999999999|heartRate|latitude|secret/);
  assert.equal(summarizeActivityDay({ schemaVersion: 1, observedDeltaSteps: 300 }).recordedSteps, null);
});

test('raw intervals expire independently of retained Care daily totals', async () => {
  const deleted = [], calls = [];
  const db = { collectionGroup: name => { calls.push(name); return {
    where: (...args) => { calls.push(args); return { limit: () => ({ get: async () => ({ docs: [{ ref: 'expired' }] }) }) }; },
  }; }, batch: () => ({ delete: ref => deleted.push(ref), commit: async () => {} }) };
  const now = new Date('2026-09-22T00:00:00Z');
  assert.equal(await deleteExpiredActivityIntervals(db, now), 1);
  assert.deepEqual(deleted, ['expired']);
  assert.deepEqual(calls, ['activityIntervals', ['expiresAt', '<=', now]]);
});

test('recent interval storage stays bounded while daily totals continue accumulating', async () => {
  const db = database();
  const instance = store(db);
  const start = Date.parse('2026-09-14T10:00:00Z');
  for (let i = 0; i <= 270; i++) await ingest(instance, 1000 + i, new Date(start + i * 60_000));
  const intervals = [...db.docs].filter(([path]) => path.includes('/activityIntervals/'));
  assert.equal(intervals.length, 256);
  assert.equal(db.docs.get(`devices/${imei}/activityDays/2026-09-14`).recordedSteps, 270);
});

test('a repeated timestamped location cannot be reinterpreted as a new reset', async () => {
  const db = database();
  const event = { imei, stepsRaw: 1000, location: { recordedAt: new Date('2026-09-14T17:00:00Z') } };
  await store(db).ingest(event, new Date('2026-09-14T17:00:02Z'));
  assert.equal((await store(db).ingest({ ...event, stepsRaw: 0 }, new Date('2026-09-14T17:01:00Z'))).status, 'ignored_stale');
  assert.equal(db.docs.get(`devices/${imei}/activityState/counter`).lastRaw, 1000);
});
