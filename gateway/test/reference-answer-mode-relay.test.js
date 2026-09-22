'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { once } = require('node:events');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { parseArguments, restorationPlan, FrameObserver, frameSummary, startRelay, createPrivateAnswerCapture } = require('../scripts/capture-reference-answer-mode');

const ID = '1234567890';
const frame = (body, id = ID) => {
  const content = Buffer.isBuffer(body) ? body : Buffer.from(body);
  return Buffer.concat([Buffer.from(`[SG*${id}*${content.length.toString(16).padStart(4, '0')}*`), content, Buffer.from(']')]);
};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

test('CLI is preview-only by default, requires explicit identity and cannot replace live gateway ports or upstream', () => {
  assert.deepEqual(parseArguments(['--protocol-id', ID]), { protocolId: ID, listenPort: 9002, minutes: 15, run: false });
  for (const args of [[], ['--protocol-id', '123'], ['--protocol-id', ID, '--listen-port', '9000'],
    ['--protocol-id', ID, '--listen-port', '9001'], ['--protocol-id', ID, '--minutes', '21'],
    ['--protocol-id', ID, '--minutes', '1.5'], ['--protocol-id', ID, '--upstream', 'localhost'],
    ['--protocol-id', ID, '--run', '--run']]) assert.throws(() => parseArguments(args));
  const result = spawnSync(process.execPath, [path.join(__dirname, '../scripts/capture-reference-answer-mode.js'), '--protocol-id', ID],
    { encoding: 'utf8', timeout: 3000, env: {} });
  assert.equal(result.status, 0);
  const preview = JSON.parse(result.stdout);
  assert.equal(preview.networkOpened, false);
  assert.equal(preview.commandsGenerated, false);
  assert.equal(preview.referenceHost, 'a.igps123.com');
  assert.equal(preview.referencePort, 7720);
});

test('same-watch preview retains a distinct Guardian return route without opening a network', () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, '../scripts/capture-reference-answer-mode.js'),
    '--protocol-id', ID, '--guardian-return-host', 'guardian.example.test', '--guardian-return-port', '23456'],
  { encoding: 'utf8', timeout: 3000, env: {} });
  assert.equal(result.status, 0);
  const preview = JSON.parse(result.stdout);
  assert.equal(preview.networkOpened, false);
  assert.equal(preview.commandsGenerated, false);
  assert.equal(preview.captureMode, 'same_watch_comparison');
  assert.equal(preview.referenceHost, 'a.igps123.com');
  assert.equal(preview.referencePort, 7720);
  assert.equal(preview.restoreCommand, 'ip,guardian.example.test,23456#');
  assert.equal(preview.returnRouteVerified, false);
  assert.equal(preview.routingRestored, false);
  assert.equal(preview.guardianTelemetryPausedDuringComparison, true);
  assert.equal(restorationPlan({}).restoreCommand, 'ip,a.igps123.com,7720#');
});

test('return options must be paired and cannot inject another SMS command or use malformed endpoints', () => {
  const base = ['--protocol-id', ID];
  assert.throws(() => parseArguments([...base, '--guardian-return-host', 'guardian.example.test']));
  assert.throws(() => parseArguments([...base, '--guardian-return-port', '23456']));
  for (const host of ['https://guardian.example.test', 'x.test,1#RESET', 'x.test\n', 'x..test',
    '-x.test', 'x-.test', 'localhost', 'x.localhost', '127.0.0.1', '0.0.0.0', '999.1.1.1', 'x.test:123',
    'a'.repeat(64) + '.test']) {
    assert.throws(() => parseArguments([...base, '--guardian-return-host', host, '--guardian-return-port', '23456']));
  }
  for (const port of ['0', '65536', '2.5', '1,2#', '1e3']) {
    assert.throws(() => parseArguments([...base, '--guardian-return-host', 'guardian.example.test', '--guardian-return-port', port]));
  }
});

