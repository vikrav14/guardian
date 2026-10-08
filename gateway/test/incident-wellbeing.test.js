'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { database, imei } = require('./helpers/command-database');
const { createIncidentWellbeing, START_WINDOW_MS, RESULT_WINDOW_MS, LEASE_MS } = require('../src/incident-wellbeing');

function fixture() {
  const f = { db: database(), at: new Date('2026-10-07T12:00:00Z'), allowed: true,
    enabled: true, busy: null, calls: [], sequence: null, reject: false };
  f.options = { db: f.db, now: () => f.at, enabled: () => f.enabled,
    authorize: async () => ({ ok: f.allowed, ownerUid: 'owner' }),
    availability: async () => f.busy,
    request: async args => {
      f.calls.push(args);
      assert.equal(f.job().state, 'dispatching', 'claim is durable before the command');
      if (f.reject) throw Error('unknown write outcome');
      assert.equal(await args.isCurrent(), true);
      f.sequence = { positionBasis: 'incident', attemptId: 'attempt1', requestedAt: f.at.toISOString(),
        opticalDeadlineAt: new Date(+f.at + 120_000).toISOString(), terminal: false, optical: {} };
      return { outcome: 'optical_request_handed_off', attemptId: 'attempt1', requestedAt: f.at.toISOString() };
    },
    status: async () => ({ sequence: f.sequence }), workerId: 'worker1' };
  f.worker = createIncidentWellbeing(f.options);
  f.alert = (id = 'alarm1', patch = {}) => f.db.rows.set(`alerts/${id}`, { imei, type: 'sos', eventAt: f.at,
    notifyStatus: 'pending', incidentWellbeingEligible: true, incidentWellbeingPending: true, ...patch });
  f.job = (id = 'alarm1') => f.db.rows.get(`incidentWellbeing/${id}`);
  f.advance = ms => { f.at = new Date(+f.at + ms); };
  f.start = async () => { f.alert(); await f.worker.sweep(); };
  f.heart = () => { f.sequence.optical.heartBloodPressure = { usable: true, receivedAt: f.at.toISOString(),
    values: { heartRateBpm: 74, systolicMmHg: 120, diastolicMmHg: 80 } }; };
  f.oxygen = () => { f.sequence.optical.oxygen = { usable: true, receivedAt: f.at.toISOString(), values: { spo2Percent: 97 } }; };
  return f;
}

test('watch SOS/fall queues fresh requests independently of initial notification and photo availability', async () => {
  for (const type of ['sos', 'fall']) {
    const f = fixture(); f.alert('alarm1', { type }); await f.worker.sweep();
    assert.equal(f.calls.length, 1);
    assert.equal(f.db.rows.get('alerts/alarm1').notifyStatus, 'pending');
    assert.equal(f.job().state, 'collecting');
    assert.deepEqual(f.job().readings, {});
    assert.equal((await f.worker.readForFollowup('alarm1', 'owner')).pending, true);
  }
});

test('untrusted app SOS, unrelated alarms and old events cannot request measurements', async () => {
  for (const patch of [{ incidentWellbeingEligible: false }, { type: 'low_battery' },
    { eventAt: new Date('2020-01-01') }, { eventAt: new Date('2030-01-01') }]) {
    const f = fixture(); f.alert('alarm1', patch); await f.worker.sweep(); assert.equal(f.calls.length, 0);
  }
});

test('duplicate delivery and competing workers dispatch once; distinct alerts never borrow a reading', async () => {
  const f = fixture(); f.alert();
  const other = createIncidentWellbeing({ ...f.options, workerId: 'worker2' });
  await Promise.all([f.worker.sweep(), other.sweep()]);
  f.alert('alarm2', { type: 'fall' }); await f.worker.sweep();
  assert.equal(f.calls.length, 1);
  assert.equal(f.db.rows.get('alerts/alarm2').wellbeingIncidentId, 'alarm2');
  assert.equal(f.job('alarm2').state, 'queued');
  assert.deepEqual(f.job('alarm2').readings, {});
});

test('camera or existing measurement defers a fresh request only within the bounded start window', async () => {
  const f = fixture(); f.busy = 'camera_busy'; await f.start();
  assert.equal(f.calls.length, 0); assert.equal(f.job().state, 'queued');
  f.advance(30_000); f.busy = null; await f.worker.sweep(); assert.equal(f.calls.length, 1);
  const offline = fixture(); offline.busy = 'watch_offline'; await offline.start();
  offline.advance(START_WINDOW_MS); await offline.worker.sweep();
  assert.equal(offline.calls.length, 0); assert.equal(offline.job().state, 'unavailable');
  assert.equal(offline.job().reason, 'watch_offline');
});

