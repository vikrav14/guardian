'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const PILOT = '111111111111111';
const OTHER = '222222222222222';
const PROTOCOL_ID = '1111111111';
const AT = Date.parse('2026-09-17T16:00:00Z');
const single = { action: 'single', operatorPosition: 'worn' };

// Keep the real runtime, sequence controller, temperature trial and consent
// validation together. Only transport, Firestore and the unrelated native
// routine reconciler are isolated; no TCP listener or live database is loaded.
function fixture(t) {
  t.mock.timers.enable({ apis: ['Date'], now: AT });
  const env = { sent: [], reads: [], suppressed: false, beforeRead: null,
    session: { imei: PILOT, protocolId: PROTOCOL_ID, lastPacketAt: AT,
      wellnessTemperatureMode: { bt: 2, tm: 0 } },
    socket: { destroyed: false },
    config: { wifiHomePilotImei: PILOT, wellnessRoutinePilotEnabled: true,
      careWellbeingRequestEnabled: true, careWellbeingIngestEnabled: true },
  };
  const documents = new Map([
    [`wellbeingConsents/${PILOT}`, { version: 1, status: 'granted', managedBy: 'guardian_admin',
      wearerAcknowledgedAt: new Date(AT - 60_000), expiresAt: new Date(AT + 3600_000) }],
    [`wellnessRoutineRequests/${PILOT}`, { routine: 'manual' }],
    [`devices/${PILOT}/wellnessRoutine/current`, {}],
  ]);
  function reference(path) {
    return { path,
      collection: name => reference(`${path}/${name}`),
      doc: name => reference(`${path}/${name}`),
      async get() {
        env.reads.push(path);
        await env.beforeRead?.(path);
        return { exists: documents.has(path), data: () => documents.get(path) };
      },
    };
  }
  const db = { collection: name => reference(name),
    async runTransaction(run) {
      return run({ get: ref => ref.get(), set(ref, value, { merge } = {}) {
        documents.set(ref.path, merge ? { ...documents.get(ref.path), ...value } : value);
      } });
    },
  };
  function send(imei, command) {
    env.sent.push({ imei, command, temperatureSuppressed: env.suppressed });
    return { ok: true, sessions: 1 };
  }
  const cache = new Map();
  t.after(() => {
    env.runtime?.close();
    for (const [id, original] of cache) {
      if (original) require.cache[id] = original;
      else delete require.cache[id];
    }
  });
  function replace(moduleName, exports) {
    const id = require.resolve(moduleName);
    cache.set(id, require.cache[id]);
    require.cache[id] = { id, filename: id, loaded: true, exports };
  }
  // The supplied runtime config is the only configuration used in this test;
  // prevent transitive protocol imports from reading a local .env file.
  replace('../src/config', {});
  const actualRoutine = require('../src/wellness-routine');
  replace('../src/sessions', { findSocketsForDevice: imei => imei === PILOT && env.session
    ? [{ socket: env.socket, session: env.session }] : [] });
  replace('../src/downlink', { sendDownlinkCommand: send });
  replace('../src/entitlements', { loadEntitlementsForUser: async () => ({ serviceActive: true }) });
  replace('../src/wellness-routine', { ...actualRoutine,
    createRoutineController: () => ({ tick: async () => {} }) });
  const runtimePath = require.resolve('../src/wellness-routine-runtime');
  cache.set(runtimePath, require.cache[runtimePath]);
  delete require.cache[runtimePath];
  env.runtime = require('../src/wellness-routine-runtime').startWellnessRoutineRuntime({ db,
    config: env.config, wearEvidence: { current: () => ({ state: 'unknown' }) },
    temperatureTrialQuarantine: {
      isSuppressed: () => env.suppressed,
      suppress: () => { env.suppressed = true; },
      resume: () => { env.suppressed = false; },
    },
  });
  env.dispatchExternal = (imei, command) => {
    env.runtime.assertMeasurementAvailable(imei, command);
    env.runtime.noteExternalMeasurement(imei, command);
    return send(imei, command);
  };
  env.advance = milliseconds => {
    t.mock.timers.tick(milliseconds);
    if (env.session) env.session.lastPacketAt = Date.now();
  };
  env.observe = (command, args, session = env.session) => env.runtime.observe({
    imei: session.protocolId, command, args, payload: [command, ...args].join(','),
  }, session);
  env.opticalPair = () => {
    env.observe('bphrt', ['101', '61', '71', '', '', '', '']);
    env.observe('oxygen', ['1', '98']);
  };
  env.commands = () => env.sent.map(item => item.command);
  return env;
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test('runtime excludes competing measurement paths while keeping other devices independent', async t => {
  const env = fixture(t);
  await env.runtime.requestWellnessSequence(single);
  for (const command of ['hrtstart,1', 'hrtstart,300', 'bodytemp2', 'BODYTEMP2']) {
    assert.throws(() => env.dispatchExternal(PILOT, command), /sequence/i);
  }
  await assert.rejects(env.runtime.requestTemperature(), /sequence/i);
  await assert.rejects(env.runtime.requestTemperatureTrial(single), /sequence/i);
  assert.doesNotThrow(() => env.dispatchExternal(OTHER, 'hrtstart,1'));
  assert.deepEqual(env.sent.map(({ imei, command }) => ({ imei, command })), [
    { imei: PILOT, command: 'hrtstart,1' }, { imei: OTHER, command: 'hrtstart,1' },
  ]);
});

test('explicit stop remains available and cancels the unsent temperature stage', async t => {
  const env = fixture(t);
  await env.runtime.requestWellnessSequence(single);
  env.advance(41_000);
  env.observe('bphrt', ['101', '61', '71', '', '', '', '']);
  assert.doesNotThrow(() => env.dispatchExternal(PILOT, 'hrtstart,0'));
  env.observe('oxygen', ['1', '98']);
  await settle();
  const status = await env.runtime.wellnessSequenceStatus();
  assert.equal(status.sequence.terminal, true);
  assert.equal(status.sequence.temperature, null);
  assert.deepEqual(env.commands(), ['hrtstart,1', 'hrtstart,0']);
});

test('a prior generic request reserves the same pilot cooldown before a sequence starts', async t => {
  const env = fixture(t);
  env.dispatchExternal(PILOT, 'hrtstart,1');
  await assert.rejects(async () => env.runtime.requestWellnessSequence(single), /two minutes/i);
  env.advance(119_999);
  await assert.rejects(async () => env.runtime.requestWellnessSequence(single), /two minutes/i);
  env.advance(2);
  await env.runtime.requestWellnessSequence(single);
  assert.deepEqual(env.commands(), ['hrtstart,1', 'hrtstart,1']);
});

test('decoded runtime packets cause exactly one uppercase temperature request with removed-trial quarantine', async t => {
  const env = fixture(t);
  await env.runtime.requestWellnessSequence({ ...single, operatorPosition: 'removed' });
  env.advance(41_000);
  const foreign = { imei: OTHER, protocolId: '2222222222', lastPacketAt: Date.now() };
  env.observe('bphrt', ['101', '61', '71', '', '', '', ''], foreign);
  env.observe('oxygen', ['1', '98'], foreign);
  await settle();
  assert.deepEqual(env.commands(), ['hrtstart,1']);
  env.opticalPair();
  env.opticalPair();
  await settle();
  assert.deepEqual(env.commands(), ['hrtstart,1', 'BODYTEMP2']);
  assert.equal(env.sent[1].temperatureSuppressed, true);
  env.observe('BODYTEMP2', []);
  assert.equal((await env.runtime.wellnessSequenceStatus()).sequence.phase, 'waiting_temperature');
  env.advance(1000);
  env.observe('btemp2', ['1', '35.11']);
  const status = await env.runtime.wellnessSequenceStatus();
  assert.equal(status.sequence.outcome, 'temperature_upload_observed');
  assert.equal(status.sequence.wearingConfirmed, false);
  assert.equal(status.sequence.readingConfirmed, false);
  assert.equal(status.sequence.positionBasis, 'operator_reported');
  assert.equal(JSON.stringify(status).includes('35.11'), false);
  assert.deepEqual(env.commands(), ['hrtstart,1', 'BODYTEMP2']);
});

test('the runtime packet hook stops the sequence on zeros despite a later oxygen packet', async t => {
  const env = fixture(t);
  await env.runtime.requestWellnessSequence(single);
  env.advance(41_000);
  env.observe('bphrt', ['0', '0', '0', '', '', '', '']);
  env.observe('oxygen', ['1', '98']);
  await settle();
  const status = await env.runtime.wellnessSequenceStatus();
  assert.equal(status.sequence.reason, 'unusable_heart_bp');
  assert.equal(status.sequence.temperature, null);
  assert.deepEqual(env.commands(), ['hrtstart,1']);
});

test('a temperature request preparing asynchronously prevents a competing sequence start', async t => {
  const env = fixture(t);
  let release;
  env.beforeRead = path => path.startsWith('wellbeingConsents/')
    ? new Promise(resolve => { release = resolve; }) : undefined;
  const pending = env.runtime.requestTemperatureTrial(single);
  try {
    await assert.rejects(async () => env.runtime.requestWellnessSequence(single), /already being prepared/i);
    assert.deepEqual(env.commands(), []);
  } finally {
    env.beforeRead = null;
    release();
  }
  await pending;
  assert.deepEqual(env.commands(), ['bodytemp2']);
});

test('stop during the temperature consent read prevents the late second-stage handoff', async t => {
  const env = fixture(t);
  await env.runtime.requestWellnessSequence({ ...single, operatorPosition: 'removed' });
  let consentReads = 0, release;
  env.beforeRead = path => {
    if (path.startsWith('wellbeingConsents/') && ++consentReads === 2) {
      return new Promise(resolve => { release = resolve; });
    }
  };
  env.advance(41_000);
  env.opticalPair();
  await settle();
  assert.equal(typeof release, 'function', 'the real temperature trial is awaiting consent');
  env.dispatchExternal(PILOT, 'hrtstart,0');
  env.beforeRead = null;
  release();
  await settle();
  assert.deepEqual(env.commands(), ['hrtstart,1', 'hrtstart,0']);
  assert.equal(env.suppressed, false);
  assert.equal((await env.runtime.wellnessSequenceStatus()).sequence.terminal, true);
});
