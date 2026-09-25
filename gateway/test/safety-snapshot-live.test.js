'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const { once } = require('node:events');
const { createSnapshotController, decodePhoto, isPhotoFrame } = require('../src/safety-snapshot-live');
const { createSnapshotHttpHandler } = require('../src/safety-snapshot-http');
const { extractFrames, decodeFrame, handlePacket } = require('../src/protocol/gt06');
const sessions = require('../src/sessions');
const jpeg = require('./fixtures/photo-synthetic');
// Literal identities observed on Jesh; do not derive expected wire data from the
// implementation under test (the previous slice repeated the production bug).
const imei = '861397052547492', protocolId = '9705254749';
const clone = value => value == null ? value : structuredClone(value);

// Serialized transactions model competing gateway workers against one durable store.
function database() {
  const rows = new Map(); let tail = Promise.resolve(); let ids = 0;
  const snapshot = path => ({ id: path.split('/').at(-1), ref: doc(path), exists: rows.has(path), data: () => clone(rows.get(path)) });
  function doc(path) {
    return { path, id: path.split('/').at(-1), get: async () => snapshot(path),
      set: async data => rows.set(path, clone(data)), update: async data => {
        assert(rows.has(path)); rows.set(path, { ...rows.get(path), ...clone(data) });
      }, collection: name => collection(`${path}/${name}`) };
  }
  function collection(path, filters = [], ordering = null, count = Infinity) {
    return { doc: id => doc(`${path}/${id}`), add: async data => { const ref = doc(`${path}/${++ids}`); await ref.set(data); return ref; },
      where: (field, op, value) => collection(path, [...filters, [field, op, value]], ordering, count),
      orderBy: (field, direction) => collection(path, filters, [field, direction], count),
      limit: n => collection(path, filters, ordering, n),
      get: async () => {
        let docs = [...rows.keys()].filter(key => key.startsWith(`${path}/`) && key.split('/').length === path.split('/').length + 1).map(snapshot);
        docs = docs.filter(doc => filters.every(([field, op, value]) => {
          const actual = doc.data()[field];
          return op === '==' ? actual === value : op === 'in' ? value.includes(actual) : actual <= value;
        }));
        if (ordering) docs.sort((a, b) => { const x = a.data()[ordering[0]], y = b.data()[ordering[0]]; return (x > y ? 1 : x < y ? -1 : 0) * (ordering[1] === 'desc' ? -1 : 1); });
        return { docs: docs.slice(0, count), empty: !docs.length };
      } };
  }
  const db = { rows, collection, runTransaction: fn => {
    const run = tail.then(async () => {
      const writes = []; let written = false;
      const tx = { get: async ref => { assert(!written, 'all transaction reads precede writes'); return ref.get(); },
        create: (ref, data) => { written = true; writes.push(() => { assert(!rows.has(ref.path)); rows.set(ref.path, clone(data)); }); },
        set: (ref, data) => { written = true; writes.push(() => rows.set(ref.path, clone(data))); },
        update: (ref, data) => { written = true; writes.push(() => { assert(rows.has(ref.path)); rows.set(ref.path, { ...rows.get(ref.path), ...clone(data) }); }); } };
      const result = await fn(tx); writes.forEach(write => write()); return result;
    }); tail = run.catch(() => {}); return run;
  } };
  for (const [uid, data] of Object.entries({ owner: { linkedImeis: [imei], memberUids: ['member'] },
    member: { linkedImeis: [imei], serviceOwnerUid: 'owner' }, outsider: { linkedImeis: [imei] },
    unlinked: { linkedImeis: [] }, essential: { linkedImeis: [imei] } })) {
    rows.set(`users/${uid}`, data);
    rows.set(`serviceSubscriptions/${uid}`, { version: 1, managedBy: 'guardian_admin', status: 'active', plan: uid === 'essential' ? 'essential' : 'family' });
  }
  return db;
}
function frame({ image = jpeg, id = protocolId, trailer = 6 } = {}) {
  const codes = new Map([[0x7d, 1], [0x5b, 2], [0x5d, 3], [0x2c, 4], [0x2a, 5]]);
  const body = Buffer.concat([Buffer.from('img,5,260925002653,'), Buffer.from([...Buffer.concat([image, Buffer.alloc(trailer)])].flatMap(byte => codes.has(byte) ? [0x7d, codes.get(byte)] : [byte]))]);
  return Buffer.concat([Buffer.from(`[3G*${id}*${body.length.toString(16).padStart(4, '0')}*`), body, Buffer.from(']')]);
}
function setup({ captureRejectedFrame = null } = {}) {
  const db = database(), objects = new Map(), writes = [], logs = [];
  let date = new Date('2026-09-25T00:00:00Z');
  const socket = { writable: true, destroyed: false, write: (data, callback) => { writes.push(Buffer.from(data)); callback?.(); return true; } };
  const session = { imei, protocolId };
  let matches = [{ socket, session }];
  const bucket = { failSave: false, failDelete: false, pause: null, file: path => ({
    save: async (bytes, options) => {
      assert.equal(options.preconditionOpts.ifGenerationMatch, 0); assert.equal(options.metadata.cacheControl, 'private, no-store');
      assert.equal(options.metadata.metadata.firebaseStorageDownloadTokens, undefined);
      if (bucket.pause) await bucket.pause;
      objects.set(path, Buffer.from(bytes));
      if (bucket.failSave) throw Error('ambiguous_storage_failure');
    },
    download: async () => [objects.get(path)],
    delete: async () => { if (bucket.failDelete) throw Error('storage_unavailable'); objects.delete(path); },
  }) };
  const args = { db, bucket, findSessions: () => matches, runtime: { deviceDispatchAllowed: true, acceptedImeis: [imei] }, now: () => date, log: value => logs.push(value), captureRejectedFrame };
  const api = createSnapshotController(args);
  return { api, args, db, bucket, objects, writes, logs, socket, session,
    advance: ms => { date = new Date(date.getTime() + ms); }, matches: value => { matches = value; },
    auth: id => db.rows.get(`safetySnapshotAuthorizations/${id}`),
  };
}
const input = { imei, purpose: 'Check immediate surroundings', consentConfirmed: true, safetyPurposeConfirmed: true };
async function until(fn) { for (let i = 0; i < 200; i++) { if (fn()) return; await new Promise(resolve => setImmediate(resolve)); } assert.fail('operation did not finish'); }
async function receive(s, id, bytes = frame()) { s.api.observe(bytes, s.socket, s.session); await until(() => !['dispatching', 'waiting_for_image', 'receiving'].includes(s.auth(id).state)); }
function ingress(s, chunk) {
  const { frames, rest } = extractFrames(Buffer.concat([s.session.buffer || Buffer.alloc(0), chunk]));
  s.session.buffer = Buffer.from(rest);
  s.api.observeTraffic(s.socket, s.session, { chunkBytes: chunk.length, frames, rest });
  for (const bytes of frames) if (isPhotoFrame(bytes)) s.api.observe(bytes, s.socket, s.session);
}

