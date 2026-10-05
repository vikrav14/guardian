'use strict';

// Opt-in, local diagnostic only. Never imported by the running gateway.
const fs = require('node:fs');
const path = require('node:path');

const MAX_FRAMES = 16;
const MAX_IMAGES = 8;
const MAX_RAW_BYTES = 512 * 1024;

function createPrivatePhotoCapture(filePath, protocolId, { write = fs.writeSync } = {}) {
  if (!path.isAbsolute(filePath) || !/^\d{10}$/.test(protocolId || '')) {
    throw new Error('Use an absolute new private photo file and exact protocol ID.');
  }
  const fd = fs.openSync(filePath, 'wx', 0o600);
  let recordsSaved = 0, imageFramesSaved = 0, rawBytesSaved = 0;
  let limited = false, failed = false, fileClosed = false;
  const status = () => ({ recordsSaved, imageFramesSaved, rawBytesSaved, limited, failed, fileClosed });
  const close = () => {
    if (!fileClosed) {
      try { fs.closeSync(fd); } catch { failed = true; }
      fileClosed = true;
    }
    return status();
  };
  const record = (frame, row) => {
    if (fileClosed || limited || failed || !Buffer.isBuffer(frame) || frame.length < 21 || frame.length > 65556) return null;
    if (!['server_to_watch', 'watch_to_server'].includes(row.direction)) return null;
    const header = /^\[([A-Z0-9]{2})\*(\d{10})\*([0-9a-fA-F]{4})\*$/.exec(frame.subarray(0, 20).toString('latin1'));
    if (!header || header[2] !== protocolId || parseInt(header[3], 16) !== frame.length - 21 || frame.at(-1) !== 0x5d) return null;
    const body = frame.subarray(20, -1);
    const isImage = row.direction === 'watch_to_server' && body.subarray(0, 4).equals(Buffer.from('img,'));
    const isRequestOrReply = body.equals(Buffer.from('rcapture'));
    if (!isImage && !isRequestOrReply) return null;
    if (recordsSaved >= MAX_FRAMES || (isImage && imageFramesSaved >= MAX_IMAGES) || rawBytesSaved + frame.length > MAX_RAW_BYTES) {
      limited = true;
      close();
      return { status: 'limit_reached', ...status() };
    }
    const data = Buffer.from(JSON.stringify({ event: 'private_photo_frame', at: row.at,
      session: row.session, protocolId, direction: row.direction, command: isImage ? 'img' : 'rcapture',
      prefix: header[1], lengthField: header[3], payloadBytes: body.length,
      frameHex: frame.toString('hex'), appliedStateVerified: false }) + '\n');
    try {
      for (let offset = 0; offset < data.length;) {
        const written = write(fd, data, offset, data.length - offset);
        if (!Number.isInteger(written) || written <= 0 || written > data.length - offset) throw new Error('Capture write failed.');
        offset += written;
      }
      recordsSaved++;
      if (isImage) imageFramesSaved++;
      rawBytesSaved += frame.length;
      return { status: 'saved', recordNumber: recordsSaved, imageFramesSaved, rawBytesSaved };
    } catch {
      failed = true;
      close();
      return { status: 'write_failed', recordsSaved };
    }
  };
  return { record, close, status };
}

module.exports = { createPrivatePhotoCapture, MAX_FRAMES, MAX_IMAGES, MAX_RAW_BYTES };
