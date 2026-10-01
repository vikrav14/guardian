'use strict';

const jpeg = require('jpeg-js');
const { deflateSync } = require('node:zlib');

// Diagnostic only: rearrange decoded RGB pixels, then encode a lossless PNG.
// No resizing, brightness adjustment, interpolation, metadata or file writes.
function chunk(type, data) {
  const payload = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  let crc = 0xffffffff;
  for (const byte of payload) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length, 0);
  payload.copy(result, 4);
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
  return result;
}

function rotatedPhotoPng(bytes, clockwiseDegrees) {
  if (![0, 90, 180, 270].includes(clockwiseDegrees) ||
      !Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 65536) throw Error('invalid_rotation_input');
  const pixels = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: false,
    tolerantDecoding: false, maxResolutionInMP: 1.1, maxMemoryUsageInMB: 32 });
  const { width, height, data } = pixels;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      width * height > 1_100_000 || data.length !== width * height * 3) throw Error('invalid_rotation_input');
  const outWidth = clockwiseDegrees % 180 ? height : width;
  const outHeight = clockwiseDegrees % 180 ? width : height;
  const stride = outWidth * 3 + 1;
  const rows = Buffer.alloc(stride * outHeight); // PNG filter 0 at each row start.
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let dx = x; let dy = y;
    if (clockwiseDegrees === 90) { dx = height - 1 - y; dy = x; }
    if (clockwiseDegrees === 180) { dx = width - 1 - x; dy = height - 1 - y; }
    if (clockwiseDegrees === 270) { dx = y; dy = width - 1 - x; }
    const from = (y * width + x) * 3;
    const to = dy * stride + 1 + dx * 3;
    rows.set(data.subarray(from, from + 3), to);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(outWidth, 0); header.writeUInt32BE(outHeight, 4);
  header[8] = 8; header[9] = 2; // 8-bit RGB, no interlacing.
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

module.exports = { rotatedPhotoPng };
