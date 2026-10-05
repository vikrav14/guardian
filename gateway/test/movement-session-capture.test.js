'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { spawnSync } = require('node:child_process');
const { BACKENDS, parseArguments, createLog, frameSummary, FrameObserver, startRelay } =
  require('../scripts/capture-movement-session');
const ID = '1234567890';
const script = path.join(__dirname, '../scripts/capture-movement-session.js');
const frame = (body, prefix = '3G', id = ID) => {
  const data = Buffer.isBuffer(body) ? body : Buffer.from(body);
  return Buffer.concat([Buffer.from(`[${prefix}*${id}*${data.length.toString(16).padStart(4, '0')}*`), data, Buffer.from(']')]);
};
function temp(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'movement-session-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  return path.join(folder, 'capture.jsonl');
}
const argsFor = output => ['--backend', 'guardian', '--protocol-id', ID,
  '--return-url', 'tcp://return.example.test:23456', '--output', output];
const readRows = output => fs.readFileSync(output, 'utf8').trim().split('\n').map(JSON.parse);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn) {
  for (let n = 0; n < 200; n++) { if (fn()) return; await delay(5); }
  throw Error('Expected event not observed');
}

test('preview has fixed explicit backends, opens no file/network and rejects unsafe inputs', t => {
  const output = temp(t), args = argsFor(output);
  assert.deepEqual(BACKENDS.guardian, { host: '127.0.0.1', port: 9000 });
  assert.deepEqual(BACKENDS.anytracking, { host: 'a.igps123.com', port: 7720 });
  const preview = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 3000, env: {} });
  assert.equal(preview.status, 0, preview.stderr);
  const value = JSON.parse(preview.stdout);
  assert.equal(value.networkOpened, false);
  assert.equal(value.fileCreated, false);
  assert.equal(value.commandsGenerated, false);
  assert.equal(value.guardianTelemetryPausedDuringComparison, false);
  assert.equal(value.restoreCommand, 'ip,return.example.test,23456#');
  assert.equal(fs.existsSync(output), false);
  const supplier = parseArguments(args.map(v => v === 'guardian' ? 'anytracking' : v));
  assert.equal(supplier.backend, 'anytracking');
  for (const extra of [['--minutes', '21'], ['--minutes', '0'], ['--listen-port', '9000'],
    ['--listen-port', '9001'], ['--backend', 'anytracking'], ['--upstream', 'elsewhere'], ['--run', '--run']]) {
    assert.throws(() => parseArguments([...args, ...extra]));
  }
  for (const url of ['tcp://localhost:1', 'tcp://127.0.0.1:9000', 'tcp://return.test:0',
    'https://return.test:1', 'tcp://return.test:5/#RESET', 'tcp://u:p@return.test:1']) {
    assert.throws(() => parseArguments(args.map(v => v.startsWith('tcp:') ? url : v)));
  }
});

test('fragmented/coalesced traffic preserves exact safe frames and redacts private/binary payloads', () => {
  const rows = [], observer = new FrameObserver({ protocolId: ID, direction: 'server_to_watch', emit: r => rows.push(r) });
  const safe = ['CONFIG,1', 'LK', 'SEDENTARY,1,20', 'SEDENTARYWORKTIME,16:00-18:00,-'];
  const all = Buffer.concat([...safe.map(body => frame(body)),
    frame('PHBX,1,Private Name,+23055555555'), frame('MONITOR,+23055555555'),
    frame('CONFIG,IMEI:111111111111111,phone:private'), frame('UD_LTE,-20.123,57.456'),
    frame(Buffer.from([80, 73, 67, 44, 93, 91, 42, 255])), frame('UPLOAD,60')]);
  for (let offset = 0; offset < all.length; offset += 7) observer.push(all.subarray(offset, offset + 7));
  observer.finish();
  assert.deepEqual(rows.slice(0, 4).map(r => r.frame), safe.map(body => frame(body).toString()));
  assert.equal(rows.length, 10);
  for (const row of rows.slice(4)) { assert.equal(row.frame, undefined); assert.equal(row.argumentsRedacted, true); }
  for (const secret of ['Private Name', '+23055555555', '111111111111111', '-20.123', '57.456']) {
    assert.equal(JSON.stringify(rows).includes(secret), false);
  }
  const evil = Buffer.from('SEDENTARY,1,20'); evil[0] += 128;
  assert.equal(frameSummary(frame(evil), ID, 'server_to_watch').frame, undefined);
  assert.equal(frameSummary(frame('SEDENTARY,1,20'), ID, 'watch_to_server').frame, undefined);
  assert.equal(frameSummary(frame('SEDENTARY', '3G', '9999999999'), ID, 'watch_to_server'), null);
});

