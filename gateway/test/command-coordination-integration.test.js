'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const sessions = require('../src/sessions');
const { commandCoordinator: gate } = require('../src/command-coordinator');
const { sendDownlinkCommand } = require('../src/downlink');
const { createMovementTransport } = require('../src/movement-reminder-transport');
const { createMedicationTransport, medicationTransport, observeMedicationReply } = require('../src/medication-settings-transport');
const { applyAdaptiveReporting } = require('../src/adaptive-reporting');

function watch(t, imei = '861000000000001') {
  const socket = new EventEmitter(), frames = [];
  socket.writable = true;
  socket.write = (frame, callback) => { frames.push(frame.toString()); callback?.(); return true; };
  sessions.registerSession(socket, { imei, protocolId: '0000000001' });
  t.after(() => sessions.unregisterSession(socket));
  const session = sessions.getSession(socket);
  const capture = (duration = 120000) => assert(gate.beginCapture({ imei, id: 'capture', socket, expiresAt: Date.now() + duration }).ok);
  return { imei, socket, session, frames, capture };
}

test('default medication, movement, wellness and reconnect downlinks share one gate and session lifecycle', async t => {
  const w = watch(t); w.capture();
  assert.equal(medicationTransport.available, true, 'main has the real coordinator dependency');
  const medication = createMedicationTransport();
  const value = { time: '18:30', enabled: true, frequency: 1, slot: 1, text: 'Test', leaseUntilMs: Date.now() + 45000 };
  assert.throws(() => medication.bind(w.imei, value).send(null), /camera_busy/);
  assert.throws(() => createMovementTransport().bind(w.imei).send('SEDENTARY,1,20'), /camera_busy/);
  for (const cmd of ['UPLOAD,600', 'hrtstart,1', 'bodytemp2', 'profile,3', 'PEDO,1', 'WALKTIME,00:00-23:59']) {
    assert.equal(sendDownlinkCommand(w.imei, cmd).error, 'camera_busy', cmd);
  }
  assert.equal(w.frames.length, 0);
  for (const cmd of ['CR', 'CALL,+23057123456', 'hrtstart,0', 'FON,0']) assert(sendDownlinkCommand(w.imei, cmd).ok);
  assert(sendDownlinkCommand(w.imei, 'UPLOAD,60', { emergency: true }).ok);
  const off = medication.bind(w.imei, { ...value, enabled: false }).send(null);
  observeMedicationReply({ command: 'TAKEPILLS', args: ['1'], imei: w.session.protocolId }, w.socket, w.session);
  assert.equal((await off).status, 'reply_observed');
  assert(gate.busyUntil(w.imei), 'an unrelated reply cannot release the camera lease');
  gate.finishCapture(w.imei, 'capture');
  const on = medication.bind(w.imei, value).send(null);
  observeMedicationReply({ command: 'TAKEPILLS', args: ['1'], imei: w.session.protocolId }, w.socket, w.session);
  assert.equal((await on).status, 'reply_observed');
  w.capture(); sessions.unregisterSession(w.socket);
  assert.equal(gate.busyUntil(w.imei), null);
});

test('actions never fan out to duplicate sessions and a bound medication cannot move to a replacement', t => {
  const w = watch(t), medication = createMedicationTransport();
  const value = { time: '18:30', enabled: true, frequency: 1, slot: 1, text: 'Test', leaseUntilMs: Date.now() + 45000 };
  const bound = medication.bind(w.imei, value);
  const replacement = watch(t);
  assert.equal(sendDownlinkCommand(w.imei, 'FIND').error, 'ambiguous_session');
  sessions.unregisterSession(w.socket);
  assert.throws(() => bound.send(null), /session_changed/);
  assert.equal(w.frames.length + replacement.frames.length, 0);
});

test('camera timeout releases admission without scheduling a capture or replaying blocked commands', async t => {
  const w = watch(t); w.capture(10);
  assert.equal(sendDownlinkCommand(w.imei, 'profile,3').error, 'camera_busy');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(gate.busyUntil(w.imei), null);
  assert.equal(w.frames.length, 0);
  assert(sendDownlinkCommand(w.imei, 'profile,2').ok);
  assert.equal(w.frames.length, 1);
});

