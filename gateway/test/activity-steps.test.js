'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  COUNTER_MODE_DAILY_RESET,
  COUNTER_MODE_UNVERIFIED,
  localDateKey,
  normalizeActivityObservation,
  reduceActivityDay,
  ActivityStepsStore,
} = require('../src/activity-steps');

function observation(stepsRaw, receivedAt, options = {}) {
  return normalizeActivityObservation(
    { imei: '999999999999999', stepsRaw, command: 'LK' },
    { receivedAt: new Date(receivedAt), timeZone: options.timeZone || 'Indian/Mauritius' },
  );
}

test('Mauritius local date uses the configured timezone at the UTC boundary', () => {
  assert.equal(
    localDateKey(new Date('2026-08-22T20:30:00.000Z'), 'Indian/Mauritius'),
    '2026-08-23',
  );
});

test('invalid counters are rejected before aggregation', () => {
  assert.equal(normalizeActivityObservation({ imei: 'A', stepsRaw: -1 }), null);
  assert.equal(normalizeActivityObservation({ imei: 'A', stepsRaw: 2.5 }), null);
  assert.equal(normalizeActivityObservation({ imei: '', stepsRaw: 10 }), null);
});

test('unverified counter mode records deltas but never exposes a daily total', () => {
  const first = reduceActivityDay(
    null,
    observation(1000, '2026-08-23T05:00:00Z'),
    { counterMode: COUNTER_MODE_UNVERIFIED },
  );
  const second = reduceActivityDay(
    first,
    observation(1250, '2026-08-23T05:10:00Z'),
    { counterMode: COUNTER_MODE_UNVERIFIED },
  );
  assert.equal(second.observedDeltaSteps, 250);
  assert.equal(second.reportedSteps, null);
  assert.equal(second.displayable, false);
  assert.equal(second.quality, 'unverified');
});

test('accepted daily-reset mode preserves the first reading and later deltas', () => {
  const first = reduceActivityDay(
    null,
    observation(1000, '2026-08-23T05:00:00Z'),
    { counterMode: COUNTER_MODE_DAILY_RESET },
  );
  const second = reduceActivityDay(
    first,
    observation(1250, '2026-08-23T05:10:00Z'),
    { counterMode: COUNTER_MODE_DAILY_RESET },
  );
  assert.equal(second.reportedSteps, 1250);
  assert.equal(second.displayable, true);
});

test('same-day counter reset is recovered without losing earlier steps', () => {
  const first = reduceActivityDay(
    null,
    observation(1000, '2026-08-23T05:00:00Z'),
    { counterMode: COUNTER_MODE_DAILY_RESET },
  );
  const afterReset = reduceActivityDay(
    first,
    observation(40, '2026-08-23T05:10:00Z'),
    { counterMode: COUNTER_MODE_DAILY_RESET },
  );
  assert.equal(afterReset.reportedSteps, 1040);
  assert.equal(afterReset.resetCount, 1);
  assert.equal(afterReset.quality, 'reset_recovered');
});

test('implausible jumps fail closed for customer display', () => {
  const first = reduceActivityDay(
    null,
    observation(100, '2026-08-23T05:00:00Z'),
    { counterMode: COUNTER_MODE_DAILY_RESET },
  );
  const jump = reduceActivityDay(
    first,
    observation(10000, '2026-08-23T05:01:00Z'),
    { counterMode: COUNTER_MODE_DAILY_RESET },
  );
  assert.equal(jump.anomalyCount, 1);
  assert.equal(jump.reportedSteps, null);
  assert.equal(jump.displayable, false);
  assert.equal(jump.quality, 'anomalous');
});

test('a counter decrease that does not look like a reset fails closed', () => {
  const first = reduceActivityDay(
    null,
    observation(2000, '2026-08-23T05:00:00Z'),
    { counterMode: COUNTER_MODE_DAILY_RESET },
  );
  const decrease = reduceActivityDay(
    first,
    observation(1800, '2026-08-23T05:10:00Z'),
    { counterMode: COUNTER_MODE_DAILY_RESET },
  );
  assert.equal(decrease.anomalyCount, 1);
  assert.equal(decrease.displayable, false);
  assert.equal(decrease.reportedSteps, null);
});

function fakeDb() {
  const docs = new Map();
  const writes = [];
  const ref = (path) => ({
    path,
    collection(name) {
      return {
        doc(id) { return ref(`${path}/${name}/${id}`); },
      };
    },
    async get() {
      return {
        exists: docs.has(path),
        data: () => docs.get(path),
      };
    },
  });
  return {
    docs,
    writes,
    collection(name) {
      return { doc(id) { return ref(`${name}/${id}`); } };
    },
    batch() {
      const pending = [];
      return {
        set(target, data) { pending.push({ target, data }); },
        async commit() {
          for (const item of pending) {
            docs.set(item.target.path, { ...(docs.get(item.target.path) || {}), ...item.data });
            writes.push(item);
          }
        },
      };
    },
  };
}

test('store is disabled by default and performs no Firestore write', async () => {
  const db = fakeDb();
  const store = new ActivityStepsStore(db);
  const result = await store.ingest(
    { imei: '999999999999999', stepsRaw: 100 },
    new Date('2026-08-23T05:00:00Z'),
  );
  assert.equal(result.status, 'disabled');
  assert.equal(db.writes.length, 0);
});

test('store writes only the protected daily document', async () => {
  const db = fakeDb();
  const store = new ActivityStepsStore(db, {
    enabled: true,
    counterMode: COUNTER_MODE_DAILY_RESET,
    writeIntervalMinutes: 15,
  });
  const result = await store.ingest(
    { imei: '999999999999999', stepsRaw: 100 },
    new Date('2026-08-23T05:00:00Z'),
  );
  assert.equal(result.status, 'stored');
  assert.equal(db.writes.length, 1);
  assert.equal(
    db.docs.get('devices/999999999999999/activityDays/2026-08-23').reportedSteps,
    100,
  );
  assert.equal(db.docs.get('devices/999999999999999'), undefined);
});

test('unchanged counters are write-throttled while retaining in-memory freshness', async () => {
  const db = fakeDb();
  const store = new ActivityStepsStore(db, {
    enabled: true,
    counterMode: COUNTER_MODE_DAILY_RESET,
    writeIntervalMinutes: 15,
  });
  await store.ingest(
    { imei: '999999999999999', stepsRaw: 100 },
    new Date('2026-08-23T05:00:00Z'),
  );
  const duplicate = await store.ingest(
    { imei: '999999999999999', stepsRaw: 100 },
    new Date('2026-08-23T05:05:00Z'),
  );
  assert.equal(duplicate.status, 'deduplicated');
  assert.equal(db.writes.length, 1);
});

test('out-of-order observations cannot inflate or reset an accepted day', async () => {
  const db = fakeDb();
  const store = new ActivityStepsStore(db, {
    enabled: true,
    counterMode: COUNTER_MODE_DAILY_RESET,
  });
  await store.ingest(
    { imei: '999999999999999', stepsRaw: 500 },
    new Date('2026-08-23T05:10:00Z'),
  );
  const stale = await store.ingest(
    { imei: '999999999999999', stepsRaw: 20 },
    new Date('2026-08-23T05:05:00Z'),
  );
  assert.equal(stale.status, 'ignored_stale');
  assert.equal(stale.day.reportedSteps, 500);
  assert.equal(stale.day.resetCount, 0);
  assert.equal(db.writes.length, 1);
});