test('disabled collection and revoked consent never send commands or expose results', async () => {
  for (const flag of ['enabled', 'allowed']) {
    const f = fixture(); f[flag] = false; await f.start(); assert.equal(f.calls.length, 0);
  }
  const f = fixture(); await f.start(); f.advance(10_000); f.heart(); await f.worker.sweep();
  f.allowed = false; await f.worker.sweep();
  assert.deepEqual(f.job().readings, {});
  assert.deepEqual((await f.worker.readForFollowup('alarm1', 'owner')).readings, {});
});

test('photo timeout at minute six still permits fresh vitals without extending the nine-minute deadline', async () => {
  const f = fixture(); f.busy = 'incident_photo_pending'; await f.start();
  const resultDeadline = +f.job().deadlineAt;
  f.advance(5 * 60_000); await f.worker.sweep();
  assert.equal(f.job().state, 'queued'); assert.equal(f.calls.length, 0);
  f.advance(60_000); f.busy = null; await f.worker.sweep();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].deadlineAt, resultDeadline);
  assert.equal(+f.job().deadlineAt, resultDeadline);
  assert.equal(resultDeadline - +f.at, 3 * 60_000);
  f.advance(20_000); await f.worker.sweep();
  f.advance(21_000); f.heart(); f.oxygen(); f.sequence.terminal = true;
  await f.worker.sweep();
  assert.equal(f.job().state, 'partial');
  assert.equal((await f.worker.readForFollowup('alarm1', 'owner')).pending, false);
});

test('persisted legacy start deadlines are never renewed by restart or camera deferral', async () => {
  const f = fixture(); f.busy = 'incident_photo_pending'; await f.start();
  f.job().version = 1; f.job().startDeadlineAt = new Date(+f.at + 5 * 60_000);
  const end = +f.job().startDeadlineAt;
  const restarted = createIncidentWellbeing({ ...f.options, workerId: 'new-process' });
  f.advance(5 * 60_000); f.busy = null; await restarted.sweep();
  assert.equal(f.calls.length, 0); assert.equal(f.job().state, 'unavailable');
  assert.equal(+f.job().startDeadlineAt, end);
});

test('minute-seven admission deadline is final even if the photo then finishes', async () => {
  const f = fixture(); f.busy = 'incident_photo_pending'; await f.start();
  f.advance(START_WINDOW_MS); f.busy = null; await f.worker.sweep();
  assert.equal(f.job().state, 'unavailable'); assert.equal(f.calls.length, 0);
  await f.worker.sweep(); assert.equal(f.calls.length, 0);
});

test('first incident readings persist with timestamps and cannot be replaced by later routine values', async () => {
  const f = fixture(); await f.start(); f.advance(10_000); f.heart(); f.oxygen(); await f.worker.sweep();
  const saved = structuredClone(f.job().readings);
  f.sequence.optical.heartBloodPressure.values.heartRateBpm = 100;
  f.sequence.terminal = true; f.sequence.reason = 'temperature_timeout'; await f.worker.sweep();
  assert.equal(f.job().state, 'partial');
  assert.deepEqual(f.job().readings, saved);
  const result = await f.worker.readForFollowup('alarm1', 'owner', { freeze: true });
  assert.equal(result.readings.heartBloodPressure.values.heartRateBpm, 74);
  assert.equal(result.readings.heartBloodPressure.correlationOnly, true);
  assert(f.job().frozenAt instanceof Date);
  await f.worker.sweep(); assert.deepEqual(f.job().readings, saved);
});

test('matching optical and temperature results complete the incident snapshot', async () => {
  const f = fixture(); await f.start(); f.advance(10_000); f.heart(); f.oxygen();
  f.sequence.temperature = { temperatureIngestionSuppressed: false, trial: {
    handoff: 'command_handed_off', sessionMatches: true, positionBasis: 'incident',
    requestedAt: f.at.toISOString(), captureExpiresAt: new Date(+f.at + 120_000).toISOString(),
    packets: [{ kind: 'temperature_upload', command: 'btemp2', accepted: true,
      receivedAt: f.at.toISOString(), args: ['1', '34.56'] }] } };
  f.sequence.terminal = true; await f.worker.sweep();
  assert.equal(f.job().state, 'available');
  assert.equal(f.job().readings.temperature.values.skinTemperatureCelsius, 34.56);
  assert.equal(f.job().readings.temperature.wearingConfirmed, false);
});