test('routine reporting defers during an SOS camera wait; a fresh alarm still stays prompt', async t => {
  const w = watch(t, '861000000000002'); w.capture();
  let data = { locationReportingMode: 'automatic', locationReportingIntervalSeconds: 900,
    adaptiveReporting: { appliedIntervalSeconds: 900 } };
  const db = { collection: () => ({ doc: () => ({ get: async () => ({ data: () => data }),
    set: async patch => { data = { ...data, ...patch, adaptiveReporting: { ...data.adaptiveReporting, ...patch.adaptiveReporting } }; } }) }) };
  assert.equal((await applyAdaptiveReporting(db, w.imei, { batteryPercent: 80 })).status, 'deferred');
  assert.equal(data.locationReportingIntervalSeconds, 900);
  assert.equal(w.frames.length, 0);
  gate.finishCapture(w.imei, 'capture');
  // Restoration recomputes the supplier baseline at the current battery.
  assert.equal((await applyAdaptiveReporting(db, w.imei, { batteryPercent: 45 })).seconds, 600);
  assert(w.frames[0].includes('UPLOAD,600'));
  w.capture(); data.adaptiveReporting.sosActiveUntil = new Date(Date.now() + 60000);
  assert.equal((await applyAdaptiveReporting(db, w.imei, { batteryPercent: 80 })).status, 'deferred');
  assert.equal(w.frames.length, 1, 'an existing SOS lease cannot bypass the camera gate');
  assert.equal((await applyAdaptiveReporting(db, w.imei, { batteryPercent: 80, trigger: 'sos' })).changed, true);
  assert(w.frames[1].includes('UPLOAD,60'));
});

test('fixed SMS-off uses the real coordinator and sender, exact byte length, and bare reply', async t => {
  const { createWatchSmsPolicy } = require('../src/watch-sms-policy');
  const { decodeFrame, handlePacket } = require('../src/protocol/gt06');
  const w = watch(t, '861397000000010'); w.session.protocolId = '9700000001';
  const callbacks = new Map(); let next = 0;
  const policy = createWatchSmsPolicy({
    schedule: fn => { const id = ++next; callbacks.set(id, fn); return id; },
    cancel: id => callbacks.delete(id), log: () => {},
  });
  const packet = text => {
    const decoded = decodeFrame(Buffer.from(text));
    const { acks, events } = handlePacket(decoded, w.session);
    for (const ack of acks) w.socket.write(ack);
    policy.observe(decoded, events, w.socket, w.session);
  };
  const run = () => {
    for (const [id, callback] of [...callbacks]) { callbacks.delete(id); callback(); }
  };
  w.capture();
  packet('[3G*9700000001*0002*LK]'); run();
  assert.deepEqual(w.frames, ['[SG*9700000001*0002*LK]'], 'required reply precedes and bypasses routine deferral');
  assert.equal(w.session.watchSmsPolicy.reason, 'camera_busy');
  assert.equal(sendDownlinkCommand(w.imei, 'SMSONOFF,1', { emergency: true }).error, 'watch_sms_fixed_off');
  assert.equal(sendDownlinkCommand(w.imei, 'SMSONOFF,0', { expectedSocket: {} }).error, 'session_changed');
  gate.finishCapture(w.imei, 'capture'); run();
  assert.equal(w.frames[1], '[SG*9700000001*000A*SMSONOFF,0]');
  packet('[3G*9700000001*0008*SMSONOFF]');
  assert.equal(w.frames.length, 2, 'bare setting reply is not itself acknowledged');
  assert.equal(w.session.watchSmsPolicy.status, 'reply_observed');
  assert.equal(w.session.watchSmsPolicy.suppressionVerified, false);
  packet('[3G*9700000001*0002*LK]'); run();
  assert.equal(w.frames.filter(frame => frame.includes('SMSONOFF')).length, 1);
  policy.disconnect(w.socket);
  assert.equal(callbacks.size, 0);
});
