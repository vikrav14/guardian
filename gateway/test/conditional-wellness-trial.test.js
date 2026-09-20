'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createConditionalWellnessTrial, parseConditionalWellnessOperation, OPTICAL_WINDOW_MS,
  VALUE_RETENTION_MS } = require('../src/conditional-wellness-trial');

const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function fixture() {
  let at = 1_000_000, ready = true, nextId = 0;
  const session = { imei: '123456789012345', protocolId: '6789012345', lastPacketAt: at };
  const config = { wifiHomePilotImei: session.imei, wellnessRoutineEnabled: true,
    careWellbeingRequestEnabled: true, careWellbeingIngestEnabled: true };
  let current = session;
  const context = { consent: { version: 1, status: 'granted', managedBy: 'guardian_admin',
    wearerAcknowledgedAt: new Date(at - 1000) }, request: { routine: 'manual' }, state: {} };
  const opticalSends = [], temperatureCalls = [], temperatureSends = [];
  let readGate = null, temperatureGate = null, opticalResult = { ok: true }, opticalThrows = false;
  let immediateFrames = null, temperatureState = null, readinessCalls = 0;
  const trial = createConditionalWellnessTrial({ config, clock: () => at, uuid: () => `sequence-${++nextId}`,
    currentSession: () => current,
    readContext: async () => { if (readGate) await readGate.promise; return context; },
    sendOptical: command => {
      opticalSends.push(command);
      for (const packet of immediateFrames || []) trial.observe(packet, session);
      if (opticalThrows) throw new Error('write uncertainty');
      return opticalResult;
    },
    temperatureTrial: {
      assertReady({ expectedSession }) {
        readinessCalls += 1;
        if (!ready) throw new Error('temperature not ready');
        if (!current || current !== expectedSession || at - current.lastPacketAt > 180_000 || at < current.lastPacketAt) {
          throw new Error('session stale or changed');
        }
      },
      async request(payload, guard) {
        temperatureCalls.push(payload);
        if (temperatureGate) await temperatureGate.promise;
        if (!guard.shouldSend() || guard.expectedSession !== current) throw new Error('cancelled');
        temperatureSends.push(payload);
        temperatureState = { trialId: `temperature-${nextId}`, phase: 'waiting', outcome: 'awaiting_reply_or_upload',
          counts: { uploads: 0 }, wearingConfirmed: false, readingConfirmed: false };
        return { outcome: 'command_handed_off', trialId: temperatureState.trialId,
          requestedAt: new Date(at).toISOString(), temperatureIngestionSuppressed: payload.operatorPosition === 'removed' };
      },
      async status() { return { trial: temperatureState }; },
    },
  });
  const frame = (command, args, overrides = {}) => ({ command, args,
    payload: [command, ...args].join(','), imei: session.protocolId, ...overrides });
  return { trial, config, context, session, opticalSends, temperatureCalls, temperatureSends,
    frame, heart: () => frame('bphrt', ['120', '80', '70', '', '', '', '']),
    oxygen: () => frame('oxygen', ['0', '97']),
    observe: packet => trial.observe(packet, session),
    async start(position = 'worn') { return trial.request({ action: 'single', operatorPosition: position }); },
    async pair() { trial.observe(this.heart(), session); trial.observe(this.oxygen(), session); await flush(); },
    setTime(value) { at = value; }, advance(delta) { at += delta; }, now: () => at,
    setCurrent(value) { current = value; }, setReady(value) { ready = value; },
    setReadGate(value) { readGate = value; }, setTemperatureGate(value) { temperatureGate = value; },
    setImmediateFrames(value) { immediateFrames = value; }, setOpticalResult(value) { opticalResult = value; },
    setOpticalThrows(value) { opticalThrows = value; },
    setTemperatureState(value) { temperatureState = value; },
    readinessCalls: () => readinessCalls };
}