test('observer handles fragmentation, coalescing and binary delimiters without leaking private payloads', () => {
  const rows = [];
  const observer = new FrameObserver({ protocolId: ID, direction: 'server_to_watch', emit: row => rows.push(row) });
  const control = frame('APPLOCK,JT-0');
  const privateData = frame('PHBX,1,Private Name,+23050000000');
  const binary = frame(Buffer.from([0x50, 0x49, 0x43, 0x2c, 0x5d, 0xff, 0x5b, 0, 0x2a]));
  const data = Buffer.concat([control, privateData, binary, frame('OTHERFLAG,1'), frame('CONFIG,JT:0,phone:+23050000000')]);
  for (let i = 0; i < data.length; i += 7) observer.push(data.subarray(i, i + 7));
  observer.finish();
  assert.deepEqual(rows.map(row => row.command), ['APPLOCK', 'PHBX', 'PIC', 'OTHERFLAG', 'CONFIG']);
  assert.equal(rows[0].frameHex, control.toString('hex'));
  assert.equal(rows[0].lengthField, '000c');
  assert.equal(rows[0].appliedStateVerified, false);
  assert.equal(rows[1].frame, undefined);
  assert.equal(rows[2].frame, undefined);
  assert.equal(rows[3].frame, frame('OTHERFLAG,1').toString());
  assert.equal(rows[4].reportedJt, 0);
  assert.equal(JSON.stringify(rows).includes('Private Name'), false);
  assert.equal(JSON.stringify(rows).includes('+23050000000'), false);
});

test('uplink telemetry and parameterized replies remain redacted; high-bit input cannot become ASCII control', () => {
  for (const body of ['UD_LTE,010126,123456,A,-20.123,57.456', 'APPLOCK,JT-0,+23050000000', 'VERNO,private-version']) {
    const row = frameSummary(frame(body), ID, 'watch_to_server');
    assert.equal(row.argumentsRedacted, true);
    assert.equal(row.frame, undefined);
  }
  assert.equal(frameSummary(frame('APPLOCK'), ID, 'watch_to_server').argumentsRedacted, false);
  const altered = Buffer.from('APPLOCK,JT-0'); altered[0] += 128;
  assert.equal(frameSummary(frame(altered), ID, 'server_to_watch').frame, undefined);
  assert.equal(frameSummary(frame('APPLOCK,JT-0', '9999999999'), ID, 'server_to_watch'), null);
});

test('framing loss stops inspection without guessing subsequent frames; incomplete captures are explicit', () => {
  const rows = [];
  const observer = new FrameObserver({ protocolId: ID, direction: 'server_to_watch', emit: row => rows.push(row) });
  observer.push(Buffer.from(`[SG*${ID}*0001*APPLOCK,JT-0]`));
  observer.push(frame('APPLOCK,JT-1'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].reason, 'invalid_frame_boundary');
  assert.equal(observer.buffer.length, 0);
  const partial = new FrameObserver({ protocolId: ID, direction: 'watch_to_server', emit: row => rows.push(row) });
  partial.push(frame('APPLOCK').subarray(0, 24)); partial.finish();
  assert.equal(rows[1].event, 'observation_incomplete');
});

async function fixture(t, overrides = {}, options = {}) {
  const received = [], rows = [], referenceSockets = [];
  let connected = 0;
  const reference = net.createServer(socket => {
    referenceSockets.push(socket);
    socket.on('error', () => {});
    socket.on('data', data => received.push(data));
  });
  reference.listen(0, '127.0.0.1'); await once(reference, 'listening');
  const relay = await startRelay({ protocolId: ID, listenPort: 0, minutes: 1, ...options }, {
    emit: row => rows.push(row),
    connect: () => { connected++; return net.createConnection(reference.address().port, '127.0.0.1'); },
    ...overrides,
  });
  const watch = net.createConnection(relay.server.address().port, '127.0.0.1');
  watch.on('error', () => {});
  await once(watch, 'connect');
  t.after(async () => {
    watch.destroy(); await relay.stop();
    for (const socket of referenceSockets) socket.destroy();
    await new Promise(resolve => reference.close(resolve));
  });
  return { received, rows, referenceSockets, relay, watch, connectionCount: () => connected };
}

