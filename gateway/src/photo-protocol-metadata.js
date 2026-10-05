'use strict';

// Bounded protocol metadata only. Never retain an identity, radio, command
// argument or image byte. This classifier does not decode or accept a frame.
function frameMetadata(frame) {
  if (!Buffer.isBuffer(frame)) return null;
  const text = frame.subarray(0, 96).toString('latin1');
  const header = /^\[([a-z0-9]{2})\*(\d{10,15})\*([a-f0-9]{4})\*([a-z0-9_]+)(?=[,\]])/i.exec(text);
  if (!header) return { kind: 'unclassified', bytes: frame.length };
  const name = header[4];
  const prefix = ['3G', 'SG', 'CS'].includes(header[1]) ? header[1] : 'other';
  const headerBytes = header[0].length - name.length;
  const bareCaptureReply = name === 'rcapture' && frame.subarray(headerBytes).equals(Buffer.from('rcapture]'));
  const kind = bareCaptureReply ? 'capture_reply'
    : ['LK', 'TKQ', 'TKQ2'].includes(name) ? 'heartbeat'
    : /^UD(?:2|_LTE|_WCDMA)?$/.test(name) ? 'location'
    : /^AL(?:_LTE|_WCDMA)?$/.test(name) ? 'alarm'
    : name === 'img' ? 'photo' : 'other';
  const result = { kind, bytes: frame.length, prefix,
    lengthMatches: frame.at(-1) === 0x5d && parseInt(header[3], 16) === frame.length - headerBytes - 1 };
  if (kind === 'photo') {
    const stamp = /^img,\d{1,3},(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2}),/.exec(text.slice(headerBytes));
    if (stamp) {
      const [y, m, d, h, minute, second] = stamp.slice(1).map(Number);
      const date = new Date(Date.UTC(2000 + y, m - 1, d, h, minute, second));
      if (date.getUTCFullYear() === 2000+y && date.getUTCMonth() === m-1 && date.getUTCDate() === d &&
          date.getUTCHours() === h && date.getUTCMinutes() === minute && date.getUTCSeconds() === second) {
        // A device wall-clock label: no UTC suffix, timezone or verified
        // capture-time claim. Useful for comparing delayed execution/upload.
        result.deviceWallTimeUnverified = date.toISOString().slice(0, 19);
      }
    }
  }
  return result;
}
module.exports = { frameMetadata };