test('strict operation parser preserves operator position and fixes the proven temperature casing', () => {
  assert.deepEqual(parseConditionalWellnessOperation({ action: 'single', operatorPosition: 'removed' }),
    { action: 'single', operatorPosition: 'removed', commandCase: 'uppercase' });
  for (const payload of [null, [], {}, { operatorPosition: 'likely_worn' },
    { operatorPosition: 'worn', commandCase: 'lowercase' },
    { operatorPosition: 'worn', action: 'schedule' }, { operatorPosition: 'worn', interval: 60 }]) {
    assert.throws(() => parseConditionalWellnessOperation(payload));
  }
});

test('read-only status and bare command replies never request temperature', async () => {
  const f = fixture();
  assert.equal((await f.trial.status()).sequence, null);
  assert.equal(f.opticalSends.length, 0);
  await f.start();
  f.observe(f.frame('hrtstart', []));
  await flush();
  assert.equal((await f.trial.status()).sequence.phase, 'waiting_optical');
  assert.equal(f.temperatureCalls.length, 0);
});

test('both usable uploads cause exactly one uppercase temperature request with original position', async () => {
  const f = fixture();
  const result = await f.start('removed');
  assert.equal(result.outcome, 'optical_request_handed_off');
  assert.deepEqual(f.opticalSends, ['hrtstart,1']);
  f.observe(f.oxygen());
  await flush();
  assert.equal(f.temperatureCalls.length, 0);
  f.observe(f.heart());
  await flush();
  f.observe(f.heart()); f.observe(f.oxygen());
  await flush();
  assert.deepEqual(f.temperatureSends, [{ action: 'single', operatorPosition: 'removed', commandCase: 'uppercase' }]);
  const status = (await f.trial.status()).sequence;
  assert.equal(status.phase, 'waiting_temperature');
  assert.equal(status.wearingConfirmed, false);
  assert.equal(status.readingConfirmed, false);
  assert.equal(status.correlationOnly, true);
  assert.equal(status.temperature.temperatureIngestionSuppressed, true);
  assert.equal('values' in status.optical.heartBloodPressure, false);
});

test('capture is armed before synchronous optical replies and uncertain handoff never chains', async () => {
  for (const uncertain of [false, true]) {
    const f = fixture();
    f.setImmediateFrames([f.heart(), f.oxygen()]);
    f.setOpticalThrows(uncertain);
    const result = await f.start();
    await flush();
    assert.equal(f.temperatureSends.length, uncertain ? 0 : 1);
    assert.equal(result.outcome, uncertain ? 'optical_handoff_unknown' : 'optical_request_handed_off');
  }
});

test('not-sent optical request remains terminal and reserves late-upload window', async () => {
  const f = fixture(); f.setOpticalResult({ ok: false });
  assert.equal((await f.start()).outcome, 'optical_not_sent');
  await f.pair();
  assert.equal(f.temperatureCalls.length, 0);
  assert.equal(f.trial.isBusy(), true);
  await assert.rejects(() => f.start(), /cooldown/);
  f.advance(OPTICAL_WINDOW_MS);
  assert.equal(f.trial.isBusy(), false);
});

test('zero, partial and malformed optical uploads fail closed without temperature', async () => {
  const invalid = [
    ['bphrt', ['0', '0', '0']], ['bphrt', ['120', '80']],
    ['bphrt', ['120x', '80', '70']], ['bphrt', ['120', '80', '70.0']],
    ['bphrt', ['80', '120', '70']], ['bphrt', ['120', '80', '70', 'contact']],
    ['oxygen', ['0', '0']], ['oxygen', ['0', '97x']], ['oxygen', ['0', '97', 'extra']],
    ['oxygen', ['unsupported', '97']], ['oxygen', ['0', '101']], ['oxygen', ['0']],
  ];
  for (const [command, args] of invalid) {
    const f = fixture(); await f.start();
    f.observe(f.frame(command, args)); await f.pair();
    const status = (await f.trial.status()).sequence;
    assert.equal(status.terminal, true, `${command}: ${args}`);
    assert.equal(status.outcome, 'temperature_skipped');
    assert.equal(f.temperatureCalls.length, 0);
  }
});

