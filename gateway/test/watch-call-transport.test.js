'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter, once } = require('node:events');
const net = require('node:net');
const { observeWatchCallPacket, sendWatchCallWithReplies } = require('../src/watch-call-transport');
const { prepareCapturedAnswerTrial } = require('../src/captured-answer-mode-trial');
const { registerSession, unregisterSession, getSession, noteSessionPacket } = require('../src/sessions');
const { extractFrames, decodeFrame, buildAckFrame } = require('../src/protocol/gt06');
const { imei, protocolId, phone, capturedFrames } = require('../test-fixtures/watch-call-fixture');

const clock = Date.parse('2026-09-23T18:22:45Z');
const input = mode => ({ imei, mode, capture: capturedFrames() });
const version = 'C403H_SYNTHETIC_V52_TEST';
function candidate(id, onWrite = () => {}) {
  const socket = new EventEmitter();
  const row = { socket, writes: [], session: { imei, protocolId, connectionId: id, lastPacketAt: clock } };
  socket.write = (bytes, callback) => { row.writes.push(Buffer.from(bytes)); onWrite(bytes.toString(), row, callback); return false; };
  return row;
}
function reply(row, command, args = []) {
  observeWatchCallPacket(row.socket, { imei: protocolId, command, args }, row.session);
}
function respond(bytes, row) {
  queueMicrotask(() => {
    if (bytes.includes('*VERNO]')) reply(row, 'VERNO', [version]);
    else { if (bytes.includes('APPLOCK')) reply(row, 'APPLOCK'); reply(row, 'ACALL'); }
  });
}
const options = rows => ({ now: () => clock, deadlineAt: clock + 25000, findSessions: () => rows,
  probeTimeoutMs: 20, replyTimeoutMs: 20, log: () => {} });

test('app Auto and Manual wait for same-socket replies and preserve captured bytes', async () => {
  for (const mode of ['auto', 'manual']) {
    const row = candidate(1, respond);
    const result = await sendWatchCallWithReplies(input(mode), options([row]));
    assert.equal(result.outcome, 'device_replied');
    assert.equal(result.appliedStateVerified, false);
    assert.deepEqual(row.writes, [buildAckFrame(protocolId, 'VERNO'), prepareCapturedAnswerTrial(input(mode)).bytes]);
    assert.deepEqual(result.receivedReplies, mode === 'auto' ? ['ACALL'] : ['APPLOCK', 'ACALL']);
    assert.ok(!JSON.stringify(result).includes(phone));
    assert.equal(row.socket.listenerCount('close'), 0);
    assert.equal(row.socket.listenerCount('error'), 0);
  }
});

test('handover after selection never sends Manual to the unresponsive old socket', async () => {
  const latest = candidate(2, respond);
  const rows = [];
  const old = candidate(1, () => { rows.push(latest); }); rows.push(old);
  const result = await sendWatchCallWithReplies(input('manual'), options(rows));
  assert.equal(result.outcome, 'device_replied');
  assert.equal(old.writes.length, 1);
  assert.equal(old.writes[0].toString(), buildAckFrame(protocolId, 'VERNO').toString());
  assert.deepEqual(latest.writes[1], prepareCapturedAnswerTrial(input('manual')).bytes);
});

test('a delayed packet on an older socket does not supersede a newer identified connection', async () => {
  const old = candidate(1), latest = candidate(2, respond);
  latest.session.lastPacketAt = clock - 1;
  const result = await sendWatchCallWithReplies(input('manual'), options([old, latest]));
  assert.equal(result.outcome, 'device_replied'); assert.equal(old.writes.length, 0);
});

test('no version reply, bare echo or reply on another socket cannot authorize a mode write', async () => {
  for (const scenario of ['silence', 'bare', 'other_socket', 'wrong_identity']) {
    const other = candidate(2);
    const row = candidate(1, (bytes, row) => queueMicrotask(() => {
      if (scenario === 'bare') reply(row, 'VERNO');
      if (scenario === 'other_socket') reply(other, 'VERNO', [version]);
      if (scenario === 'wrong_identity') observeWatchCallPacket(row.socket,
        { imei: '9700000001', command: 'VERNO', args: [version] }, row.session);
    }));
    const result = await sendWatchCallWithReplies(input('manual'), options([row]));
    assert.equal(result.outcome, 'not_sent'); assert.equal(result.reason, 'connection_unconfirmed');
    assert.equal(row.writes.length, 1);
    assert.equal(row.socket.listenerCount('close'), 0);
  }
});

test('missing second Manual reply stays uncertain and does not rebroadcast or retry', async () => {
  const row = candidate(1, (bytes, row) => queueMicrotask(() => {
    if (bytes.includes('VERNO')) reply(row, 'VERNO', [version]);
    else { reply(row, 'APPLOCK'); reply(row, 'APPLOCK'); reply(row, 'ACALL', ['0']); }
  }));
  const result = await sendWatchCallWithReplies(input('manual'), options([row]));
  assert.equal(result.outcome, 'handoff_unknown'); assert.equal(result.reason, 'watch_reply_missing');
  assert.deepEqual(result.receivedReplies, ['APPLOCK']); assert.equal(row.writes.length, 2);
  reply(row, 'ACALL'); // late reply cannot revise or satisfy a future exchange.
  assert.equal(result.deviceReplyObserved, false);
});

