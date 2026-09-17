'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createConditionalWellnessTrial } = require('../src/conditional-wellness-trial');
const { createSupervisedTemperatureTrial } = require('../src/supervised-temperature-trial');

const AT = Date.parse('2026-09-17T16:00:00Z');
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

// Exercise the real two stages together; only the schedule authorization,
// database reads, clock and downlink are supplied by this fixture.
function fixture() {
  const f = { now: AT, sent: [], current: true, guardCalls: 0,
    suppressed: false, resumeCalls: 0, beforeRead: null, beforeGuard: null,
    config: { wifiHomePilotImei: '111111111111111', wellnessRoutinePilotEnabled: true,
      careWellbeingRequestEnabled: true, careWellbeingIngestEnabled: true },
    session: { imei: '111111111111111', protocolId: '1111111111', lastPacketAt: AT },
    context: { consent: { version: 1, status: 'granted', managedBy: 'guardian_admin',
      wearerAcknowledgedAt: new Date(AT - 60_000), expiresAt: new Date(AT + 3600_000) },
      request: { version: 2, routine: 'balanced' }, state: {} },
  };
  const readContext = async () => { await f.beforeRead?.(); return f.context; };
  const currentSession = () => f.session;
  const send = command => { f.sent.push(command); return { ok: true }; };
  f.temperature = createSupervisedTemperatureTrial({ config: f.config, clock: () => f.now,
    currentSession, readContext, send,
    quarantineStore: { isSuppressed: () => f.suppressed,
      suppress: () => { f.suppressed = true; }, resume: () => { f.resumeCalls++; f.suppressed = false; } },
  });
  f.sequence = createConditionalWellnessTrial({ config: f.config, clock: () => f.now,
    currentSession, readContext, sendOptical: send, temperatureTrial: f.temperature });
  f.isCurrent = async () => { f.guardCalls++; await f.beforeGuard?.(); return f.current; };
  f.start = overrides => f.sequence.requestScheduled({ isCurrent: f.isCurrent,
    startDeadlineAt: AT + 60_000, ...overrides });
  f.frame = (command, args) => ({ command, args, payload: [command, ...args].join(','), imei: f.session.protocolId });
  f.observe = (command, args) => f.sequence.observe(f.frame(command, args), f.session);
  f.pair = async () => {
    f.observe('bphrt', ['101', '61', '71', '', '', '', '']);
    f.observe('oxygen', ['1', '98']);
    await flush();
  };
  f.advance = milliseconds => { f.now += milliseconds; if (f.session) f.session.lastPacketAt = f.now; };
  return f;
}

test('trusted daily sequence uses both stages while retaining unknown scheduled position', async () => {
  const f = fixture();
  const requested = await f.start();
  assert.equal(requested.operatorPosition, 'unknown');
  assert.equal(requested.positionBasis, 'scheduled');
  f.advance(41_000);
  await f.pair();
  assert.deepEqual(f.sent, ['hrtstart,1', 'BODYTEMP2']);
  assert.equal(f.guardCalls, 2, 'current schedule is checked before each command');
  assert.equal(f.resumeCalls, 0, 'scheduling cannot perform supervised quarantine cleanup');
  const status = await f.sequence.status();
  assert.equal(status.sequence.operatorPosition, 'unknown');
  assert.equal(status.sequence.positionBasis, 'scheduled');
  const evidence = status.sequence.temperature.trial;
  assert.equal(evidence.operatorPosition, 'unknown');
  assert.equal(evidence.positionBasis, 'scheduled');
  assert.equal(evidence.operatorPositionIsManual, false);
  assert.equal(evidence.wearingConfirmed, false);
  assert.equal(evidence.measurementConfirmed, false);
});

test('scheduled zero response skips temperature without asserting removed or worn', async () => {
  const f = fixture(); await f.start(); f.advance(41_000);
  f.observe('bphrt', ['0', '0', '0', '', '', '', '']);
  f.observe('oxygen', ['1', '98']); await flush();
  const status = (await f.sequence.status()).sequence;
  assert.deepEqual(f.sent, ['hrtstart,1']);
  assert.equal(status.reason, 'unusable_heart_bp');
  assert.equal(status.operatorPosition, 'unknown');
  assert.equal(status.positionBasis, 'scheduled');
  assert.equal(status.wearingConfirmed, false);
});

