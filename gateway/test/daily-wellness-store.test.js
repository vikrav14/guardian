'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDailyWellnessStore, RETENTION_MS } = require('../src/daily-wellness-store');
const { slotFor } = require('../src/daily-wellness-scheduler');

function fakeDb() {
  const data = new Map(); let transaction = Promise.resolve();
  function ref(path) {
    return { path, collection: name => collection(`${path}/${name}`),
      get: async () => snapshot(path) };
  }
  function collection(path) { return { doc: id => ref(`${path}/${id}`) }; }
  function snapshot(path) { return { exists: data.has(path), data: () => structuredClone(data.get(path)) }; }
  return { data, collection,
    runTransaction(run) {
      const result = transaction.then(async () => {
        const writes = [];
        const result = await run({ get: async item => snapshot(item.path),
          set: (item, value, options) => writes.push([item.path, structuredClone(value), options]) });
        for (const [path, value, options] of writes) data.set(path, options?.merge ? { ...data.get(path), ...value } : value);
        return result;
      });
      transaction = result.catch(() => {}); return result;
    } };
}
function fixture() {
  const f = { at: +new Date('2026-09-17T04:00:20Z'), owner: 'owner-one', imei: '123456789012345', db: fakeDb() };
  f.requestPath = `wellnessRoutineRequests/${f.imei}`;
  f.statePath = `devices/${f.imei}/wellnessRoutine/current`;
  f.dayPath = date => `devices/${f.imei}/wellnessScheduleDays/${date}`;
  f.slotPath = id => `devices/${f.imei}/wellnessScheduleSlots/${id}`;
  f.setRequest = overrides => {
    f.request = { version: 2, routine: 'gentle', times: ['08:00', '20:00'], timeZone: 'Indian/Mauritius',
      requestedBy: 'pilot-user', updatedAt: new Date('2026-09-16T12:00:00Z'), ...overrides };
    f.db.data.set(f.requestPath, structuredClone(f.request));
  };
  f.setRequest();
  f.renew = () => f.db.data.set(f.statePath, { ...f.db.data.get(f.statePath), leaseOwner: f.owner, leaseUntil: new Date(f.at + 60_000) });
  f.renew();
  f.build = () => createDailyWellnessStore({ db: f.db, imei: f.imei, owner: f.owner, clock: () => f.at });
  f.store = f.build();
  f.input = (time = '08:00', overrides = {}) => ({ ...slotFor('2026-09-17', time),
    revision: f.request.updatedAt.toISOString(), requestUpdatedAt: f.request.updatedAt,
    maxAttempts: f.request.times.length, disposition: 'attempt', ...overrides });
  return f;
}

test('atomic claim consumes one daily attempt and duplicate concurrent/restarted claims cannot repeat', async () => {
  const f = fixture();
  const results = await Promise.all([f.store.claim(f.input()), f.store.claim(f.input())]);
  assert.equal(results.filter(value => value.claimed).length, 1);
  assert.equal(f.db.data.get(f.dayPath('2026-09-17')).attempts, 1);
  assert.equal((await f.build().claim(f.input())).claimed, false);
  const record = await f.store.readLatest();
  assert.equal(record.slotId, '2026-09-17-0800');
  assert.equal(+record.expiresAt, f.at + RETENTION_MS);
});

test('a clock slot ID is independent of request revision and survives schedule edits', async () => {
  const f = fixture(); await f.store.claim(f.input());
  f.setRequest({ updatedAt: new Date('2026-09-17T03:59:50Z') });
  const result = await f.store.claim(f.input());
  assert.equal(result.claimed, false); assert.equal(result.reason, 'slot_already_recorded');
  assert.equal(f.db.data.get(f.dayPath('2026-09-17')).attempts, 1);
});

test('daily budget cannot be reset by changing selected times or presets', async () => {
  const f = fixture(); f.setRequest({ routine: 'balanced', times: ['08:00', '08:05', '08:10'] });
  for (const time of f.request.times) {
    f.at = +slotFor('2026-09-17', time).scheduledAt + 20_000; f.renew();
    assert.equal((await f.store.claim(f.input(time))).record.attemptConsumed, true);
  }
  f.at = +slotFor('2026-09-17', '08:15').scheduledAt + 20_000; f.renew();
  f.setRequest({ routine: 'balanced', times: ['08:15', '08:20', '20:00'], updatedAt: new Date('2026-09-17T04:14:00Z') });
  const result = await f.store.claim(f.input('08:15'));
  assert.equal(result.record.reason, 'daily_attempt_limit');
  assert.equal(result.record.attemptConsumed, false);
  assert.equal(f.db.data.get(f.dayPath('2026-09-17')).attempts, 3);
});

test('Gentle allows at most two attempted slots even after changing times', async () => {
  const f = fixture(); f.setRequest({ times: ['08:00', '08:05'] });
  await f.store.claim(f.input()); f.at += 300_000; f.renew(); await f.store.claim(f.input('08:05'));
  f.at += 300_000; f.renew(); f.setRequest({ times: ['08:10', '20:00'], updatedAt: new Date('2026-09-17T04:09:00Z') });
  const result = await f.store.claim(f.input('08:10'));
  assert.equal(result.record.reason, 'daily_attempt_limit');
});

