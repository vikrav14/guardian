'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const jpeg = require('./fixtures/photo-synthetic');
const { decodeV52PhotoFrame, unescapeMedia, MAX_FRAME_BYTES } = require('../src/protocol/v52-photo');
const { decodeCapture, parseArguments } = require('../scripts/decode-photo-capture');
const ID = '1234567890';
const codes = new Map([[0x7d, 1], [0x5b, 2], [0x5d, 3], [0x2c, 4], [0x2a, 5]]);
function escape(bytes) {
  return Buffer.from([...bytes].flatMap(byte => codes.has(byte) ? [0x7d, codes.get(byte)] : [byte]));
}
function frame(content = jpeg, { trailer = Buffer.from([0, 0]), id = ID, field = '5', timestamp = '260924213927', prefix = '3G' } = {}) {
  const body = Buffer.concat([Buffer.from(`img,${field},${timestamp},`), escape(Buffer.concat([content, trailer]))]);
  return Buffer.concat([Buffer.from(`[${prefix}*${id}*${body.length.toString(16).padStart(4, '0')}*`), body, Buffer.from(']')]);
}
function temp(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'guardian-photo-decode-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
function record(bytes = frame()) {
  return { event: 'private_photo_frame', command: 'img', direction: 'watch_to_server', protocolId: ID, frameHex: bytes.toString('hex') };
}

test('escaped binary image decodes byte-exactly, ignoring an EOI marker inside APP metadata', () => {
  const result = decodeV52PhotoFrame(frame(), ID);
  assert.deepEqual(result.jpeg, jpeg);
  assert.equal(result.metadata.width, 32);
  assert.equal(result.metadata.height, 24);
  assert.equal(result.metadata.components, 3);
  assert.equal(result.metadata.imageFieldRaw, '5');
  assert.equal(result.metadata.deviceTimestampRaw, '260924213927');
  assert.equal(result.metadata.trailingBytesHex, '0000');
  assert.ok(result.metadata.escapeCount >= 5);
  assert.equal(result.metadata.validation, 'jpeg_structure_only');
  assert.equal(result.metadata.requestCorrelationVerified, false);
  assert.equal(result.metadata.appliedStateVerified, false);
  assert.equal(result.metadata.jpegBytes, jpeg.length);
});

test('all five documented media escapes decode and invalid/trailing escapes are rejected', () => {
  const reserved = Buffer.from([0x7d, 0x5b, 0x5d, 0x2c, 0x2a]);
  assert.deepEqual(unescapeMedia(escape(reserved)), { bytes: reserved, escapeCount: 5 });
  for (const bytes of [[0x7d], [0x7d, 0], [0x7d, 6], [0x5d]]) assert.throws(() => unescapeMedia(Buffer.from(bytes)));
});

test('observed one-, two- and six-NUL trailers preserve the exact JPEG and raw trailer', () => {
  for (const count of [1, 2, 6]) {
    const result = decodeV52PhotoFrame(frame(jpeg, { trailer: Buffer.alloc(count) }), ID);
    assert.deepEqual(result.jpeg, jpeg);
    assert.equal(result.metadata.jpegBytes, jpeg.length);
    assert.equal(result.metadata.trailingBytesHex, '00'.repeat(count));
    assert.equal(result.metadata.validation, 'jpeg_structure_only');
    // No non-zero byte is permitted at any position of a supported trailer.
    for (let position = 0; position < count; position++) {
      const trailer = Buffer.alloc(count); trailer[position] = 1;
      assert.throws(() => decodeV52PhotoFrame(frame(jpeg, { trailer }), ID), /unsupported_image_trailer/);
    }
  }
  for (const count of [0, 3, 4, 5, 7, 8, 64]) {
    assert.throws(() => decodeV52PhotoFrame(frame(jpeg, { trailer: Buffer.alloc(count) }), ID), /unsupported_image_trailer/);
  }
});

test('frame identity, length, prefix, command envelope and bounded metadata are enforced', () => {
  assert.throws(() => decodeV52PhotoFrame(frame(), undefined), /expected_protocol/);
  assert.throws(() => decodeV52PhotoFrame(frame(), '9999999999'), /identity/);
  assert.throws(() => decodeV52PhotoFrame(frame(jpeg, { prefix: 'SG' }), ID), /unsupported/);
  assert.throws(() => decodeV52PhotoFrame(Buffer.alloc(MAX_FRAME_BYTES + 1), ID), /frame_size/);
  const invalidLength = frame(); invalidLength[15] = 0x66;
  assert.throws(() => decodeV52PhotoFrame(invalidLength, ID), /length/);
  const invalidEnd = frame(); invalidEnd[invalidEnd.length - 1] = 0;
  assert.throws(() => decodeV52PhotoFrame(invalidEnd, ID), /unsupported/);
  for (const field of ['../../photo', '1x', '1234', '']) assert.throws(() => decodeV52PhotoFrame(frame(jpeg, { field }), ID), /img_header/);
  for (const timestamp of ['../../photo', '26092421392', 'abcdefghijkl']) assert.throws(() => decodeV52PhotoFrame(frame(jpeg, { timestamp }), ID), /img_header/);
  // The value is retained as opaque metadata, not treated as frame count/type.
  assert.equal(decodeV52PhotoFrame(frame(jpeg, { field: '7' }), ID).metadata.imageFieldRaw, '7');
});

test('truncated segments, missing EOI, unsupported frames and unexpected trailers fail closed', () => {
  assert.throws(() => decodeV52PhotoFrame(frame(jpeg.subarray(0, -2)), ID), /jpeg_/);
  const invalidSegment = Buffer.from(jpeg); invalidSegment[4] = 0xff; invalidSegment[5] = 0xff;
  assert.throws(() => decodeV52PhotoFrame(frame(invalidSegment), ID), /segment_truncated/);
  const sof = jpeg.indexOf(Buffer.from([0xff, 0xc0]));
  const progressive = Buffer.from(jpeg); progressive[sof + 1] = 0xc2;
  assert.throws(() => decodeV52PhotoFrame(frame(progressive), ID), /unsupported_jpeg_frame/);
  const oversized = Buffer.from(jpeg); oversized.writeUInt16BE(5000, sof + 7);
  assert.throws(() => decodeV52PhotoFrame(frame(oversized), ID), /dimensions/);
  for (const trailer of [Buffer.alloc(0), Buffer.alloc(3), Buffer.from([0, 1]), jpeg]) {
    assert.throws(() => decodeV52PhotoFrame(frame(jpeg, { trailer }), ID), /trailer/);
  }
});

test('offline inspection has no writes by default and outputs no image bytes', t => {
  const directory = temp(t), captureFile = path.join(directory, 'capture.jsonl');
  fs.writeFileSync(captureFile, JSON.stringify(record()) + '\n');
  const result = decodeCapture({ captureFile, protocolId: ID });
  assert.equal(result.imageCount, 1);
  assert.equal(result.networkOpened, false);
  assert.equal(result.commandsGenerated, false);
  assert.equal(result.images[0].sha256, crypto.createHash('sha256').update(jpeg).digest('hex'));
  assert.deepEqual(fs.readdirSync(directory), ['capture.jsonl']);
  assert.equal(JSON.stringify(result).includes(jpeg.toString('hex')), false);
  assert.equal(JSON.stringify(result).includes('frameHex'), false);
});

test('offline extraction writes exact private bytes to a new directory and refuses overwrite', t => {
  const directory = temp(t), captureFile = path.join(directory, 'capture.jsonl'), outputDir = path.join(directory, 'photos');
  fs.writeFileSync(captureFile, '\uFEFF' + JSON.stringify(record()) + '\r\n');
  const result = decodeCapture({ captureFile, protocolId: ID, outputDir });
  assert.deepEqual(fs.readFileSync(result.images[0].outputFile), jpeg);
  assert.equal(path.basename(result.images[0].outputFile), 'photo-01.jpg');
  if (process.platform !== 'win32') assert.equal(fs.statSync(result.images[0].outputFile).mode & 0o777, 0o600);
  assert.throws(() => decodeCapture({ captureFile, protocolId: ID, outputDir }));
});

test('offline capture extracts both remote trailer variants using synthetic image bytes', t => {
  const directory = temp(t), captureFile = path.join(directory, 'remote.jsonl'), outputDir = path.join(directory, 'photos');
  const variants = [
    { trailer: Buffer.alloc(6), timestamp: '260925002653' },
    { trailer: Buffer.alloc(1), timestamp: '260925003013' },
  ];
  fs.writeFileSync(captureFile, variants.map(options => JSON.stringify(record(frame(jpeg, options)))).join('\n'));
  const result = decodeCapture({ captureFile, protocolId: ID, outputDir });
  assert.equal(result.imageCount, 2);
  assert.equal(result.networkOpened, false);
  assert.equal(result.commandsGenerated, false);
  assert.deepEqual(result.images.map(image => image.trailingBytesHex), ['000000000000', '00']);
  assert.deepEqual(result.images.map(image => image.deviceTimestampRaw), variants.map(options => options.timestamp));
  for (const image of result.images) {
    assert.deepEqual(fs.readFileSync(image.outputFile), jpeg);
    assert.equal(image.sha256, crypto.createHash('sha256').update(jpeg).digest('hex'));
  }
  assert.equal(JSON.stringify(result).includes('frameHex'), false);
});

test('capture size/count, JSON, hex, direction and row/frame identities are validated before output', t => {
  const directory = temp(t), captureFile = path.join(directory, 'capture.jsonl'), outputDir = path.join(directory, 'photos');
  for (const value of [
    { ...record(), protocolId: '9999999999' },
    { ...record(), direction: 'server_to_watch' },
    { ...record(), frameHex: 'ffxz' },
    { ...record(), frameHex: 'f' },
    record(frame(jpeg, { id: '9999999999' })),
  ]) {
    fs.writeFileSync(captureFile, JSON.stringify(value));
    assert.throws(() => decodeCapture({ captureFile, protocolId: ID, outputDir }));
    assert.equal(fs.existsSync(outputDir), false);
  }
  for (const content of ['{bad', (JSON.stringify(record()) + '\n').repeat(17), ' '.repeat(2 * 1024 * 1024 + 1)]) {
    fs.writeFileSync(captureFile, content);
    assert.throws(() => decodeCapture({ captureFile, protocolId: ID, outputDir }));
  }
  fs.writeFileSync(captureFile, JSON.stringify({ event: 'private_photo_frame', command: 'rcapture' }));
  assert.equal(decodeCapture({ captureFile, protocolId: ID, outputDir }).outcome, 'no_img_records');
  assert.equal(fs.existsSync(outputDir), false);
});

test('CLI requires explicit input identity and absolute paths; does not accept a send option', t => {
  const captureFile = path.join(temp(t), 'capture.jsonl');
  const args = ['--capture-file', captureFile, '--protocol-id', ID];
  assert.equal(parseArguments(args).protocolId, ID);
  assert.throws(() => parseArguments([...args, '--send']));
  assert.throws(() => parseArguments(['--capture-file', 'relative.jsonl', '--protocol-id', ID]));
  assert.throws(() => parseArguments([...args, '--output-dir', 'relative']));
  assert.throws(() => parseArguments([...args, '--protocol-id', ID]));
});