test('decoder rejection and payload mismatch cannot qualify numeric fields', async () => {
  for (const overrides of [{ error: 'length_mismatch' }, { payload: 'bphrt,120,80,71' }]) {
    const f = fixture(); await f.start();
    f.observe({ ...f.heart(), ...overrides });
    f.observe(f.oxygen()); await flush();
    assert.equal(f.temperatureCalls.length, 0);
    assert.equal((await f.trial.status()).sequence.reason, 'unusable_heart_bp');
  }
});

test('a partial pair times out and late uploads cannot start temperature', async () => {
  const f = fixture(); await f.start(); f.observe(f.heart());
  f.advance(OPTICAL_WINDOW_MS);
  f.observe(f.oxygen()); await flush();
  assert.equal((await f.trial.status()).sequence.reason, 'optical_timeout');
  assert.equal(f.temperatureCalls.length, 0);
});

test('other device/session uploads are ignored; reconnect cancels the original attempt', async () => {
  const f = fixture(); await f.start();
  f.trial.observe(f.heart(), { ...f.session });
  f.observe({ ...f.oxygen(), imei: '1111111111' });
  assert.equal((await f.trial.status()).sequence.optical.heartBloodPressure, null);
  f.setCurrent({ ...f.session });
  await f.pair();
  assert.equal(f.temperatureCalls.length, 0);
  assert.equal((await f.trial.status()).sequence.reason, 'session_changed');
});

test('a disconnect or identity mutation cannot borrow prior optical results', async () => {
  for (const disconnect of [false, true]) {
    const f = fixture(); await f.start(); f.observe(f.heart());
    if (disconnect) f.setCurrent(null); else f.session.protocolId = '1111111111';
    f.observe(f.oxygen()); await flush();
    assert.equal(f.temperatureCalls.length, 0);
    assert.equal((await f.trial.status()).sequence.reason, 'session_changed');
  }
});

test('removal bit in a live location/alarm packet cancels the chain', async () => {
  for (const command of ['UD_LTE', 'AL_LTE']) {
    const f = fixture(); await f.start();
    const args = Array(16).fill('0'); args[15] = '00100000';
    f.observe(f.frame(command, args)); await f.pair();
    assert.equal(f.temperatureCalls.length, 0);
    assert.equal((await f.trial.status()).sequence.reason, 'removal_reported');
  }
});

test('consent, operational flags and running routines block initial optical dispatch', async () => {
  for (const change of [f => { f.context.consent.status = 'revoked'; },
    f => { f.config.careWellbeingIngestEnabled = false; },
    f => { f.context.request.routine = 'gentle'; },
    f => { f.context.state.mayBeRunning = true; },
    f => { f.context.state.temperatureMayBeRunning = true; },
    f => { f.setReady(false); }, f => { f.session.lastPacketAt -= 180_001; }]) {
    const f = fixture(); change(f);
    await assert.rejects(() => f.start());
    assert.equal(f.opticalSends.length, 0);
  }
});

test('consent and routine changes before temperature prevent its dispatch', async () => {
  for (const change of [f => { f.context.consent.status = 'revoked'; },
    f => { f.context.request.routine = 'balanced'; },
    f => { f.context.state.temperatureMayBeRunning = true; },
    f => { f.config.careWellbeingRequestEnabled = false; }]) {
    const f = fixture(); await f.start(); change(f); await f.pair();
    assert.equal(f.temperatureSends.length, 0);
    assert.equal((await f.trial.status()).sequence.terminal, true);
  }
});

test('cancel during initial consent read prevents even the optical command', async () => {
  const f = fixture(), gate = deferred(); f.setReadGate(gate);
  const pending = f.start(); await flush();
  f.trial.cancel(); gate.resolve();
  await assert.rejects(() => pending, /cancelled/);
  assert.equal(f.opticalSends.length, 0);
});

