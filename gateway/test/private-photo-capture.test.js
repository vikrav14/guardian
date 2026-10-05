'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { once } = require('node:events');
const { spawnSync } = require('node:child_process');
const { createPrivatePhotoCapture, MAX_FRAMES, MAX_IMAGES, MAX_RAW_BYTES } = require('../scripts/private-photo-capture');
const { FrameObserver, parseArguments, startRelay } = require('../scripts/capture-reference-answer-mode');

const ID = '1234567890';
function frame(body, id = ID) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
  return Buffer.concat([Buffer.from(`[3G*${id}*${bytes.length.toString(16).padStart(4, '0')}*`), bytes, Buffer.from(']')]);
}
function tempFile(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guardian-photo-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'private.jsonl');
}
function row(direction = 'watch_to_server') {
  return { at: '2026-09-24T17:00:40.197Z', session: 1, direction };
}
async function until(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail('Timed out waiting for local fixture');
}

test('private photo CLI is explicit, mutually exclusive, and preview creates no file or connection', t => {
  const file = tempFile(t);
  const base = ['--protocol-id', ID, '--private-photo-file', file];
  assert.throws(() => parseArguments(base));
  const args = [...base, '--guardian-return-host', 'guardian.example.test', '--guardian-return-port', '10595'];
  assert.equal(parseArguments(args).privatePhotoFile, file);
  assert.throws(() => parseArguments([...args, '--private-answer-file', file]));
  assert.throws(() => parseArguments(args.map(value => value === file ? 'relative.jsonl' : value)));
  const result = spawnSync(process.execPath, [path.join(__dirname, '../scripts/capture-reference-answer-mode.js'), ...args], { encoding: 'utf8', timeout: 3000, env: {} });
  assert.equal(result.status, 0);
  const preview = JSON.parse(result.stdout);
  assert.equal(preview.networkOpened, false);
  assert.equal(preview.commandsGenerated, false);
  assert.equal(preview.privatePhotoCaptureEnabled, true);
  assert.equal(preview.privateFileCreated, false);
  assert.equal(fs.existsSync(file), false);
});

test('binary img frames survive fragmentation and embedded frame delimiters without leaking payloads', t => {
  const file = tempFile(t);
  const capture = createPrivatePhotoCapture(file, ID);
  t.after(() => capture.close());
  const rows = [];
  const observe = direction => new FrameObserver({ protocolId: ID, direction,
    emit: value => rows.push(value), captureFrame: (bytes, value) => capture.record(bytes, { ...row(direction), ...value }) });
  const request = frame('rcapture');
  const syntheticImage = frame(Buffer.concat([Buffer.from('img,1,private-image-name,'), Buffer.from([0xff, 0xd8, 0x5d, 0x5b, 0x2c, 0, 0xff, 0xd9])]));
  observe('server_to_watch').push(request);
  const uplink = observe('watch_to_server');
  const data = Buffer.concat([request, syntheticImage, frame('ICCID,secret-sim')]);
  for (let offset = 0; offset < data.length; offset += 3) uplink.push(data.subarray(offset, offset + 3));
  uplink.finish();
  capture.close();
  const records = fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(records.map(record => record.command), ['rcapture', 'rcapture', 'img']);
  assert.deepEqual(Buffer.from(records[2].frameHex, 'hex'), syntheticImage);
  assert.equal(capture.status().imageFramesSaved, 1);
  assert.equal(JSON.stringify(rows).includes('private-image-name'), false);
  assert.equal(JSON.stringify(rows).includes('secret-sim'), false);
  assert.equal(JSON.stringify(rows).includes(syntheticImage.toString('hex')), false);
  assert.equal(rows.find(value => value.command === 'img').frame, undefined);
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('only exact rcapture and watch img for the selected identity can enter the file', t => {
  const file = tempFile(t);
  const capture = createPrivatePhotoCapture(file, ID);
  for (const body of ['FTPPWD,user,secret', 'FTPIP,private.example,21', 'PHBX,2,name,phone', 'CONFIG,secret', 'ACALL,phone', 'rcapture,secret', 'IMG,binary']) {
    assert.equal(capture.record(frame(body), row()), null);
  }
  assert.equal(capture.record(frame('img,binary', '9999999999'), row()), null);
  assert.equal(capture.record(frame('img,binary'), row('server_to_watch')), null);
  assert.equal(capture.record(frame('img,binary'), row('unknown')), null);
  const malformed = frame('img,binary'); malformed[19] = 0x21;
  assert.equal(capture.record(malformed, row()), null);
  const wrongLength = frame('img,binary'); wrongLength[15] = 0x31;
  assert.equal(capture.record(wrongLength, row()), null);
  capture.close();
  assert.equal(fs.statSync(file).size, 0);
});

test('existing private files and symlinks are not overwritten', t => {
  const file = tempFile(t);
  fs.writeFileSync(file, 'keep');
  assert.throws(() => createPrivatePhotoCapture(file, ID));
  assert.equal(fs.readFileSync(file, 'utf8'), 'keep');
  if (process.platform !== 'win32') {
    fs.symlinkSync(file, file + '.link');
    assert.throws(() => createPrivatePhotoCapture(file + '.link', ID));
  }
});

test('frame, image and raw-byte caps bound private capture and close its descriptor', t => {
  const make = () => {
    const file = tempFile(t);
    const capture = createPrivatePhotoCapture(file, ID);
    t.after(() => capture.close());
    return capture;
  };
  const requests = make();
  for (let i = 0; i < MAX_FRAMES; i++) assert.equal(requests.record(frame('rcapture'), row()).status, 'saved');
  assert.equal(requests.record(frame('rcapture'), row()).status, 'limit_reached');
  const images = make();
  for (let i = 0; i < MAX_IMAGES; i++) assert.equal(images.record(frame('img,small'), row()).status, 'saved');
  assert.equal(images.record(frame('img,small'), row()).status, 'limit_reached');
  const bytes = make();
  const large = frame(Buffer.concat([Buffer.from('img,'), Buffer.alloc(65531)]));
  for (let i = 0; i < 7; i++) assert.equal(bytes.record(large, row()).status, 'saved');
  assert.equal(bytes.record(large, row()).status, 'limit_reached');
  assert.ok(bytes.status().rawBytesSaved <= MAX_RAW_BYTES);
  for (const capture of [requests, images, bytes]) {
    assert.equal(capture.status().fileClosed, true);
    assert.equal(capture.record(frame('rcapture'), row()), null);
  }
});

test('short writes are completed and disk failures remain local with no payload in status', t => {
  const file = tempFile(t);
  const capture = createPrivatePhotoCapture(file, ID, {
    write: (fd, data, offset, length) => fs.writeSync(fd, data, offset, Math.min(length, 7)),
  });
  capture.record(frame('img,private'), row()); capture.close();
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).command, 'img');
  const failed = createPrivatePhotoCapture(tempFile(t), ID, { write: () => { throw new Error('private-payload'); } });
  const result = failed.record(frame('img,private'), row());
  assert.equal(result.status, 'write_failed');
  assert.equal(JSON.stringify(result).includes('private-payload'), false);
  assert.equal(failed.status().fileClosed, true);
});

