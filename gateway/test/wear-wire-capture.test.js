'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createWearWireCapture, startWearWireCapture, WINDOW_MS, MAX_BYTES,
  MAX_CHUNKS, MAX_SESSIONS } = require('../src/wear-wire-capture');
const { extractFrames, decodeFrame, handlePacket } = require('../src/protocol/gt06');

const IMEI = '861000000000001', OTHER = '861000000000002';
const NOW = Date.parse('2026-09-16T18:00:00Z');
const consent = { version: 1, status: 'granted', managedBy: 'guardian_admin',
  wearerAcknowledgedAt: new Date(NOW - 60_000) };
function frame(payload, imei = IMEI) {
  return Buffer.from(`[3G*${imei}*${Buffer.byteLength(payload).toString(16).padStart(4, '0')}*${payload}]`);
}
function fixture(options = {}) {
  let now = NOW;
  const records = [], statuses = [], reads = [];
  const capture = createWearWireCapture({ enabled: true, pilotImei: IMEI, clock: () => now,
    readConsent: async imei => { reads.push(imei); return consent; },
    write: async record => { records.push(record); }, onStatus: record => statuses.push(record), ...options });
  const socket = { bytesRead: 0 }, session = { imei: IMEI };
  function receive(chunk, s = socket, identity = session) {
    s.bytesRead += chunk.length;
    capture.observeChunk(s, identity, chunk);
  }
  return { capture, records, statuses, reads, socket, session, receive,
    time: value => { now = value; }, chunks: () => records.filter(r => r.kind === 'tcp_chunk'),
    async finish() { await capture.finish(); return records.at(-1); } };
}

test('pre-decoder bytes survive fragmentation, coalescing, invalid lengths, binary noise and an unfinished frame', async () => {
  const f = fixture(), session = {}, baseline = {};
  const first = frame('LK,0,0,90');
  const unknown = frame('UNRECOGNISED,CONTACT_CANDIDATE,,0');
  const invalid = Buffer.from(`[3G*${IMEI}*FFFF*UD_LTE,unused]`);
  const chunks = [Buffer.from([0, 255, 128]), first.subarray(0, 11),
    Buffer.concat([first.subarray(11), unknown, invalid, Buffer.from('[unfinished,')])];
  let buffer = Buffer.alloc(0), baselineBuffer = Buffer.alloc(0);
  const received = [], expected = [];
  for (const chunk of chunks) {
    f.receive(chunk, f.socket, session); // same pre-framing position as server.js
    const extracted = extractFrames(Buffer.concat([buffer, chunk]));
    buffer = extracted.rest;
    for (const part of extracted.frames) {
      const decoded = decodeFrame(part);
      const result = handlePacket(decoded, session);
      f.capture.observeIdentity(f.socket, session);
      received.push(result);
    }
    const comparison = extractFrames(Buffer.concat([baselineBuffer, chunk]));
    baselineBuffer = comparison.rest;
    for (const part of comparison.frames) expected.push(handlePacket(decodeFrame(part), baseline));
  }
  await f.capture.flush();
  assert.deepEqual(received, expected, 'all normal events and ACK bytes remain unchanged');
  assert.deepEqual(buffer, baselineBuffer);
  const original = Buffer.concat(chunks);
  assert.deepEqual(Buffer.concat(f.chunks().map(r => Buffer.from(r.bytes, 'base64'))), original);
  assert.deepEqual(f.chunks().map(r => r.offset), [0, 3, 14]);
  const summary = await f.finish();
  assert.equal(summary.completeForIdentifiedSessions, true);
  assert.equal(summary.sessions[0].savedBytes, original.length);
  assert.equal(summary.sessions[0].unobservedSocketBytes, 0);
  assert.equal(JSON.stringify(f.statuses).includes('CONTACT_CANDIDATE'), false);
});

