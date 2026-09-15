'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSupervisedTemperatureTrial, parseTemperatureTrialOperation } = require('../src/supervised-temperature-trial');

const AT = Date.parse('2026-09-15T19:30:00Z');
const action = { action: 'single', operatorPosition: 'worn' };
function fixture() {
  const env = { now: AT, sent: [], config: { wellnessRoutinePilotEnabled: true,
    careWellbeingRequestEnabled: true, careWellbeingIngestEnabled: true },
    context: { consent: { version: 1, status: 'granted', managedBy: 'guardian_admin',
      wearerAcknowledgedAt: new Date(AT - 60_000), expiresAt: new Date(AT + 3600_000) },
      request: undefined, state: {} },
    session: { lastPacketAt: AT }, result: { ok: true },
  };
  env.trial = createSupervisedTemperatureTrial({ config: env.config, clock: () => env.now,
    readContext: async () => { await env.beforeRead?.(); return env.context; },
    currentSession: () => env.session,
    send: command => { env.sent.push(command); if (env.failSend) throw Error('transport lost'); return env.result; },
  });
  return env;
}

test('only explicit operator-worn single action is accepted; no arbitrary target, casing or command', () => {
  assert.deepEqual(parseTemperatureTrialOperation(action), action);
  for (const value of [null, [], {}, { action: 'single' }, { ...action, operatorPosition: 'unknown' },
    { ...action, command: 'bodytemp,1,1' }, { ...action, imei: 'other' }, { ...action, action: 'BODYTEMP2' }]) {
    assert.throws(() => parseTemperatureTrialOperation(value));
  }
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