test('offline/missed skips before an attempted claim do not consume the daily budget', async () => {
  const f = fixture();
  const result = await f.store.claim(f.input('08:00', { disposition: 'skipped', reason: 'watch_offline' }));
  assert.equal(result.record.terminal, true);
  assert.equal(result.record.attemptConsumed, false);
  assert.equal(f.db.data.get(f.dayPath('2026-09-17')).attempts, 0);
  assert.equal(f.db.data.get(f.statePath).dailyActiveUntil, undefined);
});

test('fresh transaction time converts a late due request into skipped rather than dispatch', async () => {
  const f = fixture(), input = f.input(); f.at += 60_000; f.renew();
  const result = await f.store.claim(input);
  assert.equal(result.record.reason, 'missed');
  assert.equal(result.record.attemptConsumed, false);
});

test('atomic claim rereads request revision and lease before accepting a slot', async () => {
  for (const change of [f => { f.setRequest({ updatedAt: new Date('2026-09-17T03:59:00Z') }); },
    f => { f.db.data.get(f.statePath).leaseOwner = 'other-owner'; },
    f => { f.db.data.get(f.statePath).leaseUntil = new Date(f.at); }]) {
    const f = fixture(), input = f.input(); change(f);
    assert.equal((await f.store.claim(input)).claimed, false);
    assert.equal(f.db.data.has(f.slotPath(input.slotId)), false);
  }
});

test('future slots, previous local days and inconsistent slot metadata are rejected', async () => {
  const f = fixture();
  assert.equal((await f.store.claim(f.input('20:00'))).reason, 'slot_not_due');
  const old = { ...slotFor('2026-09-16', '08:00'), revision: f.request.updatedAt.toISOString(),
    requestUpdatedAt: f.request.updatedAt, maxAttempts: 2, disposition: 'attempt' };
  assert.equal((await f.store.claim(old)).reason, 'slot_not_due');
  await assert.rejects(() => f.store.claim(f.input('08:00', { slotId: '2026-09-17-0805' })));
});

test('five-minute valid spacing stays usable despite twenty-second poll offset', async () => {
  const f = fixture(); f.setRequest({ times: ['08:00', '08:05'] });
  const first = await f.store.claim(f.input());
  assert.equal(first.record.activeUntil.toISOString(), '2026-09-17T04:05:00.000Z');
  f.at = +new Date('2026-09-17T04:05:00Z'); f.renew();
  assert.equal((await f.store.claim(f.input('08:05'))).record.attemptConsumed, true);
});

test('a persisted overlapping reservation blocks a new attempt after restart', async () => {
  const f = fixture(); f.db.data.get(f.statePath).dailyActiveSlot = 'prior-slot';
  f.db.data.get(f.statePath).dailyActiveUntil = new Date(f.at + 1000);
  const result = await f.build().claim(f.input());
  assert.equal(result.record.reason, 'previous_attempt_reserved');
  assert.equal(result.record.attemptConsumed, false);
});

test('safe checkpoints persist outcome and never store health values or release a consumed attempt', async () => {
  const f = fixture(); const claim = await f.store.claim(f.input());
  const result = await f.store.save({ ...claim.record, phase: 'finished', outcome: 'handoff_unknown',
    terminal: true, finishedAt: new Date(f.at), values: { heartRateBpm: 70 }, args: ['private'], attemptConsumed: false });
  assert.equal(result.saved, true);
  assert.equal(result.record.attemptConsumed, true);
  assert.equal('values' in result.record, false); assert.equal('args' in result.record, false);
  assert.equal(f.db.data.get(f.dayPath('2026-09-17')).attempts, 1);
  assert.equal((await f.store.readLatest()).outcome, 'handoff_unknown');
});

test('an old owner or mismatched slot revision cannot overwrite checkpoint state', async () => {
  const f = fixture(); const claim = await f.store.claim(f.input());
  assert.equal((await f.store.save({ ...claim.record, revision: 'wrong' })).reason, 'slot_revision_mismatch');
  f.db.data.get(f.statePath).leaseOwner = 'other-owner';
  assert.equal((await f.store.save(claim.record)).reason, 'schedule_lease_lost');
});

test('a new Mauritius day has a separate attempt budget', async () => {
  const f = fixture(); await f.store.claim(f.input());
  f.at += 86400_000; f.renew();
  const next = { ...f.input(), ...slotFor('2026-09-18', '08:00') };
  assert.equal((await f.store.claim(next)).record.attemptConsumed, true);
  assert.equal(f.db.data.get(f.dayPath('2026-09-18')).attempts, 1);
});

test('invalid persisted daily count fails closed rather than resetting the budget', async () => {
  const f = fixture(); f.db.data.set(f.dayPath('2026-09-17'), { attempts: 'invalid' });
  assert.equal((await f.store.claim(f.input())).reason, 'daily_ledger_invalid');
});