test('default-off, exact identity, unidentified sockets and identity changes never write out-of-scope raw bytes', async () => {
  assert.equal(createWearWireCapture().active, false);
  assert.equal(startWearWireCapture().active, false);
  for (const options of [{ enabled: false }, { pilotImei: '' }]) {
    const f = fixture(options); f.receive(frame('LK'));
    await f.finish(); assert.deepEqual(f.records, []);
  }
  const f = fixture();
  const unknown = { bytesRead: 0 }, other = { bytesRead: 0 };
  f.receive(Buffer.from('never-identified'), unknown, {});
  f.receive(frame('LK', OTHER), other, {});
  f.capture.observeIdentity(other, { imei: OTHER });
  f.receive(frame('LK'), f.socket, {});
  assert.deepEqual(f.reads, []);
  f.capture.observeIdentity(f.socket, f.session);
  await f.capture.flush();
  assert.equal(f.chunks().length, 1);
  const summary = await f.finish();
  assert.equal(summary.unidentifiedSessions, 1);
  assert.equal(summary.excludedSessions, 1);
  assert.equal(JSON.stringify(f.records).includes('never-identified'), false);

  const changing = fixture();
  changing.receive(Buffer.concat([frame('LK'), frame('FOREIGN_PRIVATE', OTHER)]));
  changing.capture.observeIdentity(changing.socket, { imei: OTHER });
  await changing.capture.flush();
  assert.equal(changing.chunks().length, 0);
  assert.equal((await changing.finish()).completeForIdentifiedSessions, false);
});

test('immutable raw copy and multiple pilot sessions retain independent offsets and close counters', async () => {
  const f = fixture(), second = { bytesRead: 0 };
  const bytes = Buffer.from([0, 255, 128, 10]);
  f.receive(bytes); bytes.fill(42);
  f.capture.observeClose(f.socket);
  f.receive(frame('NEW_SESSION'), second);
  await f.capture.flush();
  assert.deepEqual(Buffer.from(f.chunks()[0].bytes, 'base64'), Buffer.from([0, 255, 128, 10]));
  assert.deepEqual(f.chunks().map(r => [r.session, r.offset]), [[1, 0], [2, 0]]);
  const summary = await f.finish();
  assert.equal(summary.completeForIdentifiedSessions, true);
  assert.equal(summary.sessions[0].closedAt, new Date(NOW).toISOString());
  assert.equal(summary.sessions[1].closedAt, null);
});

test('consent is rechecked for every write and denied/failed reads leave byte gaps explicit', async () => {
  for (const value of [null, { ...consent, status: 'revoked' },
    { ...consent, expiresAt: new Date(NOW) }, { ...consent, managedBy: 'client' },
    { ...consent, wearerAcknowledgedAt: new Date(NOW + 1) }]) {
    const f = fixture({ readConsent: async () => value });
    f.receive(frame('PRIVATE'));
    const summary = await f.finish();
    assert.equal(f.chunks().length, 0);
    assert.equal(summary.completeForIdentifiedSessions, false);
    assert.equal(summary.sessions[0].dropReasons.consent_required, frame('PRIVATE').length);
  }
  let current = consent;
  const f = fixture({ readConsent: async () => current });
  f.receive(frame('FIRST')); await f.capture.flush();
  current = null; f.receive(frame('SECOND'));
  const summary = await f.finish();
  assert.equal(f.chunks().length, 1);
  assert.equal(summary.sessions[0].droppedBytes, frame('SECOND').length);

  const unavailable = fixture({ readConsent: async () => { throw Error('private error'); } });
  unavailable.receive(frame('PRIVATE'));
  assert.equal((await unavailable.finish()).sessions[0].dropReasons.consent_read_failed, frame('PRIVATE').length);
  assert.equal(JSON.stringify(unavailable.statuses).includes('private error'), false);
});

test('byte, chunk and session limits bound pending work and cannot report full coverage', async () => {
  const bytes = fixture();
  bytes.receive(Buffer.alloc(MAX_BYTES + 1));
  const b = await bytes.finish();
  assert.equal(b.completeForIdentifiedSessions, false);
  assert.equal(b.sessions[0].droppedBytes, MAX_BYTES + 1);
  assert.deepEqual(bytes.reads, []);

  const chunks = fixture();
  for (let i = 0; i < MAX_CHUNKS + 1; i++) chunks.receive(Buffer.from('a'));
  const c = await chunks.finish();
  assert.equal(chunks.chunks().length, MAX_CHUNKS);
  assert.equal(c.sessions[0].observedBytes, MAX_CHUNKS + 1);
  assert.equal(c.sessions[0].dropReasons.capture_limit, 1);
  assert.equal(c.completeForIdentifiedSessions, false);

  const sockets = fixture();
  for (let i = 0; i < MAX_SESSIONS + 1; i++) sockets.receive(Buffer.from('x'), { bytesRead: 0 });
  const s = await sockets.finish();
  assert.equal(s.sessions.length, MAX_SESSIONS);
  assert.equal(s.untrackedSessions, 1);
  assert.equal(s.completeForIdentifiedSessions, false);
});

