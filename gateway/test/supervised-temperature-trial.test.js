'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSupervisedTemperatureTrial, parseTemperatureTrialOperation } = require('../src/supervised-temperature-trial');

const AT = Date.parse('2026-09-15T19:30:00Z');
const action = { action: 'single', operatorPosition: 'worn' };
function fixture({ quarantineStore } = {}) {
  const env = { now: AT, sent: [], config: { wellnessRoutinePilotEnabled: true,
    careWellbeingRequestEnabled: true, careWellbeingIngestEnabled: true },
    context: { consent: { version: 1, status: 'granted', managedBy: 'guardian_admin',
      wearerAcknowledgedAt: new Date(AT - 60_000), expiresAt: new Date(AT + 3600_000) },
      request: undefined, state: {} },
    session: { lastPacketAt: AT }, result: { ok: true },
  };
  env.trial = createSupervisedTemperatureTrial({ config: env.config, clock: () => env.now, quarantineStore,
    readContext: async () => { await env.beforeRead?.(); return env.context; },
    currentSession: () => env.session,
    send: command => { env.onSend?.(); env.sent.push(command); if (env.failSend) throw Error('transport lost'); return env.result; },
  });
  return env;
}

test('only an explicit operator position, single action and two fixed command cases are accepted', () => {
  assert.deepEqual(parseTemperatureTrialOperation(action), action);
  assert.deepEqual(parseTemperatureTrialOperation({ ...action, operatorPosition: 'removed' }),
    { action: 'single', operatorPosition: 'removed' });
  for (const commandCase of ['lowercase', 'uppercase']) {
    const request = { ...action, commandCase };
    assert.deepEqual(parseTemperatureTrialOperation(request), request);
  }
  for (const value of [null, [], {}, { action: 'single' }, { ...action, operatorPosition: 'unknown' },
    { ...action, command: 'bodytemp,1,1' }, { ...action, imei: 'other' }, { ...action, action: 'BODYTEMP2' },
    ...[null, undefined, '', 'Uppercase', 'BODYTEMP2', 'bodytemp,1,1'].map(commandCase => ({ ...action, commandCase }))]) {
    assert.throws(() => parseTemperatureTrialOperation(value));
  }
});

test('uppercase comparison sends exactly one selected command and shares the cooldown with lowercase', async () => {
  const env = fixture();
  const result = await env.trial.request({ ...action, commandCase: 'uppercase' });
  assert.deepEqual(env.sent, ['BODYTEMP2']);
  assert.equal(result.command, 'BODYTEMP2');
  const status = await env.trial.status();
  assert.equal(status.trial.command, 'BODYTEMP2');
  assert.equal(status.trial.measurementConfirmed, false);
  await assert.rejects(env.trial.request(action), /two minutes/);
  assert.deepEqual(env.sent, ['BODYTEMP2']);
});

test('an uncertain uppercase handoff never falls back to lowercase', async () => {
  const env = fixture(); env.failSend = true;
  const result = await env.trial.request({ ...action, commandCase: 'uppercase' });
  assert.equal(result.outcome, 'handoff_unknown');
  assert.deepEqual(env.sent, ['BODYTEMP2']);
  assert.equal((await env.trial.status()).trial.command, 'BODYTEMP2');
});

test('missing CONFIG allows only one supervised lowercase request, without upgrading mode or wearing', async () => {
  const env = fixture();
  const result = await env.trial.request(action);
  assert.equal(result.outcome, 'command_handed_off');
  assert.deepEqual(env.sent, ['bodytemp2']);
  assert.equal(result.wearingConfirmed, false);
  assert.equal(result.readingConfirmed, false);
  assert.equal(result.scheduleVerified, false);
  assert.equal(env.session.wellnessTemperatureMode, undefined);
  await assert.rejects(env.trial.request(action), /two minutes/);
  assert.equal(env.sent.length, 1);
});

test('disabled flags, consent, stale/disconnected session and reported incompatible mode reject before dispatch', async () => {
  const cases = [
    env => { env.config.wellnessRoutinePilotEnabled = false; },
    env => { env.config.careWellbeingRequestEnabled = false; },
    env => { env.config.careWellbeingIngestEnabled = false; },
    env => { env.context.consent.revokedAt = new Date(AT); },
    env => { env.context.consent.expiresAt = new Date(AT); },
    env => { env.session = null; },
    env => { env.session.lastPacketAt = AT - 180_001; },
    env => { env.session.lastPacketAt = AT + 1000; },
    env => { env.session.wellnessTemperatureMode = { bt: 1 }; },
    env => { env.session.wellnessTemperatureMode = { bt: null }; env.session.wellnessLastReportedTemperatureBt = 1; },
    env => { env.context.request = { routine: 'gentle' }; },
    env => { env.context.state.mayBeRunning = true; },
    env => { env.context.state.temperatureMayBeRunning = true; },
  ];
  for (const change of cases) {
    const env = fixture(); change(env);
    await assert.rejects(env.trial.request(action));
    assert.deepEqual(env.sent, []);
  }
});

