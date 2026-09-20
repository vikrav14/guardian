'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDailyWellnessScheduler, parseDailyRoutine, localDate, slotFor } = require('../src/daily-wellness-scheduler');

const START = +new Date('2026-09-17T04:00:20Z'); // Mauritius 08:00:20.
function request(overrides = {}) {
  return { version: 2, routine: 'gentle', times: ['08:00', '20:00'], timeZone: 'Indian/Mauritius',
    requestedBy: 'pilot-user', updatedAt: new Date('2026-09-16T12:00:00Z'), ...overrides };
}
function fixture() {
  const f = { at: START, records: new Map(), executions: [], claims: [], saves: [],
    context: { request: request(), enabled: true, authorized: true, connected: true }, statusValue: null };
  f.context.revision = f.context.request.updatedAt.toISOString();
  f.build = () => createDailyWellnessScheduler({ clock: () => f.at,
    read: async () => { f.reads = (f.reads || 0) + 1; f.onRead?.(f.reads); return f.noContext ? null : f.context; },
    claim: async input => {
      f.claims.push(input); await f.onClaim?.(input);
      if (f.claimResult) return f.claimResult;
      if (f.records.has(input.slotId)) return { claimed: false, record: f.records.get(input.slotId) };
      const record = { ...input, phase: input.disposition === 'attempt' ? 'dispatch_pending' : 'finished',
        outcome: input.disposition === 'attempt' ? 'dispatch_pending' : 'skipped',
        terminal: input.disposition !== 'attempt', activeUntil: new Date(+input.scheduledAt + 300_000) };
      f.records.set(input.slotId, record); f.context.lastAttempt = record;
      return { claimed: true, record };
    },
    save: async record => { f.saves.push(record); f.records.set(record.slotId, record); f.context.lastAttempt = record; return { saved: true }; },
    execute: async slot => { f.executions.push(slot); if (f.executeError) throw new Error('response lost');
      return { outcome: 'optical_request_handed_off', attemptId: `attempt-${slot.slotId}` }; },
    status: async () => f.statusValue,
  });
  f.scheduler = f.build();
  return f;
}

test('v2 parser requires exact preset counts, ordered real clock times and five-minute circular spacing', () => {
  assert.ok(parseDailyRoutine(request()));
  assert.ok(parseDailyRoutine(request({ routine: 'manual', times: [] })));
  assert.ok(parseDailyRoutine(request({ routine: 'balanced', times: ['08:00', '08:05', '20:00'] })));
  for (const overrides of [{ version: 1 }, { routine: 'other' }, { routine: 'manual' },
    { times: ['08:00'] }, { times: ['20:00', '08:00'] }, { times: ['08:00', '08:00'] },
    { times: ['08:00', '08:04'] }, { times: ['00:03', '23:59'] },
    { times: ['08:00\n', '20:00'] }, { times: ['24:00', '20:00'] },
    { times: ['8:00', '20:00'] }, { timeZone: 'UTC' }, { updatedAt: new Date(NaN) },
    { requestedBy: '' }, { requestedBy: 'bad/path' }, { command: 'arbitrary' }]) {
    assert.equal(parseDailyRoutine(request(overrides)), null, JSON.stringify(overrides));
  }
  const stamp = { toDate: () => new Date('2026-09-16T12:00:00Z') };
  assert.ok(parseDailyRoutine(request({ updatedAt: stamp, revision: 'derived' })));
});

test('Mauritius day and next check roll over independently of UTC midnight', async () => {
  assert.equal(localDate(new Date('2026-09-17T20:00:00Z')), '2026-09-18');
  const f = fixture(); f.at = +new Date('2026-09-17T19:59:59Z');
  await f.scheduler.tick();
  assert.equal(f.scheduler.snapshot().nextCheckAt.toISOString(), '2026-09-18T04:00:00.000Z');
  assert.equal(f.executions.length, 0); // Late slots are missed, never caught up.
});

test('one due slot is durably claimed before one execution; concurrent ticks serialize', async () => {
  const f = fixture();
  await Promise.all([f.scheduler.tick(), f.scheduler.tick(), f.scheduler.tick()]);
  assert.equal(f.claims.length, 1); assert.equal(f.executions.length, 1);
  assert.equal(f.claims[0].slotId, '2026-09-17-0800');
  assert.ok(f.records.has(f.executions[0].slotId));
  assert.equal(f.scheduler.snapshot().phase, 'running');
  assert.equal(f.scheduler.snapshot().nextCheckAt.toISOString(), '2026-09-17T16:00:00.000Z');
  await f.scheduler.tick(); assert.equal(f.executions.length, 1);
});

test('restart and same-time schedule edits do not execute an existing slot again', async () => {
  const f = fixture(); await f.scheduler.tick();
  f.scheduler = f.build(); await f.scheduler.tick();
  assert.equal(f.executions.length, 1);
  f.context.request = request({ updatedAt: new Date('2026-09-17T03:59:50Z') });
  f.context.revision = f.context.request.updatedAt.toISOString();
  f.scheduler = f.build(); await f.scheduler.tick();
  assert.equal(f.executions.length, 1);
});

test('new schedules ignore clock slots before the selection existed', async () => {
  const f = fixture(); f.context.request = request({ updatedAt: new Date('2026-09-17T04:00:01Z') });
  f.context.revision = f.context.request.updatedAt.toISOString();
  await f.scheduler.tick();
  assert.equal(f.claims.length, 0); assert.equal(f.executions.length, 0);
  assert.equal(f.scheduler.snapshot().lastAttempt, null);
});

