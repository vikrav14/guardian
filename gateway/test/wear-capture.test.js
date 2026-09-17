'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { createWearCapture, startWearCapture, WINDOW_MS, MAX_RECORDS } = require('../src/wear-capture');

const IMEI = '861397000000010';
const ID = '9700000001';
const NOW = Date.parse('2026-09-16T13:00:00Z');
const ACK = Buffer.from(`[SG*${ID}*0002*AL]`);
const session = () => ({ imei: IMEI, protocolId: ID });
function packet(command = 'AL_LTE', state = '00100000') {
  const args = ['160926', '130000', 'V', '20.123456', 'S', '57.123456', 'E',
    '0', '0', '0', '0', '80', '90', '123', '0', state, 'private-wifi-and-cell-data'];
  const payload = [command, ...args].join(',');
  return { decoded: { command, args, payload },
    frame: Buffer.from(`[3G*${ID}*${Buffer.byteLength(payload).toString(16).padStart(4, '0')}*${payload}]`) };
}
function fixture(options = {}) {
  const records = [], stopped = [], writes = [], callbacks = [];
  const socket = { write(...args) { writes.push(args); if (args[1]) callbacks.push(args[1]); return true; } };
  let now = NOW;
  const capture = createWearCapture({ enabled: true, pilotImei: IMEI,
    write: record => records.push(record), clock: () => now,
    onStop: status => stopped.push(status), ...options });
  const observe = (input = packet(), currentSession = session()) => capture.observePacket({
    socket, session: currentSession, ...input, receivedAt: new Date(now) });
  return { capture, records, stopped, writes, callbacks, socket, observe,
    time: value => { now = value; } };
}

test('capture requires opt-in and exact pilot; normal ACKs retain their native call', () => {
  for (const options of [{ enabled: false }, { pilotImei: '' }]) {
    const f = fixture(options);
    assert.equal(f.observe(), null);
    f.capture.writeAlarmAck(f.socket, ACK, null);
    assert.deepEqual(f.records, []);
    assert.equal(f.writes.length, 1);
    assert.equal(f.writes[0].length, 1);
    assert.strictEqual(f.writes[0][0], ACK);
  }
  const f = fixture();
  assert.equal(f.observe(packet(), { imei: '861000000000002', protocolId: ID }), null);
  f.capture.observeSocket('socket_closed', f.socket, { imei: '861000000000002' });
  assert.deepEqual(f.records, []);
  assert.equal(startWearCapture().active, false);
});

test('records bit 20 with other bits, length mismatch, and actual bare AL bytes without payload values', () => {
  const f = fixture();
  const input = packet('AL_LTE', '00100008');
  input.frame = Buffer.from(input.frame.toString().replace(/\*[0-9a-f]{4}\*/, '*FFFF*'));
  const original = structuredClone(input.decoded);
  const token = f.observe(input);
  f.capture.writeAlarmAck(f.socket, ACK, token);
  f.callbacks[0]();
  assert.deepEqual(input.decoded, original);
  assert.deepEqual(f.records[0].setBits, [3, 20]);
  assert.equal(f.records[0].payloadLengthMatches, false);
  assert.equal(f.records[0].protocolIdMatchesSession, true);
  assert.equal(f.writes.length, 1);
  assert.strictEqual(f.writes[0][0], ACK);
  const completed = f.records.find(r => r.kind === 'alarm_ack_write_completed');
  assert.equal(completed.ackFrame, ACK.toString());
  assert.equal(completed.localWriteCompleted, true);
  assert.equal(completed.deliveryConfirmed, false);
  assert.equal(completed.protocolIdMatchesPacket, true);
  assert.equal(completed.packet, f.records[0].packet);
  assert.equal(JSON.stringify(f.records).includes('20.123456'), false);
  assert.equal(JSON.stringify(f.records).includes('private-wifi'), false);
  const health = packet('bphrt');
  health.decoded.args = ['sensitive-health-values'];
  health.decoded.payload = 'sensitive-health-values';
  assert.equal(f.observe(health), null);
  assert.equal(JSON.stringify(f.records).includes('sensitive-health-values'), false);
});

test('backpressure, callback failure and synchronous write failure never retry the ACK', () => {
  const f = fixture();
  const token = f.observe();
  let calls = 0, callback;
  const socket = { write(bytes, cb) { calls++; assert.strictEqual(bytes, ACK); callback = cb; return false; } };
  assert.equal(f.capture.writeAlarmAck(socket, ACK, token), false);
  assert.equal(calls, 1);
  assert.equal(f.records.at(-1).backpressure, true);
  callback(Object.assign(new Error('private error details'), { code: 'EPIPE' }));
  assert.equal(f.records.at(-1).localWriteCompleted, false);
  assert.equal(f.records.at(-1).errorCode, 'EPIPE');
  assert.equal(JSON.stringify(f.records).includes('private error details'), false);
  const failure = Object.assign(new Error('socket failed'), { code: 'ECONNRESET' });
  const badSocket = { write() { calls++; throw failure; } };
  assert.throws(() => f.capture.writeAlarmAck(badSocket, ACK, token), error => error === failure);
  assert.equal(calls, 2);
  assert.equal(f.records.at(-1).kind, 'alarm_ack_write_threw');
});

test('expired or saturated trace leaves ACKs working and records expiry without sending commands', () => {
  const f = fixture();
  const token = f.observe();
  f.time(NOW + WINDOW_MS);
  f.capture.writeAlarmAck(f.socket, ACK, token);
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].length, 1);
  assert.equal(f.stopped[0].reason, 'window_ended');
  const bounded = fixture();
  for (let i = 0; i < MAX_RECORDS + 10; i++) bounded.observe(packet('UD_LTE', '00000000'));
  assert.equal(bounded.records.length, MAX_RECORDS);
  assert.equal(bounded.stopped.length, 1);
  assert.equal(bounded.stopped[0].reason, 'record_limit');
  assert.equal(bounded.writes.length, 0);
});

