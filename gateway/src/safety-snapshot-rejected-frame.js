'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { MAX_FRAME_BYTES } = require('./protocol/v52-photo');

// Explicit operator diagnostic: one bounded frame, one new private local file.
// The controller rechecks current access/window before calling this writer.
// No automatic replay, upload, public URL, directory scan or overwrite.
function createRejectedPhotoCapture(filePath) {
  if (!filePath) return null;
  if (!path.isAbsolute(filePath)) throw new Error('absolute_diagnostic_path_required');
  let used = false;
  return async ({ frame, requestId, protocolId, at }) => {
    if (used) return 'already_used';
    if (!Buffer.isBuffer(frame) || frame.length > MAX_FRAME_BYTES) return 'frame_too_large';
    used = true;
    try {
      const row = { event: 'private_photo_frame', at, requestId, protocolId,
        direction: 'watch_to_server', command: 'img', frameHex: frame.toString('hex') };
      await fs.writeFile(filePath, `${JSON.stringify(row)}\n`, { flag: 'wx', mode: 0o600 });
      return 'saved';
    } catch {
      return 'write_failed';
    }
  };
}

module.exports = { createRejectedPhotoCapture };
