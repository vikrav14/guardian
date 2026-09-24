'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { once } = require('node:events');
const { MAX_CAPTURE_BYTES, parseCaptureFile, prepareCapturedAnswerTrial, sendCapturedAnswerTrial } = require('../src/captured-answer-mode-trial');
const { readCapture, runCapturedTrial } = require('../scripts/trial-captured-answer-mode');
const { decodeFrame, handlePacket } = require('../src/protocol/gt06');
const { redactDownlinkCommand } = require('../src/downlink');
const { registerSession, unregisterSession } = require('../src/sessions');

// Synthetic device and contact only. Never copy the private pilot capture here.
const imei = '861397000000000', protocolId = '9700000000', phone = '0023050000000';
const autoFrame = `[3G*${protocolId}*0013*ACALL,${phone}]`;
const manualFrames = [`[3G*${protocolId}*000c*APPLOCK,JT-0]`, `[3G*${protocolId}*0007*ACALL,0]`];
const key = 'synthetic-captured-trial-key';

function capture() {
  return [autoFrame, `[3G*${protocolId}*0005*ACALL]`, ...manualFrames,
    `[3G*${protocolId}*0007*APPLOCK]`, `[3G*${protocolId}*0005*ACALL]`].map((frame, i) => ({
    event: 'private_answer_frame', at: new Date(Date.UTC(2026, 8, 23, 17, 4, i)).toISOString(),
    session: i < 2 ? 1 : 2, direction: [0, 2, 3].includes(i) ? 'server_to_watch' : 'watch_to_server',
    command: i === 2 || i === 4 ? 'APPLOCK' : 'ACALL', prefix: '3G', lengthField: frame.split('*')[2],
    frameHex: Buffer.from(frame).toString('hex'), appliedStateVerified: false,
  }));
}
const request = (mode = 'auto') => ({ imei, mode, capture: capture() });

function fixtureFile(t, content = capture().map(row => JSON.stringify(row)).join('\r\n')) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guardian-captured-trial-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'private.jsonl');
  fs.writeFileSync(file, content, { mode: 0o600 });
  return file;
}

test('captured transitions preserve exact 3G bytes, lowercase length and Manual order', () => {
  for (const mode of ['auto', 'manual']) {
    const prepared = prepareCapturedAnswerTrial(request(mode));
    assert.equal(prepared.bytes.toString(), mode === 'auto' ? autoFrame : manualFrames.join(''));
    assert.equal(prepared.metadata.frameCount, mode === 'auto' ? 1 : 2);
    assert.equal(prepared.metadata.appliedStateVerified, false);
    assert.equal(prepared.metadata.callerScopeVerified, false);
    assert.equal(prepared.metadata.automaticExpiry, false);
    assert.ok(!JSON.stringify(prepared.metadata).includes(phone));
  }
});

test('unsupported, tampered, reordered and mixed-device captures never write', () => {
  const mutations = [
    input => { input.capture[0].frameHex = Buffer.from(autoFrame.replace('0013', '0012')).toString('hex'); },
    input => { input.capture[0].frameHex = Buffer.from(autoFrame.replace('3G', 'SG')).toString('hex'); },
    input => { input.capture[0].frameHex = Buffer.from(autoFrame.replace(phone, '1')).toString('hex'); },
    input => { input.capture[0].frameHex = Buffer.from(autoFrame.replace('ACALL', 'RESET')).toString('hex'); },
    input => { input.capture[2].frameHex = Buffer.from(manualFrames[0].replace('JT-0', 'JT-1')).toString('hex'); },
    input => { input.capture[2].frameHex = Buffer.from(manualFrames[0].replace('000c', '000C')).toString('hex'); },
    input => { input.capture[1].frameHex = Buffer.from(`[3G*9700000001*0005*ACALL]`).toString('hex'); },
    input => { input.capture[2].direction = 'watch_to_server'; },
    input => { input.capture[0].command = 'ANS'; },
    input => { input.capture[3].session = 3; },
    input => { input.capture[0].appliedStateVerified = true; },
    input => { input.capture[5].at = '2025-01-01'; },
    input => { input.capture[0].frameHex += '5d'; },
    input => { input.capture[0].frameHex = 'zz'; },
    input => { input.capture[0].frameHex += '\n'; },
    input => { input.capture[0].frameHex += '0a'; },
    input => { input.capture[0].extra = 'raw'; },
    input => { input.capture.push(input.capture[0]); },
    input => { input.capture.splice(1, 1); },
    input => { [input.capture[2], input.capture[3]] = [input.capture[3], input.capture[2]]; },
    input => { input.mode = 'raw'; },
    input => { input.imei = 861397000000000; },
    input => { input.raw = 'FIND'; },
  ];
  for (const mutate of mutations) {
    const input = request(); mutate(input);
    assert.throws(() => sendCapturedAnswerTrial(input, { findSessions: () => assert.fail('must reject before session lookup') }),
      { message: 'invalid_reference_capture' });
  }
});