test('diagnostic writer/logger failure cannot block acknowledgement or socket handling', () => {
  const f = fixture({ write: () => { throw new Error('disk failed'); },
    onStop: () => { throw new Error('logger failed'); } });
  const token = f.observe();
  assert.equal(token, null);
  assert.doesNotThrow(() => f.capture.writeAlarmAck(f.socket, ACK, token));
  assert.equal(f.writes.length, 1);
  assert.doesNotThrow(() => f.capture.observeSocket('socket_closed', f.socket, session()));
});

test('sessions and close reasons are correlated while peer identity and error messages stay private', () => {
  const f = fixture();
  f.observe();
  f.capture.observeSocket('peer_end', f.socket, session(), { peerEndAt: new Date(NOW).toISOString() });
  f.capture.observeSocket('socket_closed', f.socket, session(), {
    connectedAt: new Date(NOW - 1000).toISOString(), lastDataAt: new Date(NOW).toISOString(),
    peerEndAt: new Date(NOW).toISOString(), hadError: false, localCloseReason: 'packet_idle_timeout',
    bytesRead: 987, bytesWritten: 23, remote: 'private-address', message: 'private-message',
  });
  assert.equal(f.records.at(-1).session, f.records[0].session);
  assert.equal(f.records.at(-1).localCloseReason, 'packet_idle_timeout');
  assert.equal(f.records.at(-1).hadError, false);
  assert.equal(JSON.stringify(f.records).includes('private-'), false);
  f.capture.observePacket({ socket: {}, session: session(), ...packet(), receivedAt: new Date(NOW) });
  assert.equal(f.records.at(-1).session, 2);
});

test('real TCP client receives exactly the unchanged ACK and the trace preserves end/close ordering', { timeout: 5000 }, async t => {
  const records = [];
  const capture = createWearCapture({ enabled: true, pilotImei: IMEI, write: r => records.push(r) });
  let accepted;
  const server = net.createServer(socket => {
    accepted = socket;
    const token = capture.observePacket({ socket, session: session(), ...packet(), receivedAt: new Date() });
    capture.writeAlarmAck(socket, ACK, token);
    socket.on('end', () => capture.observeSocket('peer_end', socket, session()));
    socket.on('close', hadError => capture.observeSocket('socket_closed', socket, session(), { hadError }));
  });
  t.after(() => { accepted?.destroy(); server.close(); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const client = net.createConnection({ host: '127.0.0.1', port: server.address().port });
  t.after(() => client.destroy());
  const received = [];
  client.on('data', chunk => { received.push(chunk); client.end(); });
  await once(client, 'close');
  if (!accepted.closed) await once(accepted, 'close');
  assert.deepEqual(Buffer.concat(received), ACK);
  assert.equal(records.filter(r => r.kind === 'alarm_ack_write_completed').length, 1);
  assert.equal(records.find(r => r.kind === 'alarm_ack_write_completed').deliveryConfirmed, false);
  assert.deepEqual(records.slice(-2).map(r => r.kind), ['peer_end', 'socket_closed']);
});

test('runtime persists a private bounded file and a failed logger does not stop capture', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'guardian-wear-capture-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const capture = startWearCapture({ enabled: true, pilotImei: IMEI, directory,
    log: () => { throw new Error('console unavailable'); } });
  capture.observePacket({ socket: {}, session: session(), ...packet(), receivedAt: new Date() });
  capture.stop();
  await capture.closed;
  const records = (await fs.readFile(capture.savedTo, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(records.map(r => r.kind), ['capture_started', 'packet_received', 'capture_finished']);
  assert.equal(records[0].changesWatchSettings, false);
  if (process.platform !== 'win32') assert.equal((await fs.stat(capture.savedTo)).mode & 0o777, 0o600);
  assert.throws(() => startWearCapture({ enabled: true, pilotImei: '' }), /WIFI_HOME_PILOT_IMEI/);
});

test('real decoder preserves removal ACKs across fragmented and coalesced incoming frames', () => {
  const { extractFrames, decodeFrame, handlePacket } = require('../src/protocol/gt06');
  const input = Buffer.concat([packet().frame, packet('AL_LTE', '00100008').frame]);
  const partial = extractFrames(input.subarray(0, 12));
  assert.equal(partial.frames.length, 0);
  const { frames } = extractFrames(Buffer.concat([partial.rest, input.subarray(12)]));
  assert.equal(frames.length, 2);
  const currentSession = {}, records = [], writes = [];
  let capture;
  const socket = { write(bytes, callback) { writes.push(Buffer.from(bytes)); callback?.(); return true; } };
  for (const frame of frames) {
    const decoded = decodeFrame(frame);
    const result = handlePacket(decoded, currentSession);
    assert.equal(result.events[0].alarmType, 'bracelet_removed');
    capture ||= createWearCapture({ enabled: true, pilotImei: currentSession.imei,
      write: record => records.push(record) });
    const before = structuredClone(result);
    const token = capture.observePacket({ socket, session: currentSession, frame, decoded, receivedAt: new Date() });
    assert.ok(token);
    for (const ack of result.acks) capture.writeAlarmAck(socket, ack, token);
    assert.deepEqual(structuredClone(result), before);
  }
  assert.deepEqual(writes, [ACK, ACK]);
  assert.deepEqual(records.filter(r => r.kind === 'packet_received').map(r => r.setBits), [[20], [3, 20]]);
  assert.deepEqual(records.filter(r => r.kind === 'alarm_ack_write_completed').map(r => r.packet), [1, 2]);
});