async function until(predicate) {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await pause(10); }
  assert.fail('Timed out waiting for local relay result');
}

test('relay forwards exact bytes in both directions, generates no ACKs, and preserves forwarding after observation loss', { timeout: 5000 }, async t => {
  const f = await fixture(t);
  const input = Buffer.concat([frame('LK,42,0,80'), frame(Buffer.from('PHOTO,\x00]binary[\xff', 'latin1'))]);
  f.watch.write(input.subarray(0, 6));
  await pause(20);
  assert.equal(f.connectionCount(), 0, 'upstream must wait for target identification');
  f.watch.write(input.subarray(6));
  await until(() => Buffer.concat(f.received).length === input.length);
  assert.deepEqual(Buffer.concat(f.received), input);
  const returned = [];
  f.watch.on('data', data => returned.push(data));
  const reply = frame('APPLOCK,JT-0');
  f.referenceSockets[0].write(reply.subarray(0, 8)); f.referenceSockets[0].write(reply.subarray(8));
  await until(() => Buffer.concat(returned).length === reply.length);
  assert.deepEqual(Buffer.concat(returned), reply);
  assert.equal(f.rows.some(row => row.frame === reply.toString()), true);
  assert.deepEqual(Buffer.concat(f.received), input, 'relay must not generate an ACK to APPLOCK');
  const malformed = Buffer.from(`[SG*${ID}*0001*APPLOCK,JT-1]`);
  f.referenceSockets[0].write(malformed);
  await until(() => Buffer.concat(returned).length === reply.length + malformed.length);
  assert.deepEqual(Buffer.concat(returned), Buffer.concat([reply, malformed]));
  assert.equal(f.rows.some(row => row.event === 'observation_stopped'), true);
  await f.relay.stop();
  assert.equal(f.rows.some(row => row.event === 'relay_stopped' && row.routingRestored === false), true);
});

test('wrong watch never opens a reference connection', { timeout: 5000 }, async t => {
  const f = await fixture(t);
  const closed = once(f.watch, 'close');
  f.watch.write(frame('LK,0,0,90', '9999999999'));
  await closed;
  assert.equal(f.connectionCount(), 0);
  assert.equal(f.rows.some(row => row.reason === 'identity_not_allowed'), true);
  assert.equal(JSON.stringify(f.rows).includes('9999999999'), false);
});

test('unidentified sockets expire without opening a reference connection', { timeout: 5000 }, async t => {
  const f = await fixture(t, { identifyTimeoutMs: 30, durationMs: 150 });
  await once(f.watch, 'close');
  assert.equal(f.connectionCount(), 0);
  assert.equal(f.rows.some(row => row.reason === 'identification_timeout'), true);
  await until(() => f.rows.some(row => row.event === 'relay_stopped'));
  assert.equal(f.rows.find(row => row.event === 'relay_stopped').reason, 'capture_window_ended');
  assert.equal(f.rows.find(row => row.event === 'relay_stopped').routingRestored, false);
});

test('capture expiry closes a connected watch and reference socket', { timeout: 5000 }, async t => {
  const f = await fixture(t, { durationMs: 300 });
  f.watch.write(frame('LK,0,0,90'));
  await until(() => f.rows.some(row => row.event === 'reference_connected'));
  await once(f.watch, 'close');
  await until(() => f.rows.some(row => row.event === 'relay_stopped'));
  assert.equal(f.relay.server.listening, false);
  assert.equal(f.rows.find(row => row.event === 'relay_stopped').routingRestored, false);
});