test('late consent read cannot start temperature after the optical deadline', async () => {
  const f = fixture(); await f.start();
  const gate = deferred(); f.setReadGate(gate);
  f.observe(f.heart()); f.observe(f.oxygen()); await flush();
  f.advance(OPTICAL_WINDOW_MS); gate.resolve(); await flush();
  assert.equal(f.temperatureCalls.length, 0);
  f.setReadGate(null);
  assert.equal((await f.trial.status()).sequence.reason, 'optical_timeout');
});

test('internal pre-send guard rejects cancellation or new removal during temperature preparation', async () => {
  for (const removal of [false, true]) {
    const f = fixture(), gate = deferred(); f.setTemperatureGate(gate);
    await f.start(); await f.pair();
    assert.equal(f.temperatureCalls.length, 1);
    if (removal) {
      const args = Array(16).fill('0'); args[15] = '00100000'; f.observe(f.frame('AL_LTE', args));
    } else f.trial.cancel();
    gate.resolve(); await flush();
    assert.equal(f.temperatureSends.length, 0);
    assert.equal((await f.trial.status()).sequence.terminal, true);
  }
});

test('unusable second upload supersedes initial valid evidence before temperature send', async () => {
  const f = fixture(), gate = deferred(); f.setTemperatureGate(gate);
  await f.start(); await f.pair();
  f.observe(f.frame('oxygen', ['0', '0']));
  gate.resolve(); await flush();
  assert.equal(f.temperatureSends.length, 0);
  assert.equal((await f.trial.status()).sequence.reason, 'unusable_oxygen');
});

test('values require current consent and expire independently of metadata', async () => {
  const f = fixture(); await f.start(); f.observe(f.heart());
  assert.equal('values' in (await f.trial.status()).sequence.optical.heartBloodPressure, false);
  assert.equal((await f.trial.status({ includeValues: true })).sequence.optical.heartBloodPressure.values.heartRateBpm, 70);
  f.context.consent.status = 'revoked';
  assert.equal('values' in (await f.trial.status({ includeValues: true })).sequence.optical.heartBloodPressure, false);
  f.context.consent.status = 'granted'; f.advance(OPTICAL_WINDOW_MS + VALUE_RETENTION_MS);
  assert.equal('values' in (await f.trial.status({ includeValues: true })).sequence.optical.heartBloodPressure, false);
});

test('temperature capture completes by matching trial ID without claiming fresh measurement or wearing', async () => {
  const f = fixture(); await f.start(); await f.pair();
  f.setTemperatureState({ trialId: 'temperature-1', phase: 'observing', outcome: 'upload_observed_after_request', counts: { uploads: 1 } });
  const status = (await f.trial.status()).sequence;
  assert.equal(status.outcome, 'temperature_upload_observed');
  assert.equal(status.terminal, true);
  assert.equal(status.readingConfirmed, false);
  assert.equal(status.wearingConfirmed, false);
  assert.equal(f.trial.isBusy(), true);
  await assert.rejects(() => f.start(), /cooldown/);
});

test('unrelated temperature status does not complete the attempt; timeout never retries', async () => {
  const f = fixture(); await f.start(); await f.pair();
  f.setTemperatureState({ trialId: 'old-trial', outcome: 'upload_observed_after_request' });
  assert.equal((await f.trial.status()).sequence.terminal, false);
  f.advance(OPTICAL_WINDOW_MS);
  const status = (await f.trial.status()).sequence;
  assert.equal(status.reason, 'temperature_timeout');
  assert.equal(f.temperatureSends.length, 1);
  assert.equal(f.trial.isBusy(), false);
});

test('a completed in-window temperature capture can be inspected after its window closes', async () => {
  const f = fixture(); await f.start(); await f.pair();
  f.setTemperatureState({ trialId: 'temperature-1', phase: 'capture_timeout', outcome: 'upload_observed_after_request', counts: { uploads: 1 } });
  f.advance(OPTICAL_WINDOW_MS);
  const status = (await f.trial.status()).sequence;
  assert.equal(status.outcome, 'temperature_upload_observed');
  assert.equal('reason' in status, false);
});