test('pre-request, future, malformed and out-of-window readings are never incident evidence', async () => {
  for (const change of [
    (f, r) => { r.receivedAt = new Date(+f.at - 60_000).toISOString(); },
    (f, r) => { r.receivedAt = new Date(+f.at + 60_000).toISOString(); },
    (_, r) => { r.values.heartRateBpm = 0; },
    (f, r) => { r.receivedAt = f.sequence.opticalDeadlineAt; f.advance(120_000); },
  ]) {
    const f = fixture(); await f.start(); f.advance(10_000); f.heart();
    change(f, f.sequence.optical.heartBloodPressure);
    f.sequence.terminal = true; await f.worker.sweep();
    assert.deepEqual(f.job().readings, {});
  }
});

test('another request or a scheduled result cannot complete an incident', async () => {
  for (const change of [s => { s.attemptId = 'routine-attempt'; }, s => { s.positionBasis = 'scheduled'; }]) {
    const f = fixture(); await f.start(); f.heart(); change(f.sequence); await f.worker.sweep();
    assert.deepEqual(f.job().readings, {}); assert.equal(f.job().state, 'unavailable');
  }
});

test('restart retains partial evidence and never replays an uncertain hardware request', async () => {
  const f = fixture(); await f.start(); f.advance(10_000); f.heart(); await f.worker.sweep();
  const restarted = createIncidentWellbeing({ ...f.options, workerId: 'new-process' });
  await restarted.sweep(); assert.equal(f.job().state, 'collecting');
  f.advance(LEASE_MS); await restarted.sweep();
  assert.equal(f.job().state, 'partial'); assert.equal(f.job().reason, 'gateway_interrupted');
  assert.equal(f.job().readings.heartBloodPressure.values.heartRateBpm, 74);
  assert.equal(f.calls.length, 1);
  const uncertain = fixture(); uncertain.reject = true; await uncertain.start();
  await uncertain.worker.sweep(); assert.equal(uncertain.calls.length, 1);
});

test('a delayed command result cannot reopen an incident finalized by another worker', async () => {
  const f = fixture();
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const worker = createIncidentWellbeing({ ...f.options, request: async () => {
    f.calls.push('one request'); await waiting;
    return { outcome: 'optical_request_handed_off', attemptId: 'late', requestedAt: f.at.toISOString() };
  } });
  f.alert(); await worker.enqueue('alarm1');
  const pending = worker.tick('alarm1');
  while (!f.calls.length) await new Promise(resolve => setImmediate(resolve));
  f.advance(LEASE_MS);
  const restarted = createIncidentWellbeing({ ...f.options, workerId: 'new-process' });
  await restarted.tick('alarm1');
  const finalized = await restarted.readForFollowup('alarm1', 'owner', { freeze: true });
  release(); await pending;
  assert.equal(f.job().state, 'unavailable');
  assert.equal(f.job().reason, 'gateway_interrupted');
  assert.equal(finalized.pending, false);
  assert.equal(f.job().attemptId, undefined);
  assert.equal(f.calls.length, 1);
});

test('follow-up rejects a different incident pointer and a missing retention deadline', async () => {
  const f = fixture(); await f.start(); f.heart(); f.sequence.terminal = true; await f.worker.sweep();
  f.alert('alarm2', { incidentWellbeingPending: false, wellbeingIncidentId: 'alarm1' });
  assert.deepEqual((await f.worker.readForFollowup('alarm2', 'owner')).readings, {});
  delete f.job().expiresAt;
  assert.deepEqual((await f.worker.readForFollowup('alarm1', 'owner')).readings, {});
});

test('follow-up deadline is bounded, never borrows latest history, and respects owner and expiry', async () => {
  const f = fixture(); await f.start(); f.advance(10_000); f.heart(); await f.worker.sweep();
  assert.equal((await f.worker.readForFollowup('alarm1', 'owner')).pending, true);
  assert.deepEqual((await f.worker.readForFollowup('alarm1', 'outsider')).readings, {});
  f.advance(RESULT_WINDOW_MS);
  const result = await f.worker.readForFollowup('alarm1', 'owner', { freeze: true });
  assert.equal(result.pending, false); assert.equal(result.state, 'partial');
  assert.deepEqual(Object.keys(result.readings), ['heartBloodPressure']);
  f.advance(24 * 3600_000); assert.deepEqual((await f.worker.readForFollowup('alarm1', 'owner')).readings, {});
});

test('a new alert after revocation owns its own snapshot despite the prior device reservation', async () => {
  const f = fixture(); await f.start(); f.db.rows.delete('incidentWellbeing/alarm1');
  f.advance(1000); f.alert('alarm2'); await f.worker.enqueue('alarm2');
  assert.equal(f.db.rows.get('alerts/alarm2').wellbeingIncidentId, 'alarm2');
  assert.equal(f.job('alarm2').state, 'queued');
});