test('same-watch stop prints Guardian restoration and continues forwarding supplier commands unchanged', { timeout: 5000 }, async t => {
  const f = await fixture(t, {}, { guardianReturn: { host: 'guardian.example.test', port: 23456 } });
  const uplink = frame('LK,0,0,90');
  f.watch.write(uplink);
  await until(() => Buffer.concat(f.received).length === uplink.length);
  const returned = [];
  f.watch.on('data', data => returned.push(data));
  const downlink = frame('APPLOCK,JT-0');
  f.referenceSockets[0].write(downlink);
  await until(() => Buffer.concat(returned).length === downlink.length);
  assert.deepEqual(Buffer.concat(returned), downlink);
  assert.deepEqual(Buffer.concat(f.received), uplink);
  assert.equal(f.rows[0].referenceHost, 'a.igps123.com');
  assert.equal(f.rows[0].returnHost, 'guardian.example.test');
  await f.relay.stop();
  const stopped = f.rows.find(row => row.event === 'relay_stopped');
  assert.equal(stopped.restoreCommand, 'ip,guardian.example.test,23456#');
  assert.equal(stopped.routingRestored, false);
});

test('same-watch expiry retains the Guardian return route and never claims to restore it', { timeout: 5000 }, async t => {
  const f = await fixture(t, { durationMs: 200 }, { guardianReturn: { host: 'guardian.example.test', port: 23456 } });
  f.watch.write(frame('LK,0,0,90'));
  await until(() => f.rows.some(row => row.event === 'reference_connected'));
  await once(f.watch, 'close');
  await until(() => f.rows.some(row => row.event === 'relay_stopped'));
  const stopped = f.rows.find(row => row.event === 'relay_stopped');
  assert.equal(stopped.reason, 'capture_window_ended');
  assert.equal(stopped.restoreCommand, 'ip,guardian.example.test,23456#');
  assert.equal(stopped.returnRouteVerified, false);
  assert.equal(stopped.routingRestored, false);
});

function privateFile(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'guardian-answer-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return path.join(directory, 'answer.jsonl');
}

test('private capture preview creates no file, requires an absolute path and never overwrites a file', t => {
  const file = privateFile(t);
  assert.throws(() => parseArguments(['--protocol-id', ID, '--private-answer-file', 'relative.jsonl']));
  const result = spawnSync(process.execPath, [path.join(__dirname, '../scripts/capture-reference-answer-mode.js'),
    '--protocol-id', ID, '--private-answer-file', file], { encoding: 'utf8', timeout: 3000, env: {} });
  assert.equal(result.status, 0);
  const preview = JSON.parse(result.stdout);
  assert.equal(preview.networkOpened, false);
  assert.equal(preview.privateFileCreated, false);
  assert.equal(preview.privateAnswerCaptureEnabled, true);
  assert.equal(fs.existsSync(file), false);
  fs.writeFileSync(file, 'keep existing evidence');
  assert.throws(() => createPrivateAnswerCapture(file));
  assert.equal(fs.readFileSync(file, 'utf8'), 'keep existing evidence');
});

test('private capture preserves candidate bytes through fragmented TCP forwarding while public logs stay redacted', { timeout: 5000 }, async t => {
  const file = privateFile(t);
  const f = await fixture(t, {}, { privateAnswerFile: file,
    guardianReturn: { host: 'guardian.example.test', port: 23456 } });
  f.watch.write(frame('LK,0,0,90'));
  await until(() => f.referenceSockets.length === 1);
  const returned = [];
  f.watch.on('data', data => returned.push(data));
  // Synthetic argument only; no real ACALL mode syntax is inferred here.
  const candidate = Buffer.from(frame('ACALL,TEST_ARGUMENT').toString().replace('[SG*', '[3G*'));
  const contacts = frame('PHBX,1,Private Name,+23050000000');
  const unrelated = frame('CONFIG,JT:0,phone:+23050000000');
  const otherWatch = frame('ACALL,OTHER_PRIVATE', '9999999999');
  const input = Buffer.concat([candidate, contacts, unrelated, otherWatch]);
  f.referenceSockets[0].write(input.subarray(0, 11));
  f.referenceSockets[0].write(input.subarray(11));
  await until(() => Buffer.concat(returned).length === input.length);
  assert.deepEqual(Buffer.concat(returned), input);
  f.watch.write(frame('ACALL'));
  await until(() => f.rows.filter(row => row.event === 'private_answer_capture' && row.status === 'saved').length === 2);
  await f.relay.stop();
  const captured = fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(captured.length, 2);
  assert.equal(captured[0].frameHex, candidate.toString('hex'));
  assert.equal(captured[0].prefix, '3G');
  assert.equal(captured[0].direction, 'server_to_watch');
  assert.equal(captured[0].appliedStateVerified, false);
  assert.equal(captured[1].frameHex, frame('ACALL').toString('hex'));
  const publicLog = JSON.stringify(f.rows);
  for (const privateValue of ['TEST_ARGUMENT', 'OTHER_PRIVATE', 'Private Name', '+23050000000', candidate.toString('hex')]) {
    assert.equal(publicLog.includes(privateValue), false);
  }
  const stopped = f.rows.find(row => row.event === 'relay_stopped');
  assert.equal(stopped.privateCapture.fileClosed, true);
  assert.equal(stopped.privateCapture.recordsSaved, 2);
  assert.equal(stopped.routingRestored, false);
});