test('preflight rechecks session identity, freshness, consent and flags after asynchronous reads', async () => {
  for (const change of [
    env => { env.session = { lastPacketAt: AT }; },
    env => { env.session = null; },
    env => { env.now = AT + 180_001; },
    env => { env.context.consent.revokedAt = new Date(AT); },
    env => { env.config.careWellbeingRequestEnabled = false; },
    env => { env.session.wellnessTemperatureMode = { bt: 0 }; },
  ]) {
    const env = fixture(); env.beforeRead = () => change(env);
    await assert.rejects(env.trial.request(action));
    assert.equal(env.sent.length, 0);
  }
});

test('concurrent starts cannot dispatch twice while consent is loading', async () => {
  const env = fixture(); let release;
  env.beforeRead = () => new Promise(resolve => { release = resolve; });
  const first = env.trial.request(action);
  await assert.rejects(env.trial.request(action), /already being prepared/);
  release(); await first;
  assert.deepEqual(env.sent, ['bodytemp2']);
});

test('uncertain transport never retries and retains attempted trial metadata', async () => {
  const env = fixture(); env.failSend = true;
  const result = await env.trial.request(action);
  assert.equal(result.outcome, 'handoff_unknown');
  await assert.rejects(env.trial.request(action), /two minutes/);
  assert.equal(env.sent.length, 1);
  assert.equal((await env.trial.status()).trial.trialId, result.trialId);
});

test('numeric values require opt-in and current consent even for an earlier authorized trial', async () => {
  const env = fixture(); await env.trial.request(action);
  env.now += 1000;
  env.trial.observe({ command: 'btemp2', args: ['1', '36.68'], payload: 'btemp2,1,36.68' }, env.session, new Date(env.now));
  assert.equal(JSON.stringify(await env.trial.status()).includes('36.68'), false);
  assert.equal(JSON.stringify(await env.trial.status({ includeValues: true })).includes('36.68'), true);
  env.context.consent.revokedAt = new Date(env.now);
  const revoked = await env.trial.status({ includeValues: true });
  assert.equal(revoked.valuesIncluded, false);
  assert.equal(JSON.stringify(revoked).includes('36.68'), false);
  delete env.context.consent.revokedAt;
  env.now += 13 * 60_000;
  const expired = await env.trial.status({ includeValues: true });
  assert.equal(expired.valuesIncluded, false);
  assert.equal(expired.trial.valuesIncluded, false);
});

test('removed trial stays excluded beyond capture expiry and reconnection until a successful worn request', async () => {
  const env = fixture();
  env.onSend = () => assert.equal(env.trial.suppressTemperatureIngestion(), true);
  const result = await env.trial.request({ ...action, operatorPosition: 'removed' });
  delete env.onSend;
  assert.equal(result.temperatureIngestionSuppressed, true);
  assert.equal(result.dataUse, 'engineering_trial_only');
  assert.equal((await env.trial.status()).trial.operatorPosition, 'removed');
  env.now += 13 * 60_000;
  env.session = { lastPacketAt: env.now };
  assert.equal((await env.trial.status()).temperatureIngestionSuppressed, true);
  env.result = { ok: false };
  assert.equal((await env.trial.request(action)).temperatureIngestionSuppressed, true);
  env.now += 120_001; env.session.lastPacketAt = env.now; env.failSend = true;
  assert.equal((await env.trial.request(action)).temperatureIngestionSuppressed, true);
  env.now += 120_001; env.session.lastPacketAt = env.now; env.failSend = false; env.result = { ok: true };
  assert.equal((await env.trial.request(action)).temperatureIngestionSuppressed, false);
});

test('removed request cannot send if persistent exclusion fails', async () => {
  const env = fixture({ quarantineStore: { isSuppressed: () => false,
    suppress: () => { throw Error('disk unavailable'); }, resume() {} } });
  await assert.rejects(env.trial.request({ ...action, operatorPosition: 'removed' }), /disk unavailable/);
  assert.deepEqual(env.sent, []);
});

test('cleanup failure preserves successful handoff while maintaining exclusion', async () => {
  let restored = 0;
  const env = fixture({ quarantineStore: { isSuppressed: () => false,
    suppress: () => { restored++; }, resume: () => { throw Error('cleanup denied'); } } });
  const result = await env.trial.request(action);
  assert.equal(result.outcome, 'command_handed_off');
  assert.equal(result.cleanupError, 'temperature_trial_quarantine_release_failed');
  assert.equal(result.temperatureIngestionSuppressed, true);
  assert.equal(restored, 1);
  assert.equal(env.sent.length, 1);
});