test('past due slots after selection are recorded as missed, including exactly sixty seconds late', async () => {
  const f = fixture(); f.at = +new Date('2026-09-17T04:01:00Z');
  await f.scheduler.tick();
  assert.equal(f.claims[0].disposition, 'skipped'); assert.equal(f.claims[0].reason, 'missed');
  assert.equal(f.executions.length, 0);
  assert.equal(f.scheduler.snapshot().lastAttempt.outcome, 'skipped');
});

test('offline and authorization blocks record a skipped slot instead of queueing for reconnection', async () => {
  for (const change of [f => { f.context.connected = false; }, f => { f.context.authorized = false; },
    f => { f.context.enabled = false; }, f => { f.context.blockedReason = 'diagnostic_quarantine_active'; }]) {
    const f = fixture(); change(f); await f.scheduler.tick();
    assert.equal(f.claims[0].disposition, 'skipped'); assert.equal(f.executions.length, 0);
    f.context.connected = true; f.context.authorized = true; f.context.enabled = true; delete f.context.blockedReason;
    await f.scheduler.tick(); assert.equal(f.executions.length, 0);
  }
});

test('claim transaction latency and a post-claim revision change prevent dispatch', async () => {
  for (const change of [f => { f.at += 60_000; }, f => { f.context.revision = 'new-revision'; },
    f => { f.context.authorized = false; }]) {
    const f = fixture(); f.onClaim = () => change(f); await f.scheduler.tick();
    assert.equal(f.executions.length, 0);
    assert.equal(f.scheduler.snapshot().lastAttempt.outcome, 'skipped');
  }
});

test('store budget or reservation rejection keeps its terminal skip metadata', async () => {
  for (const reason of ['daily_attempt_limit', 'previous_attempt_reserved']) {
    const f = fixture(); f.claimResult = { claimed: true, record: { ...slotFor('2026-09-17', '08:00'),
      terminal: true, phase: 'finished', outcome: 'skipped', reason } };
    await f.scheduler.tick(); assert.equal(f.executions.length, 0);
    assert.equal(f.scheduler.snapshot().lastAttempt.outcome, 'skipped');
    assert.equal(f.scheduler.snapshot().lastAttempt.reason, reason);
    assert.equal(f.scheduler.snapshot().lastAttempt.terminal, true);
  }
});

test('ambiguous execution consumes the recorded slot with no automatic retry', async () => {
  const f = fixture(); f.executeError = true; await f.scheduler.tick();
  assert.equal(f.scheduler.snapshot().lastAttempt.outcome, 'handoff_unknown');
  f.scheduler = f.build(); await f.scheduler.tick(); assert.equal(f.executions.length, 1);
});

test('matching sequence completion updates history without claiming wearing', async () => {
  const f = fixture(); await f.scheduler.tick();
  f.statusValue = { sequence: { attemptId: f.context.lastAttempt.attemptId, terminal: true,
    outcome: 'temperature_upload_observed', temperature: { trialId: 'temperature-one' } } };
  await f.scheduler.tick();
  const snapshot = f.scheduler.snapshot();
  assert.equal(snapshot.lastAttempt.terminal, true);
  assert.equal(snapshot.lastAttempt.temperatureRequested, true);
  assert.equal(snapshot.inFlight, false);
  assert.equal('wearingConfirmed' in snapshot.lastAttempt, false);
});

test('abandoned claimed dispatch on restart is marked unknown and is never resent', async () => {
  const f = fixture();
  const prior = { ...slotFor('2026-09-17', '08:00'), revision: f.context.revision,
    phase: 'dispatch_pending', terminal: false, attemptId: null, activeUntil: new Date(START + 200_000) };
  f.context.lastAttempt = prior; f.records.set(prior.slotId, prior);
  await f.scheduler.tick();
  assert.equal(f.executions.length, 0);
  assert.equal(f.scheduler.snapshot().lastAttempt.outcome, 'interrupted_unknown');
});

test('an active attempt prevents a second dispatch and mismatched status never completes it', async () => {
  const f = fixture();
  f.context.request = request({ times: ['08:00', '08:05'] });
  await f.scheduler.tick();
  f.statusValue = { sequence: { attemptId: 'unrelated', terminal: true } };
  f.at += 1000; await f.scheduler.tick();
  assert.equal(f.scheduler.snapshot().inFlight, true);
  assert.equal(f.executions.length, 1);
});

test('manual, legacy and absent lease contexts expose honest state without dispatch', async () => {
  const f = fixture(); f.context.request = request({ routine: 'manual', times: [] });
  f.context.blockedReason = 'native_schedule_stop_pending'; await f.scheduler.tick();
  assert.equal(f.scheduler.snapshot().phase, 'blocked');
  assert.equal(f.scheduler.snapshot().reason, 'native_schedule_stop_pending');
  f.context.request = { version: 1, routine: 'gentle' }; f.context.blockedReason = 'legacy_routine_requires_times';
  await f.scheduler.tick(); assert.equal(f.scheduler.snapshot().reason, 'legacy_routine_requires_times');
  f.noContext = true; await f.scheduler.tick(); assert.equal(f.claims.length, 0);
});

test('future request timestamp and mismatched canonical revision block scheduling', async () => {
  for (const change of [f => { f.context.request.updatedAt = new Date(START + 1000); },
    f => { f.context.revision = 'wrong'; }]) {
    const f = fixture(); change(f); await f.scheduler.tick(); assert.equal(f.claims.length, 0);
    assert.equal(f.executions.length, 0);
  }
});
