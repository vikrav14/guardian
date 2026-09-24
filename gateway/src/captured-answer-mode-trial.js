'use strict';

const { createHash } = require('node:crypto');
const { findSocketsForDevice } = require('./sessions');

const MAX_CAPTURE_BYTES = 16 * 1024;
const MAX_SESSION_AGE_MS = 120_000;
const RECORD_KEYS = new Set(['event', 'at', 'session', 'direction', 'command',
  'prefix', 'lengthField', 'frameHex', 'appliedStateVerified']);

function invalidCapture() {
  // Never include private input, JSON parser errors or frame bytes in errors.
  throw new Error('invalid_reference_capture');
}

function parseCaptureFile(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_CAPTURE_BYTES) invalidCapture();
  try {
    return text.replace(/^\uFEFF/, '').trim().split(/\r?\n/).map(line => JSON.parse(line));
  } catch { invalidCapture(); }
}

/**
 * Restricted replay of the six-record Auto -> Manual reference capture from
 * 23 September 2026. This is not a generic raw-frame sender or a customer API.
 * Require both transitions and their replies; never guess an Auto argument.
 */
function prepareCapturedAnswerTrial(input) {
  if (!input || Object.keys(input).some(key => !['imei', 'mode', 'capture'].includes(key)) ||
      typeof input.imei !== 'string' || input.imei.length !== 15 || !/^\d{15}$/.test(input.imei) || !['auto', 'manual'].includes(input.mode) ||
      !Array.isArray(input.capture) || input.capture.length !== 6) invalidCapture();

  let protocolId;
  let previousAt = -Infinity;
  const frames = input.capture.map(record => {
    if (!record || Object.keys(record).some(key => !RECORD_KEYS.has(key)) ||
        record.event !== 'private_answer_frame' || record.appliedStateVerified !== false ||
        !Number.isSafeInteger(record.session) || record.session < 1 ||
        typeof record.at !== 'string' || !Number.isFinite(Date.parse(record.at)) ||
        Date.parse(record.at) < previousAt || typeof record.frameHex !== 'string' ||
        !/^(?:[0-9a-f]{2}){1,256}$/.test(record.frameHex)) invalidCapture();
    previousAt = Date.parse(record.at);
    const bytes = Buffer.from(record.frameHex, 'hex');
    if (bytes.toString('hex') !== record.frameHex) invalidCapture();
    // latin1 preserves high bytes so non-ASCII input cannot pass as ASCII.
    const match = /^\[3G\*(\d{10})\*([0-9a-f]{4})\*([A-Z]+)(?:,([0-9A-Z,-]+))?\]$/.exec(bytes.toString('latin1'));
    if (!match || match[0] !== bytes.toString('latin1') || record.prefix !== '3G' || record.lengthField !== match[2] ||
        record.command !== match[3] ||
        parseInt(match[2], 16) !== Buffer.byteLength(match[3] + (match[4] === undefined ? '' : `,${match[4]}`))) invalidCapture();
    if (protocolId && protocolId !== match[1]) invalidCapture();
    protocolId = match[1];
    return { bytes, length: match[2], payload: match[3] + (match[4] === undefined ? '' : `,${match[4]}`) };
  });

  const directions = ['server_to_watch', 'watch_to_server', 'server_to_watch',
    'server_to_watch', 'watch_to_server', 'watch_to_server'];
  const lengths = ['0013', '0005', '000c', '0007', '0007', '0005'];
  const payloads = [/^ACALL,00\d{11}$/, /^ACALL$/, /^APPLOCK,JT-0$/, /^ACALL,0$/, /^APPLOCK$/, /^ACALL$/];
  if (frames.some((frame, i) => frame.length !== lengths[i] || !payloads[i].test(frame.payload) ||
      input.capture[i].direction !== directions[i]) ||
      input.capture[0].session !== input.capture[1].session ||
      input.capture.slice(2).some(record => record.session !== input.capture[2].session)) invalidCapture();

  const bytes = Buffer.concat(input.mode === 'auto' ? [frames[0].bytes] : [frames[2].bytes, frames[3].bytes]);
  return { bytes, metadata: {
    mode: input.mode, protocolId, frameCount: input.mode === 'auto' ? 1 : 2,
    sequenceDigest: createHash('sha256').update(bytes).digest('hex'),
    appliedStateVerified: false, callerScopeVerified: false,
    settingMayPersist: true, automaticExpiry: false,
  } };
}

function sendCapturedAnswerTrial(input, { findSessions = findSocketsForDevice, now = Date.now } = {}) {
  const { bytes, metadata } = prepareCapturedAnswerTrial(input);
  const candidates = findSessions(input.imei).filter(({ socket, session }) =>
    session.imei === input.imei && !socket.destroyed && !socket.writableEnded && socket.writable !== false &&
    Number.isFinite(session.lastPacketAt) && now() - session.lastPacketAt <= MAX_SESSION_AGE_MS &&
    now() >= session.lastPacketAt);
  if (!candidates.length) return { ...metadata, ok: false, outcome: 'not_sent', reason: 'no_fresh_identified_session', sessions: 0 };
  if (candidates.some(({ session }) => session.protocolId !== metadata.protocolId)) {
    return { ...metadata, ok: false, outcome: 'not_sent', reason: 'capture_device_mismatch', sessions: 0 };
  }
  candidates.sort((a, b) => b.session.lastPacketAt - a.session.lastPacketAt);
  try {
    // One ordered write on the freshest identified socket. Do not broadcast a
    // two-command transition over duplicate sessions or retry a partial write.
    // false means backpressure/queued bytes, not failure.
    candidates[0].socket.write(bytes);
  } catch {
    return { ...metadata, ok: false, outcome: 'handoff_unknown', reason: 'socket_write_uncertain', sessions: 1 };
  }
  return { ...metadata, ok: true, outcome: 'socket_handoff', sessions: 1 };
}

module.exports = { MAX_CAPTURE_BYTES, parseCaptureFile, prepareCapturedAnswerTrial, sendCapturedAnswerTrial };