test('timeout records a bare reply and continued traffic without implying a photo', async () => {
  const s = setup(), id = await s.api.request('owner', input);
  s.advance(500);
  const reply = Buffer.from('[3G*9705254749*0008*rcapture]');
  ingress(s, reply.subarray(0, 10)); ingress(s, reply.subarray(10));
  s.advance(30_000); ingress(s, Buffer.from('[3G*9705254749*0002*LK]'));
  s.advance(90_000); await s.api.sweep();
  const d = s.auth(id).receiveDiagnostics;
  assert.equal(s.auth(id).reason, 'image_timeout');
  assert.equal(d.rcaptureReplies, 1); assert.equal(d.chunks, 3); assert.equal(d.frames, 2);
  assert.equal(d.firstDataAfterMs, 500); assert.equal(d.lastDataAfterMs, 30_500);
  assert.equal(d.photoHeaderSeen, false); assert.equal(d.acceptedPhotoFrames, 0);
  assert.equal(d.bufferedBytes, 0); assert.equal(d.failureStage, null);
  assert.equal(s.writes.length, 1); assert.equal(s.objects.size, 0);
  assert.equal(s.logs.length, 2);
  assert(s.logs[1].includes('image_timeout'));
  // No diagnostics are collected outside the explicit request window.
  ingress(s, frame()); assert.equal(s.logs.length, 2);
});