test('live local relay forwards img bytes, writes private frames and generates no photo ACK', { timeout: 5000 }, async t => {
  const file = tempFile(t), received = [], rows = [], sockets = [];
  const reference = net.createServer(socket => {
    sockets.push(socket);
    socket.on('error', () => {});
    socket.on('data', data => received.push(data));
  });
  reference.listen(0, '127.0.0.1'); await once(reference, 'listening');
  let relay, watch;
  t.after(async () => {
    watch?.destroy();
    await relay?.stop();
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => reference.close(resolve));
  });
  relay = await startRelay({ protocolId: ID, listenPort: 0, minutes: 1, privatePhotoFile: file,
    guardianReturn: { host: 'guardian.example.test', port: 10595 } }, {
    emit: value => rows.push(value), connect: () => net.createConnection(reference.address().port, '127.0.0.1'),
  });
  watch = net.createConnection(relay.server.address().port, '127.0.0.1');
  watch.on('error', () => {});
  const returned = [];
  watch.on('data', data => returned.push(data));
  await once(watch, 'connect');
  const heartbeat = frame('LK,0,0,90'); watch.write(heartbeat);
  await until(() => Buffer.concat(received).length === heartbeat.length);
  const request = frame('rcapture'); sockets[0].write(request);
  await until(() => Buffer.concat(returned).length === request.length);
  const upload = frame(Buffer.concat([Buffer.from('img,private-content,'), Buffer.from([0xff, 0xd8, 0x5d, 0x5b, 0xff, 0xd9])]));
  // Exceed the image cap; every original frame must still reach the supplier.
  const uplink = Buffer.concat([request, ...Array(MAX_IMAGES + 1).fill(upload)]);
  watch.write(uplink);
  await until(() => Buffer.concat(received).length === heartbeat.length + uplink.length);
  assert.deepEqual(Buffer.concat(received), Buffer.concat([heartbeat, uplink]));
  assert.deepEqual(Buffer.concat(returned), request, 'no generated image ACK');
  assert.equal(JSON.stringify(rows).includes('private-content'), false);
  assert.equal(JSON.stringify(rows).includes(upload.toString('hex')), false);
  assert.equal(rows.filter(value => value.event === 'private_photo_capture' && value.status === 'limit_reached').length, 1);
  const records = fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(records.filter(record => record.command === 'img').length, MAX_IMAGES);
  assert.equal(records.some(record => record.command === 'LK'), false);
  await relay.stop();
  const stopped = rows.find(value => value.event === 'relay_stopped');
  assert.equal(stopped.privatePhotoCapture.fileClosed, true);
  assert.equal(stopped.routingRestored, false);
});