test('expiry and clock rollback stop capture, including consent reads already in flight', async () => {
  let release;
  const f = fixture({ readConsent: () => new Promise(resolve => { release = resolve; }) });
  f.receive(frame('PRIVATE'));
  // Reach the consent read, which is deliberately not awaited in the receive path.
  await Promise.resolve(); await Promise.resolve();
  f.time(NOW + WINDOW_MS); release(consent);
  f.receive(frame('AFTER_WINDOW'));
  await f.capture.flush();
  assert.equal(f.capture.active, false);
  assert.equal(f.chunks().length, 0);
  assert.equal(f.records.at(-1).reason, 'window_ended');
  assert.equal(f.records.at(-1).sessions[0].dropReasons.window_ended, frame('PRIVATE').length);
  const rollback = fixture(); rollback.time(NOW - 1); rollback.receive(frame('PRIVATE'));
  await rollback.capture.flush();
  assert.equal(rollback.records.at(-1).reason, 'clock_changed');
  assert.equal(rollback.chunks().length, 0);
});

test('a stalled consent store, write failures and missing observed bytes remain visible without blocking the gateway', async () => {
  const stalled = fixture({ readConsent: () => new Promise(() => {}) });
  assert.equal(stalled.receive(frame('PRIVATE')), undefined);
  const summary = await stalled.finish();
  assert.equal(summary.sessions[0].dropReasons.consent_read_failed, frame('PRIVATE').length);
  const failed = fixture({ write: async record => {
    if (record.kind === 'tcp_chunk') throw Error('private disk error');
    failed.records.push(record);
  }, onStatus: () => { throw Error('private console error'); } });
  assert.doesNotThrow(() => failed.receive(frame('PRIVATE')));
  const disk = await failed.finish();
  assert.equal(disk.completeForIdentifiedSessions, false);
  assert.equal(disk.sessions[0].dropReasons.write_failed, frame('PRIVATE').length);
  const missing = fixture(); missing.receive(frame('LK')); missing.socket.bytesRead += 7;
  const gap = await missing.finish();
  assert.equal(gap.sessions[0].unobservedSocketBytes, 7);
  assert.equal(gap.completeForIdentifiedSessions, false);
});

test('runtime writes a private file, emits completion and performs no Firestore writes or raw console logging', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'guardian-wear-wire-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const logs = [], reads = [];
  const capture = startWearWireCapture({ enabled: true, directory,
    config: { careWellbeingIngestEnabled: true, wifiHomePilotImei: IMEI },
    db: { collection(name) { return { doc(imei) { return { async get() {
      reads.push({ name, imei }); return { exists: true,
        data: () => ({ ...consent, wearerAcknowledgedAt: new Date(Date.now() - 60_000) }) };
    } }; } }; } }, log: line => logs.push(line) });
  const bytes = frame('UNRECOGNISED,PRIVATE_FIELD');
  capture.observeChunk({ bytesRead: bytes.length }, { imei: IMEI }, bytes);
  await capture.finish();
  const files = await fs.readdir(directory);
  assert.equal(files.length, 1);
  const file = path.join(directory, files[0]);
  const records = (await fs.readFile(file, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(Buffer.from(records[0].bytes, 'base64'), bytes);
  assert.equal(records.at(-1).kind, 'capture_finished');
  assert.equal(records.at(-1).completeForIdentifiedSessions, true);
  assert.deepEqual(reads, [{ name: 'wellbeingConsents', imei: IMEI }]);
  assert.equal(logs.join('\n').includes('PRIVATE_FIELD'), false);
  assert.equal(logs.join('\n').includes(bytes.toString('base64')), false);
  assert.equal(logs.join('\n').includes(IMEI), false);
  assert.equal(logs.join('\n').includes('"sendsCommands":false'), true);
  if (process.platform !== 'win32') assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  assert.throws(() => startWearWireCapture({ enabled: true, config: {}, db: {} }), /needs Firestore/);
});