test('an incomplete photo survives framing as diagnostic evidence, never as a saved image', async () => {
  const s = setup(), id = await s.api.request('owner', input);
  const incomplete = frame().subarray(0, -1);
  ingress(s, incomplete.subarray(0, 22)); s.advance(1000);
  ingress(s, incomplete.subarray(22));
  s.advance(120_000); await s.api.sweep();
  const d = s.auth(id).receiveDiagnostics;
  assert.equal(d.photoHeaderSeen, true); assert.equal(d.incompletePhotoBuffered, true);
  assert.equal(d.firstPhotoHeaderAfterMs, 1000);
  assert.equal(d.bufferedBytes, incomplete.length); assert.equal(d.maxBufferedBytes, incomplete.length);
  assert.equal(d.photoFrames, 0); assert.equal(d.acceptedPhotoFrames, 0);
  assert.equal(s.objects.size, 0); assert.equal(s.writes.length, 1);
  const diagnosticOutput = JSON.stringify({ d, logs: s.logs });
  for (const secret of [imei, protocolId, input.purpose, jpeg.toString('hex'), '260925002653', 'frameHex']) {
    assert.equal(diagnosticOutput.includes(secret), false, 'metadata must omit private content');
  }
});

test('replacement, changed identity and expired photo arrivals remain rejected with counts', async () => {
  const s = setup(), id = await s.api.request('owner', input);
  s.api.observe(frame(), {}, { ...s.session });
  s.session.imei = '861397052547490';
  ingress(s, frame()); s.session.imei = imei;
  s.advance(121_000); s.api.observe(frame(), s.socket, s.session); await s.api.sweep();
  const d = s.auth(id).receiveDiagnostics;
  assert.equal(d.differentSessionPhotoFrames, 1); assert.equal(d.identityMismatchPhotoFrames, 1);
  assert.equal(d.expiredPhotoFrames, 1); assert.equal(d.identityChanged, true);
  assert.equal(d.acceptedPhotoFrames, 0); assert.equal(s.objects.size, 0);
  assert.equal(s.writes.length, 1);
});

test('unsupported header is visible in diagnostics without broadening accepted media', async () => {
  const s = setup(), id = await s.api.request('owner', input);
  ingress(s, Buffer.from('[3G*861397052547492*0004*IMG,]'));
  s.advance(121_000); await s.api.sweep();
  const d = s.auth(id).receiveDiagnostics;
  assert.equal(d.photoHeaderSeen, true); assert.equal(d.photoFrames, 1);
  assert.equal(d.acceptedPhotoFrames, 0); assert.equal(s.objects.size, 0);
});

test('decoder rejection is distinguished from timeout without emitting the corrupt payload', async () => {
  const s = setup(), id = await s.api.request('owner', input);
  ingress(s, frame({ image: Buffer.from('private-invalid-image') }));
  await until(() => s.auth(id).state === 'failed');
  assert.equal(s.auth(id).reason, 'image_rejected_or_storage_failed');
  assert.equal(s.auth(id).receiveDiagnostics.failureStage, 'decode');
  assert.equal(s.auth(id).receiveDiagnostics.decodeError, 'jpeg_soi_missing');
  assert.equal(s.auth(id).receiveDiagnostics.rejectedFrameCapture, 'not_enabled');
  assert.equal(s.auth(id).receiveDiagnostics.acceptedPhotoFrames, 1);
  assert.equal(JSON.stringify(s.logs).includes('private-invalid-image'), false);
  assert.equal(s.objects.size, 0);
});

test('unobserved padding stays rejected with precise metadata and one opt-in capture', async () => {
  const captures = [];
  const s = setup({ captureRejectedFrame: async data => { captures.push(data); return 'saved'; } });
  const id = await s.api.request('owner', input), bytes = frame({ trailer: 3 });
  ingress(s, bytes); await until(() => s.auth(id).state === 'failed');
  const d = s.auth(id).receiveDiagnostics;
  assert.equal(d.decodeError, 'unsupported_image_trailer');
  assert.deepEqual(d.decodeDetails, { frameBytes: bytes.length, jpegBytes: jpeg.length,
    width: 32, height: 24, trailerBytes: 3, trailerAllZero: true,
    declaredPayloadBytes: bytes.length - 21 });
  assert.equal(d.rejectedFrameCapture, 'saved');
  assert.equal(captures.length, 1); assert.deepEqual(captures[0].frame, bytes);
  assert.equal(captures[0].requestId, id); assert.equal(s.objects.size, 0);
  assert.equal(JSON.stringify({ d, logs: s.logs }).includes(bytes.toString('hex')), false);
  assert.equal(s.writes.length, 1);
});

