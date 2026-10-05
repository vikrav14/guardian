'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { once } = require('node:events');
const { spawnSync } = require('node:child_process');
const { createPrivateCapture, parseArguments, startMedicationCapture, MAX_PRIVATE_FRAMES, MAX_PRIVATE_BYTES } = require('../scripts/capture-medication-session');
const ID = '1234567890';
function frame(body, id = ID) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
  return Buffer.concat([Buffer.from(`[3G*${id}*${bytes.length.toString(16).padStart(4, '0')}*`), bytes, Buffer.from(']')]);
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardian-medication-capture-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const output = path.join(root, 'metadata.jsonl'), privateOutput = path.join(root, 'private.jsonl');
  const args = ['--backend', 'anytracking', '--protocol-id', ID, '--return-url', 'tcp://return.example.test:12345',
    '--output', output, '--private-output', privateOutput, '--minutes', '20'];
  return { root, output, privateOutput, args };
}
const rows = p => fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn) { for (let i = 0; i < 200; i++) { if (fn()) return; await delay(5); } throw Error('Expected traffic missing'); }

test('preview opens no listener/files; paths are distinct and duration remains bounded', t => {
  const f = fixture(t);
  const preview = spawnSync(process.execPath, [path.join(__dirname, '../scripts/capture-medication-session.js'), ...f.args], { encoding: 'utf8', timeout: 3000 });
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(JSON.parse(preview.stdout).networkOpened, false);
  assert.deepEqual(fs.readdirSync(f.root), []);
  assert.throws(() => parseArguments(f.args.map(x => x === f.privateOutput ? f.output : x)));
  assert.throws(() => parseArguments([...f.args, '--private-output', f.privateOutput]));
  assert.throws(() => parseArguments(f.args.map(x => x === '20' ? '21' : x)));
});

test('private capture keeps exact selected audio bytes but excludes other identities and media', t => {
  const f = fixture(t), capture = createPrivateCapture(f.privateOutput, ID);
  const raw = frame(Buffer.concat([Buffer.from('TAKEPILLS,08:00-1-2,1,0078,'), Buffer.from([0, 255, 125, 1, 125, 4, 93])]));
  assert.equal(capture.record(raw, 'server_to_watch').saved, true);
  assert.equal(capture.record(frame('TK,1'), 'watch_to_server').saved, true);
  for (const value of [frame('img,private'), frame('PHBX,private'), frame('UD_LTE,private'), frame('TAKEPILLS,1', '9999999999'), Buffer.from('[bad]')]) assert.equal(capture.record(value, 'watch_to_server'), null);
  capture.close();
  assert.equal(rows(f.privateOutput).length, 2);
  assert.deepEqual(Buffer.from(rows(f.privateOutput)[0].frameBase64, 'base64'), raw);
  assert.throws(() => createPrivateCapture(f.privateOutput, ID), /EEXIST/);
});

test('private capture stops at the count and byte limits', t => {
  const f = fixture(t), small = createPrivateCapture(f.privateOutput, ID);
  for (let i = 0; i < MAX_PRIVATE_FRAMES; i++) assert.equal(small.record(frame('TAKEPILLS,1'), 'watch_to_server').saved, true);
  assert.equal(small.record(frame('TAKEPILLS,1'), 'watch_to_server').limited, true);
  const large = createPrivateCapture(path.join(f.root, 'large.jsonl'), ID);
  const body = Buffer.alloc(65535, 1); Buffer.from('TK,').copy(body);
  const packet = frame(body);
  while (large.status().rawBytes + packet.length <= MAX_PRIVATE_BYTES) assert.equal(large.record(packet, 'server_to_watch').saved, true);
  assert.equal(large.record(packet, 'server_to_watch').limited, true);
  assert.ok(large.status().rawBytes <= MAX_PRIVATE_BYTES);
});

test('profile comparison preserves exact mixed-case scene commands and replies privately', t => {
  const f = fixture(t), capture = createPrivateCapture(f.privateOutput, ID);
  const commands = [frame('profile,3'), frame('PROFILE,1'), frame('profile')];
  for (const command of commands) assert.equal(capture.record(command, 'server_to_watch').saved, true);
  assert.equal(capture.record(frame('profile,3', '9999999999'), 'server_to_watch'), null);
  assert.equal(capture.record(frame('PROFILEX,3'), 'server_to_watch'), null);
  capture.close();
  assert.deepEqual(rows(f.privateOutput).map(r => Buffer.from(r.frameBase64, 'base64')), commands);
});

test('disk failure is explicit and never returns a successful private recording', t => {
  const f = fixture(t), capture = createPrivateCapture(f.privateOutput, ID, { write: () => 0 });
  const result = capture.record(frame('TAKEPILLS,1'), 'watch_to_server');
  assert.equal(result.saved, false); assert.equal(result.failed, true); assert.equal(result.closed, true);
});

test('real loopback preserves split binary commands and replies; metadata is redacted and stop is bounded', { timeout: 5000 }, async t => {
  const f = fixture(t), received = [], returned = [], emitted = [];
  let upstreamSocket;
  const upstream = net.createServer(socket => { upstreamSocket = socket; socket.on('error', () => {}); socket.on('data', b => received.push(b)); });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const stopFile = path.join(f.root, 'stop');
  const capture = await startMedicationCapture({ ...parseArguments(f.args), listenPort: 0, stopFile }, {
    connect: () => net.createConnection(upstream.address().port, '127.0.0.1'), emit: r => emitted.push(r),
  });
  const watch = net.createConnection(capture.server.address().port, '127.0.0.1');
  watch.on('error', () => {}); watch.on('data', b => returned.push(b)); await once(watch, 'connect');
  t.after(async () => { watch.destroy(); await capture.stop(); upstreamSocket?.destroy(); await new Promise(resolve => upstream.close(resolve)); });
  const heartbeat = frame('LK,private'); watch.write(heartbeat); await until(() => Buffer.concat(received).length === heartbeat.length);
  assert.equal(returned.length, 0, 'recorder must not generate an ACK');
  const command = frame(Buffer.concat([Buffer.from('TAKEPILLS,08:00-1-2,1,0078,'), Buffer.from([0, 255, 125, 1, 125, 4, 93])]));
  upstreamSocket.write(command.subarray(0, 25)); upstreamSocket.write(command.subarray(25));
  await until(() => Buffer.concat(returned).length === command.length);
  assert.deepEqual(Buffer.concat(returned), command);
  const reply = frame('TAKEPILLS,1'); watch.write(reply); await until(() => Buffer.concat(received).length === heartbeat.length + reply.length);
  fs.writeFileSync(stopFile, ''); await until(() => emitted.some(r => r.event === 'relay_stopped'));
  assert.deepEqual(rows(f.privateOutput).map(r => Buffer.from(r.frameBase64, 'base64')), [command, reply]);
  const metadata = rows(f.output).filter(r => r.event === 'frame');
  assert.ok(metadata.every(r => !r.frame && !r.frameHex && !r.frameBase64));
  assert.ok(metadata.find(r => r.command === 'TAKEPILLS').privateRecord.saved);
  assert.equal(emitted.at(-1).privateCapture.closed, true);
  assert.equal(emitted.at(-1).routingRestored, false);
});
