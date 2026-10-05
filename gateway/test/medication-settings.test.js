'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');
const { randomUUID } = require('node:crypto');
const { createMedicationTransport } = require('../src/medication-settings-transport');
const { createMedicationStore } = require('../src/medication-settings-store');
const { medicationRequest, medicationRuntime, authorizeMedication, publicReminder, MedicationError } = require('../src/medication-settings-policy');
const { executeMedication, createMedicationHandler, readMedicationJson } = require('../src/medication-settings-http');
const { encodeMedicationAudio, validatePcm, wav } = require('../src/medication-audio');
const { inspectMedicationVoice } = require('../src/medication-voice-codec');
const { sendDeviceCommand } = require('../src/commands');
const imei = '999999999999999', uid = 'test-owner', protocolId = '9999999999';
const access = { uid, imei, ownerUid: uid };
const settings = { time: '18:30', enabled: true, frequency: 1, text: 'Test reminder', mode: 'alert' };
const request = (patch = {}) => ({ requestId: randomUUID(), id: randomUUID(), version: 0, settings, action: 'save', ...patch });
function memoryDb() {
  const rows = new Map(); let queue = Promise.resolve();
  const doc = (name, id) => ({ key: `${name}/${id}`, id, get: async () => ({ id, exists: rows.has(`${name}/${id}`), data: () => rows.get(`${name}/${id}`) }) });
  const db = { collection: name => ({ doc: id => doc(name, id), where: (field, op, value) => ({ get: async () => ({
    docs: [...rows].filter(([key, data]) => key.startsWith(`${name}/`) && data[field] === value)
      .map(([key]) => ({ id: key.split('/')[1], data: () => rows.get(key) })) }) }) }),
    runTransaction(run) {
      const task = queue.then(async () => {
        const writes = [];
        const result = await run({ get: ref => ref.get(), set: (ref, value, options) => writes.push(() => rows.set(ref.key,
          options?.merge ? { ...rows.get(ref.key), ...value } : value)), delete: ref => writes.push(() => rows.delete(ref.key)) });
        writes.forEach(write => write()); return result;
      }); queue = task.catch(() => {}); return task;
    } };
  rows.set(`users/${uid}`, { linkedImeis: [imei] });
  rows.set(`serviceSubscriptions/${uid}`, { version: 1, managedBy: 'guardian_admin', plan: 'family', status: 'active' });
  return { db, rows };
}
function transportFixture({ coordinator, timeoutMs = 15 } = {}) {
  const replies = new EventEmitter(), socket = new EventEmitter();
  const session = { imei, protocolId, lastPacketAt: Date.now() };
  socket.writable = true; socket.frames = []; socket.write = f => { socket.frames.push(f); return true; };
  let matches = [{ socket, session }];
  const transport = createMedicationTransport({ find: () => matches, replies, timeoutMs,
    coordinator: coordinator === undefined ? { decide: () => ({ ok: true }) } : coordinator });
  return { transport, socket, session, setMatches: v => { matches = v; },
    reply: (code = '1', patch = {}) => replies.emit('reply', { socket, session, decoded: { imei: protocolId, command: 'TAKEPILLS', args: [code] }, ...patch }) };
}
const value = () => ({ ...settings, slot: 2, leaseUntilMs: Date.now() + 45000 });

test('encoding preserves a complete bounded clip in captured AMR mode; invalid lengths fail', async () => {
  const pcm = Buffer.alloc(16000);
  for (let i = 0; i < 8000; i++) pcm.writeInt16LE(Math.round(8000 * Math.sin(i / 10)), i * 2);
  const result = await encodeMedicationAudio(pcm);
  assert.equal(result.durationMs, 1000);
  assert.equal(inspectMedicationVoice(result.audio).frameCount, 50);
  assert.equal((await encodeMedicationAudio(Buffer.alloc(160000))).durationMs, 10000);
  assert.equal(wav(pcm).readUInt32LE(24), 8000);
  assert.equal(wav(pcm).readUInt32LE(40), pcm.length);
  for (const length of [0, 7998, 8001, 160002]) assert.throws(() => validatePcm(Buffer.alloc(length)));
});

test('request validation forbids weekly voice, injection, implicit enables and unrelated fields', () => {
  for (const patch of [{ frequency: 3 }, { enabled: 'true' }, { time: '18:00,1' }, { text: '\ud800' }, { mode: 'TK' }]) {
    assert.throws(() => medicationRequest(request({ settings: { ...settings, ...patch } })));
  }
  assert.throws(() => medicationRequest(request({ command: 'CR' })));
  assert.throws(() => medicationRequest(request({ id: '../elsewhere' })));
  assert.throws(() => medicationRequest(request({ action: 'delete' })));
  assert.throws(() => medicationRequest(request({ pcm: '!!!!', settings: { ...settings, mode: 'voice' } })));
  assert.equal(medicationRuntime({}).enabled, false);
});