test('framing loss is explicit and stops observation without interpreting embedded frames', () => {
  const rows = [], observer = new FrameObserver({ protocolId: ID, direction: 'watch_to_server', emit: r => rows.push(r) });
  observer.push(Buffer.from(`[3G*${ID}*0001*bad]`));
  observer.push(frame('SEDENTARY'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].reason, 'invalid_frame_boundary');
  const partial = new FrameObserver({ protocolId: ID, direction: 'watch_to_server', emit: r => rows.push(r) });
  partial.push(frame('SEDENTARY').subarray(0, 24)); partial.finish();
  assert.equal(rows[1].event, 'observation_incomplete');
});

test('writer refuses overwrite and symlink, handles short writes and reports failure', t => {
  const output = temp(t);
  const writer = createLog(output, { write: (fd, data, offset, length) => fs.writeSync(fd, data, offset, Math.min(length, 3)) });
  assert.equal(writer.write({ event: 'safe' }), true);
  assert.equal(writer.close(), true);
  assert.deepEqual(readRows(output), [{ event: 'safe' }]);
  assert.throws(() => createLog(output), /EEXIST/);
  const link = output + '.link'; fs.symlinkSync(output, link);
  assert.throws(() => createLog(link), /EEXIST/);
  const failed = createLog(output + '.failed', { write: () => 0 });
  assert.equal(failed.write({ event: 'not_saved' }), false);
  assert.equal(failed.close(), false);
});