test('public requests cannot spoof scheduled position or bypass the Manual requirement', async () => {
  const f = fixture();
  for (const payload of [
    { action: 'single', operatorPosition: 'unknown' },
    { action: 'single', operatorPosition: 'worn', positionBasis: 'scheduled' },
    { action: 'single', operatorPosition: 'worn', isCurrent: () => true },
    { action: 'single', operatorPosition: 'worn' },
  ]) {
    await assert.rejects(f.sequence.request(payload));
    await assert.rejects(f.temperature.request(payload));
  }
  await assert.rejects(f.sequence.requestScheduled({ startDeadlineAt: AT + 60_000 }));
  await assert.rejects(f.sequence.requestScheduled({ isCurrent: f.isCurrent }));
  await assert.rejects(f.temperature.requestScheduled({ expectedSession: f.session }));
  assert.deepEqual(f.sent, []);
});

test('trusted callback does not bypass consent, pilot flags, legacy schedules or native cleanup', async () => {
  for (const change of [
    f => { f.context.consent.status = 'revoked'; },
    f => { f.config.careWellbeingIngestEnabled = false; },
    f => { f.context.request.version = 1; },
    f => { f.context.request.routine = 'manual'; },
    f => { f.context.state.mayBeRunning = true; },
    f => { f.context.state.temperatureMayBeRunning = true; },
    f => { f.current = false; },
  ]) {
    const f = fixture(); change(f);
    await assert.rejects(f.start());
    assert.deepEqual(f.sent, []);
  }
});

test('existing removed-test quarantine blocks scheduled optical dispatch and is never resumed', async () => {
  const f = fixture(); f.suppressed = true;
  await assert.rejects(f.start(), /quarantine/i);
  assert.deepEqual(f.sent, []);
  assert.equal(f.suppressed, true);
  assert.equal(f.resumeCalls, 0);
});

test('revision or consent change after optical dispatch prevents the scheduled temperature request', async () => {
  for (const change of [f => { f.current = false; },
    f => { f.context.consent.status = 'revoked'; },
    f => { f.context.request.routine = 'manual'; },
    f => { f.context.state.temperatureMayBeRunning = true; },
    f => { f.suppressed = true; }]) {
    const f = fixture(); await f.start(); change(f); f.advance(41_000); await f.pair();
    assert.deepEqual(f.sent, ['hrtstart,1']);
    assert.equal((await f.sequence.status()).sequence.terminal, true);
    assert.equal(f.resumeCalls, 0);
  }
});

test('cancellation while the scheduled temperature guard awaits prevents a late handoff', async () => {
  const f = fixture(); await f.start();
  const gate = deferred(); f.beforeGuard = () => gate.promise;
  f.advance(41_000); await f.pair();
  assert.equal(f.guardCalls, 2);
  f.sequence.cancel('routine_changed');
  gate.resolve(); await flush();
  assert.deepEqual(f.sent, ['hrtstart,1']);
  assert.equal((await f.sequence.status()).sequence.reason, 'routine_changed');
});

test('an authorization resolved after the optical deadline cannot send temperature', async () => {
  const f = fixture(); await f.start();
  const gate = deferred(); f.beforeGuard = () => gate.promise;
  f.advance(41_000); await f.pair();
  f.advance(79_000); gate.resolve(); await flush();
  assert.deepEqual(f.sent, ['hrtstart,1']);
  assert.equal((await f.sequence.status()).sequence.reason, 'optical_timeout');
});

test('start deadline is checked synchronously after the asynchronous authorization', async () => {
  const f = fixture(), gate = deferred();
  f.beforeGuard = () => gate.promise;
  const pending = f.start(); await flush();
  f.advance(60_000); gate.resolve();
  await assert.rejects(pending, /start window has ended/);
  assert.deepEqual(f.sent, []);
});

test('the start deadline does not shorten an already-started optical result window', async () => {
  const f = fixture(); await f.start();
  f.advance(61_000); await f.pair();
  assert.deepEqual(f.sent, ['hrtstart,1', 'BODYTEMP2']);
});

test('a timed-out schedule guard cannot revive the optical request when it later resolves', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(), gate = deferred(); f.beforeGuard = () => gate.promise;
  const pending = f.start();
  const rejected = assert.rejects(pending, /context_unavailable/);
  await flush(); t.mock.timers.tick(5001); await rejected;
  gate.resolve(); await flush();
  assert.deepEqual(f.sent, []);
});

test('new quarantine or consent expiry during the final schedule check prevents temperature', async () => {
  for (const change of [f => { f.suppressed = true; },
    f => { f.context.consent.expiresAt = new Date(f.now); },
    f => { f.config.careWellbeingRequestEnabled = false; },
    f => { f.session = { ...f.session }; }]) {
    const f = fixture(); await f.start();
    f.beforeGuard = () => change(f);
    f.advance(41_000); await f.pair();
    assert.deepEqual(f.sent, ['hrtstart,1']);
    assert.equal(f.resumeCalls, 0);
  }
});