test('private capture is bounded by frame count and frame size and excludes other commands', t => {
  const file = privateFile(t);
  const writer = createPrivateAnswerCapture(file);
  const row = { at: '2026-01-01T00:00:00.000Z', session: 1, direction: 'server_to_watch', command: 'ACALL' };
  assert.equal(writer.record(frame('PHBX,private'), { ...row, command: 'PHBX' }), null);
  for (let i = 0; i < 64; i++) assert.equal(writer.record(frame('ACALL,TEST_ARGUMENT'), row).status, 'saved');
  assert.equal(writer.record(frame('ACALL,TEST_ARGUMENT'), row).status, 'limit_reached');
  assert.equal(writer.record(frame('ACALL,TEST_ARGUMENT'), row), null);
  assert.equal(writer.close().limited, true);
  assert.equal(fs.readFileSync(file, 'utf8').trim().split('\n').length, 64);
  const oversized = createPrivateAnswerCapture(file + '.large');
  assert.equal(oversized.record(frame('ACALL,' + 'x'.repeat(512)), row).status, 'limit_reached');
  oversized.close();
  assert.equal(fs.statSync(file + '.large').size, 0);
});

test('short writes preserve every byte; write failures report once without throwing into the forwarding path', t => {
  const file = privateFile(t);
  const row = { direction: 'server_to_watch', command: 'ACALL' };
  const content = frame('ACALL,TEST_ARGUMENT');
  const short = createPrivateAnswerCapture(file, { write: (fd, buffer, offset, length) =>
    fs.writeSync(fd, buffer, offset, Math.min(length, 7)) });
  assert.equal(short.record(content, row).status, 'saved');
  short.close();
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).frameHex, content.toString('hex'));
  const failing = createPrivateAnswerCapture(file + '.failed', { write: () => { throw new Error('private internal failure'); } });
  assert.deepEqual(failing.record(content, row), { status: 'write_failed', recordsSaved: 0 });
  assert.equal(failing.record(content, row), null);
  assert.deepEqual(failing.status(), { recordsSaved: 0, limited: false, failed: true, fileClosed: true });
});

test('expiry closes the private file and retains Guardian restoration guidance', { timeout: 5000 }, async t => {
  const file = privateFile(t);
  const f = await fixture(t, { durationMs: 200 }, { privateAnswerFile: file,
    guardianReturn: { host: 'guardian.example.test', port: 23456 } });
  f.watch.write(frame('LK,0,0,90'));
  await until(() => f.rows.some(row => row.event === 'reference_connected'));
  await until(() => f.rows.some(row => row.event === 'relay_stopped'));
  const stopped = f.rows.find(row => row.event === 'relay_stopped');
  assert.equal(stopped.privateCapture.fileClosed, true);
  assert.equal(stopped.restoreCommand, 'ip,guardian.example.test,23456#');
  fs.renameSync(file, file + '.closed');
});