test('connection loss and asynchronous write errors remain uncertain after the setting write', async () => {
  for (const kind of ['close', 'error', 'callback']) {
    const row = candidate(1, (bytes, row, callback) => queueMicrotask(() => {
      if (bytes.includes('VERNO')) reply(row, 'VERNO', [version]);
      else if (kind === 'callback') callback(new Error(phone));
      else row.socket.emit(kind, new Error(phone));
    }));
    const logs = [];
    const result = await sendWatchCallWithReplies(input('manual'), { ...options([row]), log: value => logs.push(value) });
    assert.equal(result.outcome, 'handoff_unknown'); assert.equal(row.writes.length, 2);
    assert.ok(!JSON.stringify([result, logs]).includes(phone));
    assert.equal(row.socket.listenerCount('close'), 0);
  }
});

test('expiry during a probe prevents a delayed mode write and releases device lock', async () => {
  let now = clock;
  const row = candidate(1, (bytes, row) => queueMicrotask(() => {
    now = clock + 30000; reply(row, 'VERNO', [version]);
  }));
  const result = await sendWatchCallWithReplies(input('auto'), { ...options([row]), now: () => now });
  assert.equal(result.outcome, 'not_sent'); assert.equal(result.reason, 'expired_before_handoff');
  assert.equal(row.writes.length, 1);
  const retry = candidate(2, respond);
  assert.equal((await sendWatchCallWithReplies(input('manual'), options([retry]))).outcome, 'device_replied');
});

test('a concurrent mode request cannot reuse another exchange or steal its replies', async () => {
  const row = candidate(1);
  const first = sendWatchCallWithReplies(input('manual'), options([row]));
  const second = await sendWatchCallWithReplies(input('auto'), options([row]));
  assert.equal(second.outcome, 'not_sent'); assert.equal(second.reason, 'transport_busy');
  assert.equal((await first).reason, 'connection_unconfirmed');
  assert.equal(row.writes.length, 1);
});

test('actual TCP receives exact Manual bytes only after version response and both bare replies complete it', async t => {
  const server = net.createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const connected = once(server, 'connection');
  const watch = net.connect(server.address().port, '127.0.0.1');
  const [socket] = await connected;
  registerSession(socket, { imei, protocolId });
  t.after(() => { unregisterSession(socket); socket.destroy(); watch.destroy(); server.close(); });
  let inbound = Buffer.alloc(0), outbound = Buffer.alloc(0);
  const observed = [];
  socket.on('data', chunk => {
    inbound = Buffer.concat([inbound, chunk]); const parsed = extractFrames(inbound); inbound = parsed.rest;
    noteSessionPacket(socket);
    for (const frame of parsed.frames) observeWatchCallPacket(socket, decodeFrame(frame), getSession(socket));
  });
  watch.on('data', chunk => {
    outbound = Buffer.concat([outbound, chunk]); const parsed = extractFrames(outbound); outbound = parsed.rest;
    for (const frame of parsed.frames) {
      const decoded = decodeFrame(frame); observed.push(frame.toString());
      const payload = decoded.command === 'VERNO' ? `VERNO,${version}` : decoded.command;
      const response = `[3G*${protocolId}*${payload.length.toString(16).padStart(4, '0')}*${payload}]`;
      watch.write(response);
    }
  });
  const result = await sendWatchCallWithReplies(input('manual'), { log: () => {}, probeTimeoutMs: 1000, replyTimeoutMs: 1000 });
  assert.equal(result.outcome, 'device_replied');
  assert.equal(observed[0], buildAckFrame(protocolId, 'VERNO').toString());
  assert.equal(observed.slice(1).join(''), prepareCapturedAnswerTrial(input('manual')).bytes.toString());
});

test('phonebook add uses the same checked socket and receipt boundary without exposing name or phone in diagnostics', async () => {
  const { sendPhonebookWithReplies } = require('../src/watch-call-transport');
  const { phonebookContactCommand } = require('../src/commands');
  const contact = { imei, protocolId, slot: 2, name: 'Éva', phone: '+23050000000' };
  const logs = [];
  const row = candidate(1, (bytes, row) => queueMicrotask(() => {
    if (bytes.includes('VERNO')) reply(row, 'VERNO', [version]); else reply(row, 'PHBX');
  }));
  const result = await sendPhonebookWithReplies(contact, { ...options([row]), log: line => logs.push(line) });
  assert.equal(result.outcome, 'device_replied'); assert.equal(result.appliedStateVerified, false);
  assert.deepEqual(row.writes[1], buildAckFrame(protocolId, phonebookContactCommand(contact)));
  assert.deepEqual(result.receivedReplies, ['PHBX']);
  assert.ok(!JSON.stringify([result, logs]).includes(contact.phone));
  assert.ok(!JSON.stringify([result, logs]).includes(contact.name));
});