test('revoked, cancelled and expired requests never save rejected diagnostic frames', async () => {
  for (const action of ['revoke', 'cancel', 'expire']) {
    let captured = 0;
    const s = setup({ captureRejectedFrame: async () => { captured++; return 'saved'; } });
    const id = await s.api.request('owner', input);
    if (action === 'revoke') s.db.rows.get('users/owner').linkedImeis = [];
    if (action === 'cancel') await s.api.remove('owner', id);
    ingress(s, frame({ trailer: 3 }));
    if (action === 'expire') s.advance(121_000);
    await until(() => s.auth(id).state === 'failed' || s.auth(id).state === 'deleted');
    // Drain async access checks even when cancellation already made it terminal.
    for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
    assert.equal(captured, 0, action);
    assert.equal(s.objects.size, 0);
  }
});

test('diagnostic writer failure preserves the original decode failure', async () => {
  const s = setup({ captureRejectedFrame: async () => { throw Error('private-path-and-secret'); } });
  const id = await s.api.request('owner', input);
  await receive(s, id, frame({ trailer: 3 }));
  assert.equal(s.auth(id).receiveDiagnostics.decodeError, 'unsupported_image_trailer');
  assert.equal(s.auth(id).receiveDiagnostics.rejectedFrameCapture, 'write_failed');
  assert.equal(JSON.stringify(s.logs).includes('private-path-and-secret'), false);
  assert.equal(s.objects.size, 0);
});

test('real decoded V52 identity is online and supports capture through the session registry', async t => {
  const s = setup();
  sessions.registerSession(s.socket);
  t.after(() => sessions.unregisterSession(s.socket));
  const session = sessions.getSession(s.socket);
  const decoded = decodeFrame(Buffer.from('[3G*9705254749*0016*RYIMEI,861397052547492]'));
  assert.equal(decoded.error, undefined);
  handlePacket(decoded, session);
  assert.equal(session.imei, '861397052547492');
  assert.equal(session.protocolId, '9705254749');
  const api = createSnapshotController({ ...s.args, findSessions: sessions.findSocketsForDevice });
  assert.equal((await api.list('owner', imei)).online, true);
  const id = await api.request('owner', input);
  assert.equal(s.writes.length, 1);
  assert.equal(s.writes[0].toString(), '[3G*9705254749*0008*rcapture]');
  api.observe(frame(), s.socket, session);
  await until(() => s.auth(id).state === 'available');
  assert.deepEqual(await api.image('owner', id), jpeg);
});

test('an incorrect protocol identity stays blocked even with the linked IMEI', async () => {
  const s = setup();
  s.session.protocolId = '3970525474';
  assert.equal((await s.api.list('owner', imei)).online, false);
  await assert.rejects(s.api.request('owner', input), /watch_offline_or_reconnecting/);
  assert.equal(s.writes.length, 0);
});

test('authorized request sends exact 3G command once; image receives full validation and private view/delete', async () => {
  const s = setup(), id = await s.api.request('owner', input);
  assert.equal(s.writes.length, 1); assert.equal(s.writes[0].toString(), `[3G*${protocolId}*0008*rcapture]`);
  assert.equal(s.auth(id).state, 'waiting_for_image');
  assert.equal(s.api.observe(Buffer.from(`[3G*${protocolId}*0008*rcapture]`), s.socket, s.session), false);
  assert.equal(s.auth(id).state, 'waiting_for_image');
  await receive(s, id);
  assert.equal(s.auth(id).state, 'available'); assert.equal(s.auth(id).validation, 'full_pixel_decode');
  assert.equal(s.auth(id).requestCorrelationVerified, false);
  assert.deepEqual(await s.api.image('member', id), jpeg);
  await assert.rejects(s.api.image('outsider', id), /photo_not_found/);
  assert.equal((await s.api.list('owner', imei)).snapshots[0].state, 'available');
  await s.api.remove('member', id); assert.equal(s.objects.size, 0);
  await assert.rejects(s.api.image('owner', id), /photo_unavailable/);
});