test('only freshest identified socket receives one ordered Manual write; false is backpressure', () => {
  const writes = [], now = 1000000;
  const candidate = (label, age) => ({ socket: { write: bytes => { writes.push([label, bytes.toString()]); return false; } },
    session: { imei, protocolId, lastPacketAt: now - age } });
  const candidates = [candidate('old', 50000), candidate('fresh', 1000), candidate('closed', 0)];
  candidates[2].socket.destroyed = true;
  const result = sendCapturedAnswerTrial(request('manual'), { now: () => now, findSessions: () => candidates });
  assert.equal(result.outcome, 'socket_handoff');
  assert.deepEqual(writes, [['fresh', manualFrames.join('')]]);
  assert.equal(result.sessions, 1);
});

test('offline, unidentified, stale, closed and wrong device sessions write nothing', () => {
  const now = 1000000;
  for (const overrides of [null, { imei: null }, { imei: '861397000000001' }, { protocolId: null },
    { protocolId: '9700000001' }, { lastPacketAt: now - 120001 }, { lastPacketAt: now + 1 }]) {
    const candidates = overrides === null ? [] : [{ socket: { write: () => assert.fail('must not send') },
      session: { imei, protocolId, lastPacketAt: now, ...overrides } }];
    assert.equal(sendCapturedAnswerTrial(request(), { now: () => now, findSessions: () => candidates }).outcome, 'not_sent');
  }
  for (const flags of [{ destroyed: true }, { writableEnded: true }, { writable: false }]) {
    const candidates = [{ socket: { ...flags, write: () => assert.fail('must not send') }, session: { imei, protocolId, lastPacketAt: now } }];
    assert.equal(sendCapturedAnswerTrial(request(), { now: () => now, findSessions: () => candidates }).outcome, 'not_sent');
  }
});

test('a throwing write is uncertain and never retried on the other session', () => {
  let writes = 0;
  const now = 1000000;
  const candidates = [0, 1].map(age => ({ socket: { write: () => { writes++; throw new Error(phone); } },
    session: { imei, protocolId, lastPacketAt: now - age } }));
  const result = sendCapturedAnswerTrial(request('manual'), { now: () => now, findSessions: () => candidates });
  assert.equal(writes, 1); assert.equal(result.outcome, 'handoff_unknown');
  assert.ok(!JSON.stringify(result).includes(phone));
});

test('ACALL replies do not create ACK loops or expose the argument in protocol events/log formatting', () => {
  for (const frame of [`[3G*${protocolId}*0005*ACALL]`, autoFrame]) {
    const result = handlePacket(decodeFrame(Buffer.from(frame)), { imei, protocolId });
    assert.deepEqual(result.acks, []);
    assert.equal(result.events[0].type, 'command_echo');
    assert.equal(result.events[0].command, 'ACALL');
    assert.ok(!JSON.stringify(result).includes(phone));
  }
  assert.equal(redactDownlinkCommand(`ACALL,${phone}`), 'ACALL,<argument-redacted>');
});

test('private file preview is bounded, read-only, redacted and performs no network request', async t => {
  const file = fixtureFile(t, '\uFEFF' + capture().map(row => JSON.stringify(row)).join('\r\n'));
  const original = fs.readFileSync(file);
  const output = [];
  const args = ['--imei', imei, '--mode', 'auto', '--capture-file', file];
  assert.equal(await runCapturedTrial({ args, config: {}, fetchImpl: () => assert.fail('preview network'), print: text => output.push(JSON.parse(text)) }), 0);
  assert.equal(output[0].outcome, 'preview');
  assert.equal(output[0].commandSent, false);
  assert.ok(!JSON.stringify(output).includes(phone));
  assert.ok(!JSON.stringify(output).includes(capture()[0].frameHex));
  assert.deepEqual(fs.readFileSync(file), original);
  assert.throws(() => parseCaptureFile('bad ' + phone), { message: 'invalid_reference_capture' });
  fs.writeFileSync(file, 'x'.repeat(MAX_CAPTURE_BYTES + 1));
  assert.throws(() => readCapture(file), { message: 'private_capture_unavailable_or_invalid' });
});

