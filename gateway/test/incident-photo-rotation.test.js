'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const jpeg = require('jpeg-js');
const { inflateSync } = require('node:zlib');
const { rotatedPhotoPng } = require('../src/incident-photo-rotation');

test('PNG probe preserves every decoded pixel and clockwise direction on a non-square image', () => {
  const source = jpeg.encode({ width: 3, height: 2, data: Buffer.from([
    250, 10, 10, 255, 10, 250, 10, 255, 10, 10, 250, 255,
    250, 250, 10, 255, 10, 250, 250, 255, 250, 10, 250, 255,
  ]) }, 95).data;
  const unchanged = Buffer.from(source);
  const decoded = jpeg.decode(source, { formatAsRGBA: false });
  // Literal expected source indices in output row order; catches reversed turns.
  for (const [angle, width, height, order] of [
    [0, 3, 2, [0, 1, 2, 3, 4, 5]],
    [90, 2, 3, [3, 0, 4, 1, 5, 2]],
    [180, 3, 2, [5, 4, 3, 2, 1, 0]],
    [270, 2, 3, [2, 5, 1, 4, 0, 3]],
  ]) {
    const png = rotatedPhotoPng(source, angle);
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    const chunks = [];
    for (let offset = 8; offset < png.length;) {
      const length = png.readUInt32BE(offset);
      chunks.push({ type: png.subarray(offset + 4, offset + 8).toString(), data: png.subarray(offset + 8, offset + 8 + length) });
      offset += length + 12;
    }
    assert.deepEqual(chunks.map(row => row.type), ['IHDR', 'IDAT', 'IEND']);
    assert.equal(chunks[0].data.readUInt32BE(0), width);
    assert.equal(chunks[0].data.readUInt32BE(4), height);
    assert.deepEqual([...chunks[0].data.subarray(8)], [8, 2, 0, 0, 0]);
    assert.equal(png.subarray(-4).toString('hex'), 'ae426082', 'standard IEND CRC');
    const rows = inflateSync(chunks[1].data);
    assert.equal(rows.length, height * (width * 3 + 1));
    for (let row = 0; row < height; row++) {
      assert.equal(rows[row * (width * 3 + 1)], 0);
      const expected = Buffer.concat(order.slice(row * width, (row + 1) * width)
        .map(i => decoded.data.subarray(i * 3, i * 3 + 3)));
      assert.deepEqual(rows.subarray(row * (width * 3 + 1) + 1, (row + 1) * (width * 3 + 1)), expected);
    }
    assert.deepEqual(source, unchanged);
  }
});

test('rotation rejects malformed, oversized and excessive-resolution images', () => {
  const source = require('./fixtures/photo-synthetic');
  for (const angle of [-90, 45, 360, '270', null, NaN]) assert.throws(() => rotatedPhotoPng(source, angle));
  for (const bytes of [Buffer.alloc(0), Buffer.alloc(65537), Buffer.from('not a JPEG')]) {
    assert.throws(() => rotatedPhotoPng(bytes, 270));
  }
  const oversized = Buffer.from(source);
  const sof = oversized.indexOf(Buffer.from([0xff, 0xc0]));
  assert(sof > 0);
  oversized.writeUInt16BE(4096, sof + 5);
  oversized.writeUInt16BE(4096, sof + 7);
  assert.throws(() => rotatedPhotoPng(oversized, 270));
});