test('concurrent requests across workers and family guardians cannot duplicate capture', async () => {
  const s = setup(), second = createSnapshotController(s.args);
  const results = await Promise.allSettled([s.api.request('owner', input), second.request('member', input)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(s.writes.length, 1);
});

test('permissions, consent, allowlist and duplicate sessions prevent commands', async () => {
  for (const uid of ['unlinked', 'essential']) { const s = setup(); await assert.rejects(s.api.request(uid, input)); assert.equal(s.writes.length, 0); }
  const s = setup();
  await assert.rejects(s.api.request('owner', { ...input, consentConfirmed: false }));
  await assert.rejects(s.api.request('owner', { ...input, purpose: '\u0000' }));
  s.matches([{ socket: s.socket, session: s.session }, { socket: s.socket, session: s.session }]);
  await assert.rejects(s.api.request('owner', input), /offline_or_reconnecting/);
  const disabled = createSnapshotController({ ...s.args, runtime: { deviceDispatchAllowed: false, acceptedImeis: [imei] } });
  await assert.rejects(disabled.request('owner', input), /camera_unavailable/);
  assert.equal(s.writes.length, 0);
});

test('unsolicited, wrong-session, duplicate, late and wrong-device uploads are never adopted', async () => {
  const s = setup(); s.api.observe(frame(), s.socket, s.session); assert.equal(s.objects.size, 0);
  const id = await s.api.request('owner', input);
  s.api.observe(frame(), {}, s.session); assert.equal(s.auth(id).state, 'waiting_for_image');
  await receive(s, id, frame({ id: '1234567890' })); assert.equal(s.auth(id).state, 'failed');
  assert.equal(s.objects.size, 0);
  s.advance(15 * 60_000); const next = await s.api.request('owner', input);
  await receive(s, next); s.api.observe(frame(), s.socket, s.session);
  assert.equal(s.objects.size, 1);
  s.advance(15 * 60_000); const late = await s.api.request('owner', input);
  s.advance(121_000); s.api.observe(frame(), s.socket, s.session); await s.api.sweep();
  assert.equal(s.auth(late).state, 'failed'); assert.equal(s.objects.size, 1);
});

test('disconnect and gateway restart never resend a capture', async () => {
  const s = setup(), id = await s.api.request('owner', input);
  s.api.disconnect(s.socket); await until(() => s.auth(id).state === 'failed');
  s.advance(15 * 60_000); const next = await s.api.request('owner', input);
  const restarted = createSnapshotController(s.args); s.advance(121_000); await restarted.sweep();
  assert.equal(s.auth(next).reason, 'image_timeout'); assert.equal(s.writes.length, 2);
  assert.equal(s.auth(next).receiveDiagnostics, undefined, 'restart must not invent zero-traffic evidence');
  restarted.observe(frame(), s.socket, s.session); assert.equal(s.objects.size, 0);
});

test('full decoder rejects structurally plausible JPEG without usable pixel data', () => {
  const corrupt = Buffer.from(jpeg); const scan = corrupt.indexOf(Buffer.from([0xff, 0xda]));
  const entropyStart = scan + 2 + corrupt.readUInt16BE(scan + 2);
  assert.throws(() => decodePhoto(frame({ image: Buffer.concat([corrupt.subarray(0, entropyStart), Buffer.from([1, 0xff, 0xd9])]) }), protocolId));
});

test('revoked membership or subscription blocks upload and later image viewing', async () => {
  const s = setup(), id = await s.api.request('member', input);
  s.db.rows.get('users/owner').memberUids = [];
  await receive(s, id); assert.equal(s.auth(id).state, 'failed'); assert.equal(s.objects.size, 0);
  assert.equal(s.auth(id).receiveDiagnostics.failureStage, 'authorize');
  s.advance(15 * 60_000); const next = await s.api.request('owner', input); await receive(s, next);
  s.db.rows.get('serviceSubscriptions/owner').status = 'expired';
  await assert.rejects(s.api.image('owner', next));
});

test('storage failure is not success and ambiguous writes are cleaned up', async () => {
  const s = setup(); s.bucket.failSave = true; const id = await s.api.request('owner', input);
  await receive(s, id); await until(() => s.objects.size === 0 && !s.auth(id).cleanupPending);
  assert.equal(s.auth(id).state, 'failed');
  assert.equal(s.auth(id).receiveDiagnostics.failureStage, 'storage');
});

test('deletion during upload prevents publication and removes the eventual object', async () => {
  const s = setup(); let release; s.bucket.pause = new Promise(resolve => { release = resolve; });
  const id = await s.api.request('owner', input); s.api.observe(frame(), s.socket, s.session);
  await until(() => s.auth(id).state === 'receiving');
  await s.api.remove('owner', id); assert.equal(s.auth(id).state, 'deleted');
  release(); await until(() => !s.auth(id).cleanupPending);
  assert.equal(s.objects.size, 0); assert.equal(s.auth(id).state, 'deleted');
});

test('expiry denies reads immediately; durable cleanup survives failed storage deletion and restart', async () => {
  const s = setup(), id = await s.api.request('owner', input); await receive(s, id);
  s.advance(24 * 60 * 60_000); await assert.rejects(s.api.image('owner', id), /photo_unavailable/);
  s.bucket.failDelete = true; await s.api.sweep(); assert.equal(s.auth(id).cleanupPending, true);
  s.bucket.failDelete = false; const restarted = createSnapshotController(s.args); await restarted.sweep();
  assert.equal(s.auth(id).state, 'expired'); assert.equal(s.objects.size, 0);
});

test('real TCP splitting/coalescing preserves the photo and the following heartbeat', async t => {
  const s = setup(); const server = net.createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => server.close());
  const connected = once(server, 'connection');
  const watch = net.connect(server.address().port, '127.0.0.1'); await once(watch, 'connect');
  const [socket] = await connected; t.after(() => { socket.destroy(); watch.destroy(); });
  s.matches([{ socket, session: s.session }]); let buffer = Buffer.alloc(0), heartbeats = 0;
  socket.on('data', chunk => { const result = extractFrames(Buffer.concat([buffer, chunk])); buffer = Buffer.from(result.rest);
    s.api.observeTraffic(socket, s.session, { chunkBytes: chunk.length, frames: result.frames, rest: result.rest });
    for (const bytes of result.frames) { if (isPhotoFrame(bytes)) s.api.observe(bytes, socket, s.session); else heartbeats++; }
  });
  const downlink = once(watch, 'data'); const id = await s.api.request('owner', input);
  assert.equal((await downlink)[0].toString(), `[3G*${protocolId}*0008*rcapture]`);
  const bytes = frame(); watch.write(bytes.subarray(0, 127));
  watch.write(Buffer.concat([bytes.subarray(127), Buffer.from(`[3G*${protocolId}*0002*LK]`)]));
  await until(() => s.auth(id).state === 'available'); assert.equal(heartbeats, 1);
  assert.equal(s.auth(id).receiveDiagnostics.photoFrames, 1);
  assert.equal(s.auth(id).receiveDiagnostics.acceptedPhotoFrames, 1);
  assert.equal(s.auth(id).receiveDiagnostics.failureStage, null);
});

test('authenticated HTTP routes enforce token verification, no-store media and deletion', async t => {
  const s = setup(); const handler = createSnapshotHttpHandler({ controller: () => s.api,
    verifyToken: async token => { if (token !== 'valid') throw Error('invalid'); return { uid: 'owner' }; } });
  const server = http.createServer((req, res) => handler(req, res, new URL(req.url, 'http://localhost')));
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api/safety-snapshots`;
  const headers = { Authorization: 'Bearer valid', 'Content-Type': 'application/json' };
  assert.equal((await fetch(base)).status, 401);
  const response = await fetch(base, { method: 'POST', headers, body: JSON.stringify(input) });
  assert.equal(response.status, 202); const id = (await response.json()).requestId;
  await receive(s, id);
  const image = await fetch(`${base}/${id}/image`, { headers });
  assert.equal(image.headers.get('cache-control'), 'private, no-store'); assert.deepEqual(Buffer.from(await image.arrayBuffer()), jpeg);
  assert.equal((await fetch(`${base}/${id}`, { method: 'DELETE', headers })).status, 200);
  assert.equal((await fetch(`${base}/${id}/image`, { headers })).status, 410);
  assert.equal((await fetch(base, { method: 'POST', headers, body: 'x'.repeat(5000) })).status, 413);
});