test('Calls and phonebook share the same transport exclusion and cannot steal each other’s version replies', async () => {
  const { sendPhonebookWithReplies } = require('../src/watch-call-transport');
  const row = candidate(1);
  const first = sendWatchCallWithReplies(input('manual'), options([row]));
  const second = await sendPhonebookWithReplies({ imei, protocolId, slot: 2, name: 'Test', phone: '+23050000000' }, options([row]));
  assert.equal(second.reason, 'transport_busy'); await first;
  assert.equal(row.writes.length, 1);
});

test('cancelled emergency intent is checked after the probe and cannot write Auto', async () => {
  const row = candidate(1, respond);
  let checked = 0;
  const result = await sendWatchCallWithReplies(input('auto'), { ...options([row]), beforeWrite: async () => { checked++; return false; } });
  assert.equal(checked, 1); assert.equal(result.outcome, 'not_sent'); assert.equal(result.reason, 'superseded');
  assert.equal(row.writes.length, 1); assert.match(row.writes[0].toString(), /VERNO/);
});

test('emergency Auto waits for the 23-second SOS handover and writes once on the new checked socket', async () => {
  let now = clock;
  const old = candidate(1, () => { now = clock + 4000; });
  const latest = candidate(2, respond);
  const logs = [];
  const result = await sendWatchCallWithReplies(input('auto'), {
    ...options([]), now: () => now, deadlineAt: clock + 30000, waitForNewConnection: true,
    findSessions: () => now >= clock + 23000 ? [old, latest] : [old],
    sleep: async ms => { now += ms; }, log: line => logs.push(line),
  });
  assert.equal(result.outcome, 'device_replied');
  assert.equal(now, clock + 23000);
  assert.deepEqual(old.writes, [buildAckFrame(protocolId, 'VERNO')]);
  assert.deepEqual(latest.writes, [buildAckFrame(protocolId, 'VERNO'), prepareCapturedAnswerTrial(input('auto')).bytes]);
  assert.equal(logs.filter(line => line.includes('waiting_for_connection')).length, 1);
});

test('emergency reconnect wait expires without setting bytes and never accepts a late connection', async () => {
  for (const initialConnection of [false, true]) {
    let now = clock;
    const old = candidate(1), late = candidate(2, respond);
    const result = await sendWatchCallWithReplies(input('auto'), {
      ...options([]), now: () => now, deadlineAt: clock + 30000, waitForNewConnection: true,
      findSessions: () => now >= clock + 30000 ? [late] : initialConnection ? [old] : [],
      sleep: async ms => { now += ms; },
    });
    assert.equal(result.outcome, 'not_sent'); assert.equal(result.reason, 'expired_before_handoff');
    assert.equal(now, clock + 30000);
    assert.equal(old.writes.length, initialConnection ? 1 : 0); assert.equal(late.writes.length, 0);
    // Expiry releases the transport lock so Manual recovery can proceed.
    assert.equal((await sendWatchCallWithReplies(input('manual'), options([late]))).outcome, 'device_replied');
  }
});

test('emergency wait still checks cancellation and device identity before Auto', async () => {
  for (const scenario of ['cancelled', 'wrong_identity']) {
    let now = clock;
    const old = candidate(1), latest = candidate(2, respond);
    if (scenario === 'wrong_identity') latest.session.protocolId = '9700000001';
    const result = await sendWatchCallWithReplies(input('auto'), {
      ...options([]), now: () => now, deadlineAt: clock + 30000, waitForNewConnection: true,
      findSessions: () => now >= clock + 23000 ? [old, latest] : [old],
      sleep: async ms => { now += ms; }, beforeWrite: async () => false,
    });
    assert.equal(result.outcome, 'not_sent');
    assert.equal(result.reason, scenario === 'cancelled' ? 'superseded' : 'capture_device_mismatch');
    assert.equal(old.writes.length, 1);
    assert.equal(latest.writes.length, scenario === 'cancelled' ? 1 : 0);
  }
});

test('emergency Auto is never retried after a setting write even if a new connection appears', async () => {
  const latest = candidate(2, respond), rows = [];
  const old = candidate(1, (bytes, row) => queueMicrotask(() => {
    if (bytes.includes('VERNO')) reply(row, 'VERNO', [version]);
    else rows.push(latest); // Auto was written, but its receipt is unknown.
  }));
  rows.push(old);
  const result = await sendWatchCallWithReplies(input('auto'), {
    ...options(rows), waitForNewConnection: true, sleep: async () => assert.fail('must not wait after setting write'),
  });
  assert.equal(result.outcome, 'handoff_unknown');
  assert.equal(old.writes.length, 2); assert.equal(latest.writes.length, 0);
});