async function fixture(t, overrides = {}) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'movement-session-'));
  const output = path.join(folder, 'capture.jsonl'), received = [], emitted = [], upstreamSockets = [], watchData = [];
  const upstream = net.createServer(socket => {
    upstreamSockets.push(socket); socket.on('error', () => {});
    socket.on('data', data => received.push(data));
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  let connections = 0;
  const relay = await startRelay({ ...parseArguments(argsFor(output)), listenPort: 0 }, {
    emit: row => emitted.push(row),
    connect: () => { connections++; return net.createConnection(upstream.address().port, '127.0.0.1'); },
    ...overrides,
  });
  const watch = net.createConnection(relay.server.address().port, '127.0.0.1');
  watch.on('error', () => {}); watch.on('data', data => watchData.push(data)); await once(watch, 'connect');
  t.after(async () => {
    watch.destroy(); await relay.stop();
    for (const socket of upstreamSockets) socket.destroy();
    await new Promise(resolve => upstream.close(resolve));
    fs.rmSync(folder, { recursive: true, force: true });
  });
  return { output, received, emitted, upstreamSockets, watch, watchData, relay, connections: () => connections };
}

test('loopback relay forwards both directions unchanged and never generates ACKs or settings', { timeout: 5000 }, async t => {
  const f = await fixture(t);
  await delay(15); assert.equal(f.connections(), 0);
  const upload = Buffer.concat([frame('CONFIG,private:123'), frame('LK,10,0,75'),
    frame(Buffer.from([80, 73, 67, 44, 91, 93, 42, 0, 255]))]);
  f.watch.write(upload.subarray(0, 11)); f.watch.write(upload.subarray(11));
  await until(() => Buffer.concat(f.received).length === upload.length);
  assert.deepEqual(Buffer.concat(f.received), upload);
  assert.equal(f.watchData.length, 0, 'recorder must not generate CONFIG or LK ACK');
  const downlink = Buffer.concat([frame('CONFIG,1', 'SG'), frame('SEDENTARY,1,20'), frame('SEDENTARYWORKTIME,16:00-18:00,-')]);
  f.upstreamSockets[0].write(downlink);
  await until(() => Buffer.concat(f.watchData).length === downlink.length);
  assert.deepEqual(Buffer.concat(f.watchData), downlink);
  const reply = frame('SEDENTARY'); f.watch.write(reply);
  await until(() => Buffer.concat(f.received).length === upload.length + reply.length);
  assert.deepEqual(Buffer.concat(f.received), Buffer.concat([upload, reply]));
  await f.relay.stop();
  const rows = readRows(f.output), sent = rows.filter(r => r.direction === 'server_to_watch');
  assert.equal(sent[0].prefix, 'SG'); assert.equal(sent[1].prefix, '3G');
  assert.equal(sent[1].frameHex, frame('SEDENTARY,1,20').toString('hex'));
  assert.equal(rows.some(r => r.frame?.includes('private:123')), false);
  assert.equal(rows.at(-1).routingRestored, false);
  assert.equal(rows.at(-1).captureComplete, true);
});

test('forwarding continues after disk failure and the console marks capture incomplete', { timeout: 5000 }, async t => {
  let writes = 0;
  const f = await fixture(t, { writeLog: (...args) => {
    if (++writes > 2) throw Error('simulated full disk');
    return fs.writeSync(...args);
  } });
  const upload = frame('LK,10,0,75'); f.watch.write(upload);
  await until(() => Buffer.concat(f.received).length === upload.length);
  const command = frame('SEDENTARY,1,20'); f.upstreamSockets[0].write(command);
  await until(() => Buffer.concat(f.watchData).length === command.length);
  assert.deepEqual(Buffer.concat(f.received), upload);
  assert.deepEqual(Buffer.concat(f.watchData), command);
  await f.relay.stop();
  assert.equal(f.emitted.filter(r => r.event === 'capture_write_failed').length, 1);
  assert.equal(f.emitted.at(-1).captureComplete, false);
});

test('framing loss is forwarded unchanged, and concurrent stop calls share completion', { timeout: 5000 }, async t => {
  const f = await fixture(t);
  const upload = Buffer.concat([frame('LK'), Buffer.from('unexpected bytes'), frame('SEDENTARY')]);
  f.watch.write(upload);
  await until(() => Buffer.concat(f.received).length === upload.length);
  assert.deepEqual(Buffer.concat(f.received), upload);
  const first = f.relay.stop(), second = f.relay.stop();
  assert.equal(first, second); await first;
  const rows = readRows(f.output);
  assert.equal(rows.filter(r => r.event === 'frame').length, 1);
  assert.equal(rows.at(-1).captureComplete, false);
  assert.equal(f.emitted.filter(r => r.event === 'relay_stopped').length, 1);
});

test('partial frames and the row limit cannot report a complete capture', { timeout: 5000 }, async t => {
  const partial = await fixture(t);
  const upload = frame('LK').subarray(0, 21); partial.watch.write(upload);
  await until(() => Buffer.concat(partial.received).length === upload.length);
  await partial.relay.stop();
  assert.equal(readRows(partial.output).at(-1).captureComplete, false);
  const limited = await fixture(t);
  const repeated = Buffer.concat(Array.from({ length: 2050 }, () => frame('LK')));
  limited.watch.write(repeated);
  await until(() => Buffer.concat(limited.received).length === repeated.length);
  assert.deepEqual(Buffer.concat(limited.received), repeated);
  await limited.relay.stop();
  const rows = readRows(limited.output);
  assert.equal(rows.filter(r => r.event === 'capture_limit').length, 1);
  assert.equal(rows.at(-1).captureComplete, false);
  assert.ok(rows.length <= 2002);
});

test('wrong watch identity never reaches upstream', { timeout: 5000 }, async t => {
  const f = await fixture(t);
  f.watch.write(frame('LK', '3G', '9999999999'));
  await until(() => f.watch.destroyed);
  assert.equal(f.connections(), 0);
  assert.equal(readRows(f.output).some(r => r.reason === 'identity_not_allowed'), true);
});

test('expiry closes the relay and retains return guidance without claiming restoration', { timeout: 5000 }, async t => {
  const f = await fixture(t, { durationMs: 80 });
  f.watch.write(frame('LK'));
  await until(() => f.emitted.some(r => r.event === 'relay_stopped'));
  const end = f.emitted.find(r => r.event === 'relay_stopped');
  assert.equal(end.reason, 'capture_window_ended');
  assert.equal(end.restoreCommand, 'ip,return.example.test,23456#');
  assert.equal(end.routingRestored, false);
  await until(() => f.watch.destroyed);
  assert.equal(f.watch.destroyed, true);
});