test('CLI rejects response mismatch and ambiguous failures without retries or private errors', async t => {
  const file = fixtureFile(t);
  const args = ['--imei', imei, '--mode', 'auto', '--capture-file', file, '--send'];
  for (const failure of ['timeout', 'mismatch', 'rejection']) {
    let calls = 0; const output = [];
    const code = await runCapturedTrial({ args, config: { adminApiKey: key, httpPort: 9001 }, print: text => output.push(text),
      fetchImpl: async (url, options) => {
        calls++;
        assert.equal(url, 'http://127.0.0.1:9001/admin/watch-answer-trial');
        assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error');
        assert.equal(options.headers['X-Admin-Key'], key);
        assert.deepEqual(JSON.parse(options.body), request());
        if (failure === 'timeout') throw new Error(phone + key);
        if (failure === 'rejection') return { ok: false, status: 500, json: async () => ({ error: phone + key }) };
        return { ok: true, json: async () => ({ ok: true, ...prepareCapturedAnswerTrial(request()).metadata,
          sequenceDigest: 'wrong', outcome: 'socket_handoff', sessions: 1 }) };
      } });
    assert.equal(code, 1); assert.equal(calls, 1);
    assert.equal(JSON.parse(output[0]).outcome, 'handoff_unknown');
    assert.ok(!output.join('').includes(phone)); assert.ok(!output.join('').includes(key));
  }
});

test('strict admin HTTP + private-file CLI deliver exact bytes over real TCP for both transitions', async t => {
  const config = require('../src/config');
  const { startHttpServer } = require('../src/http');
  const { stopContextRuntimeForTests } = require('../src/context/contextRuntime');
  const saved = Object.fromEntries(['host', 'httpPort', 'adminApiKey', 'contextIntelligenceEnabled',
    'contextCapEnabled', 'contextDefiMediaEnabled'].map(name => [name, config[name]]));
  Object.assign(config, { host: '127.0.0.1', httpPort: 0, adminApiKey: key,
    contextIntelligenceEnabled: false, contextCapEnabled: false, contextDefiMediaEnabled: false });
  const tcp = net.createServer(); tcp.listen(0, '127.0.0.1'); await once(tcp, 'listening');
  const connection = once(tcp, 'connection');
  const client = net.connect(tcp.address().port, '127.0.0.1');
  const [socket] = await connection;
  registerSession(socket, { imei, protocolId });
  const server = startHttpServer();
  t.after(() => { server.closeAllConnections(); server.close(); unregisterSession(socket);
    socket.destroy(); client.destroy(); tcp.close(); stopContextRuntimeForTests(); Object.assign(config, saved); });
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/admin/watch-answer-trial`;
  const file = fixtureFile(t);
  const headers = { 'X-Admin-Key': key, 'Content-Type': 'application/json' };
  for (const item of [
    { method: 'POST', headers: {}, expected: 401 },
    { method: 'POST', headers: { 'X-Admin-Key': 'wrong' }, expected: 401 },
    { method: 'GET', headers, expected: 405 },
    { method: 'POST', headers, query: '?raw=ACALL', expected: 400 },
    { method: 'POST', headers, body: '{' + phone, expected: 400 },
    { method: 'POST', headers, body: 'x'.repeat(MAX_CAPTURE_BYTES + 1), expected: 413 },
    { method: 'POST', headers, body: JSON.stringify({ ...request(), mode: 'raw' }), expected: 400 },
  ]) {
    const response = await fetch(url + (item.query || ''), { method: item.method, headers: item.headers,
      ...(item.method === 'POST' ? { body: item.body || JSON.stringify(request()) } : {}) });
    assert.equal(response.status, item.expected);
    assert.ok(!(await response.text()).includes(phone));
  }
  config.adminApiKey = '';
  const devOpen = await fetch(url, { method: 'POST', body: JSON.stringify(request()) });
  assert.equal(devOpen.status, 503); await devOpen.text(); config.adminApiKey = key;
  assert.equal(socket.bytesWritten, 0);

  for (const mode of ['auto', 'manual']) {
    const expected = mode === 'auto' ? autoFrame : manualFrames.join('');
    const received = new Promise((resolve, reject) => {
      const chunks = [];
      const onData = chunk => { chunks.push(chunk); if (Buffer.concat(chunks).length >= expected.length) {
        clearTimeout(timer); client.off('data', onData); resolve(Buffer.concat(chunks)); } };
      const timer = setTimeout(() => { client.off('data', onData); reject(new Error('No TCP bytes')); }, 2000);
      client.on('data', onData);
    });
    const output = [], logs = [];
    const log = console.log;
    console.log = (...items) => logs.push(items.join(' '));
    try {
      assert.equal(await runCapturedTrial({ args: ['--imei', imei, '--mode', mode, '--capture-file', file, '--send'],
        config: { adminApiKey: key, httpPort: server.address().port }, print: text => output.push(text),
        fetchImpl: async (...args) => {
          const response = await fetch(...args);
          const body = await response.clone().text();
          assert.ok(!body.includes(phone)); assert.ok(!body.includes(capture()[0].frameHex));
          return response;
        } }), 0);
      assert.deepEqual(await received, Buffer.from(expected));
    } finally { console.log = log; }
    assert.equal(JSON.parse(output[0]).outcome, 'socket_handoff');
    assert.ok(![...output, ...logs].join('').includes(phone));
    assert.ok(![...output, ...logs].join('').includes(capture()[0].frameHex));
    assert.ok(![...output, ...logs].join('').includes(key));
  }
});