test('access checks explicit pilot, linkage, current trusted subscription and never admin headers', async () => {
  const { db, rows } = memoryDb(), runtime = { enabled: true, imei, uid };
  assert.equal((await authorizeMedication({ db, imei, uid, runtime })).uid, uid);
  for (const patch of [{ uid: 'other' }, { imei: '111111111111111' }, { runtime: { ...runtime, enabled: false } }]) {
    await assert.rejects(authorizeMedication({ db, imei, uid, runtime, ...patch }));
  }
  rows.set(`users/${uid}`, { linkedImeis: [] });
  await assert.rejects(authorizeMedication({ db, imei, uid, runtime }), /device_not_linked/);
});

test('slot allocation preserves legacy reminders, separates repeat from slot and detects collisions', async () => {
  const { db, rows } = memoryDb(), store = createMedicationStore(db);
  rows.set('medicationReminders/legacy', { imei, createdBy: uid, frequency: 2 });
  const a = await store.claim({ access, request: request({ settings: { ...settings, frequency: 2 } }) });
  assert.equal(a.value.slot, 1); assert.equal(a.value.frequency, 2);
  await store.update(a.value, 'reply_observed');
  const b = await store.claim({ access, request: request() });
  assert.equal(b.value.slot, 3); await store.update(b.value, 'reply_observed');
  await assert.rejects(store.claim({ access, request: request() }), /watch_slots_full/);
  rows.set('medicationReminders/duplicate', { imei, createdBy: uid, frequency: 2 });
  await assert.rejects(store.claim({ access, request: request({ id: 'legacy' }) }), /slot_conflict/);
});

test('durable idempotency, concurrent claims, version conflict and restart do not replay', async () => {
  let now = Date.now(); const { db } = memoryDb(), store = createMedicationStore(db, () => now), r = request();
  const a = await store.claim({ access, request: r });
  assert.equal((await store.claim({ access, request: r })).replay, true);
  await assert.rejects(store.claim({ access, request: { ...r, settings: { ...settings, time: '19:30' } } }), /request_id_conflict/);
  await assert.rejects(store.claim({ access, request: request() }), /change_in_progress/);
  await store.update(a.value, 'sending'); now += 50000;
  assert.equal((await store.list(imei))[0].status, 'unconfirmed');
  await assert.rejects(store.claim({ access, request: request({ id: r.id, version: 1 }) }), /turn_off_before_retry/);
  await assert.rejects(store.claim({ access, request: request({ id: r.id }) }), /settings_changed/);
  assert.equal(publicReminder('x', { deviceSyncStatus: 'sending', leaseUntilMs: 1 }, 2).status, 'unconfirmed');
});

test('deletion retains ambiguous records and private voice, removes only after an off reply', async () => {
  const { db, rows } = memoryDb(), store = createMedicationStore(db);
  const r = request({ settings: { ...settings, mode: 'voice' } });
  const a = await store.claim({ access, request: r, pcm: Buffer.alloc(8000), encoded: { audio: Buffer.from('private'), durationMs: 500 } });
  await store.update(a.value, 'reply_observed');
  const off = await store.claim({ access, request: request({ id: r.id, version: 1, action: 'delete', settings: { ...r.settings, enabled: false } }) });
  await store.update(off.value, 'unconfirmed');
  assert.equal((await store.list(imei)).length, 1); assert.ok(rows.has(`medicationVoicePrivate/${r.id}`));
  const next = await store.claim({ access, request: request({ id: r.id, version: 2, action: 'delete', settings: { ...r.settings, enabled: false } }) });
  await store.update(next.value, 'reply_observed');
  assert.equal((await store.list(imei)).length, 0); assert.equal(rows.has(`medicationVoicePrivate/${r.id}`), false);
  const replacement = await store.claim({ access, request: request() }); assert.equal(replacement.value.slot, 1);
});

test('private preview verifies reminder ownership, device and mode; never exposed in list', async () => {
  const { db } = memoryDb(), store = createMedicationStore(db), r = request({ settings: { ...settings, mode: 'voice' } });
  const a = await store.claim({ access, request: r, pcm: Buffer.alloc(8000), encoded: { audio: Buffer.from('private-audio'), durationMs: 500 } });
  assert.equal((await store.audio({ ...access, id: r.id })).version, 1);
  await assert.rejects(store.audio({ ...access, uid: 'other', id: r.id }));
  await assert.rejects(store.audio({ ...access, imei: 'other', id: r.id }));
  assert.equal(JSON.stringify(await store.list(imei)).includes('private-audio'), false);
  await store.update(a.value, 'reply_observed');
});

test('same-session matching reply only; no payload is included in returned evidence', async () => {
  const f = transportFixture(), pending = f.transport.bind(imei, value()).send(null);
  f.reply('1', { socket: new EventEmitter() });
  f.reply('1', { decoded: { imei: '1111111111', args: ['1'] } });
  f.reply(); const result = await pending;
  assert.equal(result.status, 'reply_observed'); assert.equal(result.playbackVerified, false);
  assert.equal(JSON.stringify(result).includes(settings.text), false);
  assert.equal(f.socket.frames.length, 1);
});

