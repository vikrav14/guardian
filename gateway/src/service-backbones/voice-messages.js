'use strict';

const crypto = require('crypto');

const V52_TK_ESCAPE = 0x7d;
const V52_TK_UNESCAPE = Object.freeze({
  0x01: 0x7d,
  0x02: 0x5b,
  0x03: 0x5d,
  0x04: 0x2c,
  0x05: 0x2a,
});

const AMR_NB_MAGIC = Buffer.from('#!AMR\n', 'ascii');
const AMR_WB_MAGIC = Buffer.from('#!AMR-WB\n', 'ascii');

// Includes the one-byte frame header. Each AMR speech frame represents 20 ms.
const AMR_NB_FRAME_BYTES = Object.freeze([
  13, 14, 16, 18, 20, 21, 27, 32, 6, 0, 0, 0, 0, 0, 0, 1,
]);
const AMR_WB_FRAME_BYTES = Object.freeze([
  18, 24, 33, 37, 41, 47, 51, 59, 61, 6, 0, 0, 0, 0, 1, 1,
]);

const MAX_SOS_VOICE_BYTES = 512 * 1024;
const MAX_SOS_VOICE_DURATION_MS = 30 * 1000;
const SOS_VOICE_WINDOW_MS = 30 * 60 * 1000;
const SOS_VOICE_RETENTION_MS = 24 * 60 * 60 * 1000;
const SOS_VOICE_BUTTON_PREFIX = 'guardian_sos_voice:';

const SERVICE_CONTRACT = Object.freeze({
  serviceId: 'voice-messages',
  displayName: 'SOS voice messages',
  minimumPlan: 'family',
  lifecycle: 'development',
  enabledByDefault: false,
  customerVisible: false,
  protocolCommands: Object.freeze(['TK']),
  safetyControls: Object.freeze([
    'active SOS only',
    'approved recipients only',
    'bounded AMR clip duration and size',
    'private expiring storage',
    'recipient-bound WhatsApp playback',
    'no remote microphone activation',
  ]),
  backendMilestones: Object.freeze([
    'binary-safe V52 TK decoding',
    'SOS-bound AMR validation',
    'private expiring storage',
    'WhatsApp quick-reply playback',
  ]),
  frontendMilestones: Object.freeze([
    'show clip availability on the SOS alert after acceptance',
    'show delivery and expiry state',
    'show mobile-data disclosure',
  ]),
  acceptanceGates: Object.freeze([
    'confirm exact V52 TK uplink framing',
    'validate codec and maximum payload on real hardware',
    'measure data consumption',
    'approve guardian_sos_voice_ready_v1 template',
    'verify expired media cannot be fetched',
  ]),
});

function unescapeV52VoiceData(value) {
  const input = Buffer.isBuffer(value) ? value : Buffer.from(value || []);
  const output = [];

  for (let index = 0; index < input.length; index += 1) {
    const byte = input[index];
    if (byte !== V52_TK_ESCAPE) {
      output.push(byte);
      continue;
    }

    const escaped = input[index + 1];
    if (escaped == null || V52_TK_UNESCAPE[escaped] == null) {
      throw new Error('invalid_v52_tk_escape');
    }
    output.push(V52_TK_UNESCAPE[escaped]);
    index += 1;
  }

  return Buffer.from(output);
}

function inspectAmr(value) {
  const audio = Buffer.isBuffer(value) ? value : Buffer.from(value || []);
  let codec;
  let contentType;
  let extension;
  let offset;
  let frameSizes;

  if (audio.subarray(0, AMR_NB_MAGIC.length).equals(AMR_NB_MAGIC)) {
    codec = 'amr-nb';
    contentType = 'audio/amr';
    extension = 'amr';
    offset = AMR_NB_MAGIC.length;
    frameSizes = AMR_NB_FRAME_BYTES;
  } else if (audio.subarray(0, AMR_WB_MAGIC.length).equals(AMR_WB_MAGIC)) {
    codec = 'amr-wb';
    contentType = 'audio/amr-wb';
    extension = 'amr';
    offset = AMR_WB_MAGIC.length;
    frameSizes = AMR_WB_FRAME_BYTES;
  } else {
    return { ok: false, reason: 'unsupported_amr_header' };
  }

  let frameCount = 0;
  while (offset < audio.length) {
    const frameType = (audio[offset] >> 3) & 0x0f;
    const frameBytes = frameSizes[frameType] || 0;
    if (frameBytes <= 0 || offset + frameBytes > audio.length) {
      return { ok: false, reason: 'invalid_amr_frame', codec, frameCount };
    }
    offset += frameBytes;
    frameCount += 1;
  }

  if (frameCount === 0) {
    return { ok: false, reason: 'empty_amr_clip', codec, frameCount };
  }

  return {
    ok: true,
    codec,
    contentType,
    extension,
    frameCount,
    durationMs: frameCount * 20,
    byteLength: audio.length,
  };
}

function validateSosVoiceClip(value, {
  maxBytes = MAX_SOS_VOICE_BYTES,
  maxDurationMs = MAX_SOS_VOICE_DURATION_MS,
} = {}) {
  const audio = Buffer.isBuffer(value) ? value : Buffer.from(value || []);
  if (audio.length > maxBytes) {
    return { ok: false, reason: 'voice_clip_too_large', byteLength: audio.length };
  }

  const inspection = inspectAmr(audio);
  if (!inspection.ok) return inspection;
  // Meta currently documents audio/amr for WhatsApp audio delivery. Detect
  // AMR-WB so acceptance diagnostics remain precise, but fail closed until
  // the exact watch codec and a supported delivery/transcoding path are
  // proven on hardware.
  if (inspection.codec !== 'amr-nb') {
    return {
      ok: false,
      reason: 'unsupported_amr_codec',
      codec: inspection.codec,
    };
  }
  if (inspection.durationMs > maxDurationMs) {
    return {
      ok: false,
      reason: 'voice_clip_too_long',
      durationMs: inspection.durationMs,
      maxDurationMs,
    };
  }
  return inspection;
}

function buildVoiceClipId({ imei, alertId, audio }) {
  return crypto
    .createHash('sha256')
    .update(String(imei || ''))
    .update('\0')
    .update(String(alertId || ''))
    .update('\0')
    .update(Buffer.isBuffer(audio) ? audio : Buffer.from(audio || []))
    .digest('hex')
    .slice(0, 40);
}

function parseSosVoiceButtonPayload(value) {
  const text = String(value || '').trim();
  if (!text.startsWith(SOS_VOICE_BUTTON_PREFIX)) return null;
  const token = text.slice(SOS_VOICE_BUTTON_PREFIX.length);
  return /^[A-Za-z0-9_-]{20,96}$/.test(token) ? token : null;
}

module.exports = {
  SERVICE_CONTRACT,
  MAX_SOS_VOICE_BYTES,
  MAX_SOS_VOICE_DURATION_MS,
  SOS_VOICE_WINDOW_MS,
  SOS_VOICE_RETENTION_MS,
  SOS_VOICE_BUTTON_PREFIX,
  unescapeV52VoiceData,
  inspectAmr,
  validateSosVoiceClip,
  buildVoiceClipId,
  parseSosVoiceButtonPayload,
};
