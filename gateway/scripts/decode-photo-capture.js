'use strict';

// Offline extraction only. No connection, command, ACK or cloud upload.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { decodeV52PhotoFrame } = require('../src/protocol/v52-photo');
const MAX_CAPTURE_BYTES = 2 * 1024 * 1024;

function parseArguments(args) {
  const values = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!['--capture-file', '--protocol-id', '--output-dir'].includes(key) || key in values) throw new Error('invalid_arguments');
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error('invalid_arguments');
    values[key] = value;
  }
  if (!/^\d{10}$/.test(values['--protocol-id'] || '') || !path.isAbsolute(values['--capture-file'] || '') ||
      (values['--output-dir'] && !path.isAbsolute(values['--output-dir']))) throw new Error('invalid_arguments');
  return { captureFile: values['--capture-file'], protocolId: values['--protocol-id'], outputDir: values['--output-dir'] };
}

function decodeCapture(options) {
  const fd = fs.openSync(options.captureFile, 'r');
  let content;
  try {
    const size = fs.fstatSync(fd).size;
    if (size > MAX_CAPTURE_BYTES) throw new Error('capture_size_limit');
    const buffer = Buffer.alloc(MAX_CAPTURE_BYTES + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const count = fs.readSync(fd, buffer, offset, buffer.length - offset, null);
      if (!count) break;
      offset += count;
    }
    if (offset > MAX_CAPTURE_BYTES) throw new Error('capture_size_limit');
    content = buffer.subarray(0, offset).toString('utf8').replace(/^\uFEFF/, '');
  } finally { fs.closeSync(fd); }
  const lines = content.split(/\r?\n/).filter(line => line.trim());
  if (lines.length > 16) throw new Error('capture_record_limit');
  const images = [];
  for (const line of lines) {
    const row = JSON.parse(line);
    if (row?.event !== 'private_photo_frame' || row.command !== 'img') continue;
    if (row.direction !== 'watch_to_server' || row.protocolId !== options.protocolId) throw new Error('capture_identity_or_direction_mismatch');
    if (typeof row.frameHex !== 'string' || row.frameHex.length > 131112 || !/^(?:[0-9a-fA-F]{2})+$/.test(row.frameHex)) throw new Error('invalid_capture_hex');
    const decoded = decodeV52PhotoFrame(Buffer.from(row.frameHex, 'hex'), options.protocolId);
    images.push({ ...decoded, metadata: { ...decoded.metadata, sha256: crypto.createHash('sha256').update(decoded.jpeg).digest('hex') } });
  }
  if (images.length > 8) throw new Error('image_count_limit');
  if (options.outputDir && images.length) {
    // New directory only: never overwrite another test's photos or follow a
    // user-supplied image filename from a watch packet.
    fs.mkdirSync(options.outputDir, { mode: 0o700 });
    images.forEach((image, index) => {
      const name = `photo-${String(index + 1).padStart(2, '0')}.jpg`;
      fs.writeFileSync(path.join(options.outputDir, name), image.jpeg, { flag: 'wx', mode: 0o600 });
      image.metadata.outputFile = path.join(options.outputDir, name);
    });
  }
  return { outcome: images.length ? 'image_extracted' : 'no_img_records', networkOpened: false,
    commandsGenerated: false, imageCount: images.length, images: images.map(image => image.metadata) };
}

if (require.main === module) {
  try { console.log(JSON.stringify(decodeCapture(parseArguments(process.argv.slice(2))), null, 2)); }
  catch {
    console.error('Photo decode failed. Check file, identity, supported framing and new output directory. No image bytes are logged.');
    process.exitCode = 1;
  }
}
module.exports = { decodeCapture, parseArguments };