test('timeout, disconnect, rejection, multiple and replaced sessions never retry', async () => {
  const f = transportFixture();
  assert.equal((await f.transport.bind(imei, value()).send(null)).status, 'unconfirmed');
  assert.throws(() => f.transport.bind(imei, value()).send(null), /reconnect_required/);
  const stop = f.transport.bind(imei, { ...value(), enabled: false }).send(null);
  f.reply(); assert.equal((await stop).status, 'unconfirmed'); // late ACK cannot prove off
  assert.equal(f.socket.frames.length, 2);
  const g = transportFixture(), bound = g.transport.bind(imei, value());
  g.setMatches([{ socket: new EventEmitter(), session: g.session }]);
  assert.throws(() => bound.send(null), /session_changed/);
  const h = transportFixture(), p = h.transport.bind(imei, value()).send(null); h.socket.emit('close');
  assert.equal((await p).reason, 'connection_interrupted');
  const j = transportFixture(), q = j.transport.bind(imei, value()).send(null); j.reply('0');
  assert.equal((await q).status, 'rejected');
});

test('shared camera gate is required and checked again at the actual write', async () => {
  const missing = transportFixture({ coordinator: null });
  assert.throws(() => missing.transport.bind(imei, value()).send(null), /coordination_unavailable/);
  let busy = false;
  const f = transportFixture({ coordinator: { decide: (_, command, options) =>
    options.expiresAt <= Date.now() ? { ok: false, error: 'command_expired' }
      : busy && !command.includes('-0-') ? { ok: false, error: 'camera_busy' } : { ok: true } } });
  const bound = f.transport.bind(imei, value()); busy = true;
  assert.throws(() => bound.send(null), /camera_busy/);
  const off = f.transport.bind(imei, { ...value(), enabled: false }).send(null); f.reply();
  assert.equal((await off).status, 'reply_observed');
  assert.throws(() => f.transport.bind(imei, { ...value(), leaseUntilMs: 1 }).send(null), /command_expired/);
});

test('execution rechecks access after waiting and after durable sending; no ambiguous retry', async () => {
  for (const revokeAt of [1, 2]) {
    const { db } = memoryDb(), f = transportFixture(); let calls = 0;
    const result = await executeMedication({ access, request: request(), store: createMedicationStore(db), transport: f.transport,
      authorizeAgain: async () => { if (++calls === revokeAt) throw new MedicationError('device_not_linked'); } });
    assert.equal(result.status, 'not_sent'); assert.equal(f.socket.frames.length, 0);
  }
  const { db } = memoryDb(), store = createMedicationStore(db), f = transportFixture(), r = request();
  const args = { access, request: r, store, transport: f.transport, authorizeAgain: async () => {} };
  const result = await executeMedication(args); assert.equal(result.status, 'unconfirmed');
  await executeMedication(args); assert.equal(f.socket.frames.length, 1);
});

test('bounded camera deferral never migrates a request to a replacement connection', async () => {
  let clock = Date.now(), waits = 0;
  const { db } = memoryDb(), store = createMedicationStore(db, () => clock);
  const f = transportFixture({ coordinator: { decide: () => waits < 2 ? { ok: false, error: 'camera_busy' } : { ok: true } } });
  const result = await executeMedication({ access, request: request(), store, transport: f.transport, now: () => clock,
    authorizeAgain: async () => {}, wait: async ms => { clock += ms; waits++; if (waits === 2) f.setMatches([{ socket: new EventEmitter(), session: f.session }]); } });
  assert.equal(result.reason, 'session_changed'); assert.equal(f.socket.frames.length, 0);
});

test('legacy dispatcher cannot overwrite managed watch slots', async () => {
  const { db, rows } = memoryDb(); rows.set(`medicationVoiceDevices/${imei}`, { slots: { 1: 'owned' } });
  await assert.rejects(sendDeviceCommand(db, imei, 'set_medication_reminder', settings,
    { sendDownlinkCommand: () => assert.fail('must not send') }), /managed_medication_settings_required/);
});

test('HTTP requires Firebase user token and limits bodies without exposing internal errors', async () => {
  const { db } = memoryDb(), runtime = { enabled: true, imei, uid };
  const handler = createMedicationHandler({ getDb: () => db, runtime,
    transport: { available: true, connected: () => true }, verifyToken: async token => {
      if (token !== 'valid') throw Error('secret'); return { uid };
    } });
  for (const [headers, expected] of [[{}, 401], [{ 'x-admin-key': 'anything' }, 401],
    [{ authorization: 'Bearer invalid' }, 401], [{ authorization: 'Bearer valid' }, 200]]) {
    const res = { writeHead(status) { this.status = status; }, end(body) { this.body = body; } };
    await handler({ method: 'GET', headers }, res, new URL(`http://local/app/medication-reminders?imei=${imei}`));
    assert.equal(res.status, expected); assert.equal(res.body.includes('secret'), false);
  }
  await assert.rejects(readMedicationJson(Readable.from([Buffer.alloc(220001)])), /request_too_large/);
});
