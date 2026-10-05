'use strict';

// Pure codec: no storage, logging or I/O. The guarded medication sender owns
// authorization, slot ownership, session selection and dispatch.
// Evidence: 5 Oct 2026 AnyTracking TAKEPILLS capture and operator-confirmed
// Once playback. See docs/services/voice-medication-reminders.md.
const MAX_PAYLOAD_BYTES = 0xffff;
const AMR_MAGIC = Buffer.from('#!AMR\n', 'ascii');
const ESCAPES = new Map([[0x7d, 1], [0x5b, 2], [0x5d, 3], [0x2c, 4], [0x2a, 5]]);

/**
 * Accept the captured single-channel AMR-NB 12.2 kb/s profile only.
 * Storage layout: RFC 4867 sections 5.1/5.3; mode 7 has 244 speech bits
 * and a one-byte header, hence 32 bytes per 20 ms speech frame.
 * This checks structure, not speech intelligibility or watch playback.
 * The byte bound comes from the protocol envelope, not a hardware-duration claim.
 */
function inspectMedicationVoice(audio) {
  if (!Buffer.isBuffer(audio)) throw new Error('medication_voice_buffer_required');
  if (audio.length > MAX_PAYLOAD_BYTES) throw new Error('medication_voice_audio_too_large');
  if (!audio.subarray(0, AMR_MAGIC.length).equals(AMR_MAGIC)) {
    throw new Error('medication_voice_amr_nb_required');
  }
  const speechBytes = audio.length - AMR_MAGIC.length;
  if (speechBytes <= 0 || speechBytes % 32 !== 0) {
    throw new Error('medication_voice_incomplete_audio');
  }
  for (let offset = AMR_MAGIC.length; offset < audio.length; offset += 32) {
    // 0x3c: mode 7, good-quality bit, zero storage-header padding.
    // Other rates, SID/DTX, bad-quality frames and noncanonical padding are
    // intentionally outside this capture-backed profile.
    if (audio[offset] !== 0x3c || (audio[offset + 31] & 0x0f) !== 0) {
      throw new Error('medication_voice_unsupported_amr_profile');
    }
  }
  return { codec: 'amr-nb', sampleRateHz: 8000, channels: 1,
    bitRate: 12200, frameCount: speechBytes / 32, durationMs: speechBytes / 32 * 20 };
}

function encodeVoiceBytes(audio, availableBytes) {
  let length = audio.length;
  for (const byte of audio) if (ESCAPES.has(byte)) length++;
  if (length > availableBytes) throw new Error('medication_voice_payload_too_large');
  const escaped = Buffer.alloc(length);
  let offset = 0;
  for (const byte of audio) {
    const code = ESCAPES.get(byte);
    if (code) { escaped[offset++] = 0x7d; escaped[offset++] = code; }
    else escaped[offset++] = byte;
  }
  return escaped;
}

function textHex(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('medication_voice_text_required');
  if (text.length > Math.floor(MAX_PAYLOAD_BYTES / 4)) throw new Error('medication_voice_payload_too_large');
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const low = text.charCodeAt(++i);
      if (!(low >= 0xdc00 && low <= 0xdfff)) throw new Error('medication_voice_invalid_unicode');
    } else if (unit >= 0xdc00 && unit <= 0xdfff) throw new Error('medication_voice_invalid_unicode');
  }
  return Buffer.from(text, 'utf16le').swap16().toString('hex');
}

/**
 * Returns private binary frame bytes, never a loggable command string.
 * Caller must separately enforce consent, plan/access, slot ownership, revision,
 * one current session, command coordination and expiry before any future send.
 * This module neither authorizes nor dispatches a command. Weekly voice is
 * withheld until the conflicting weekday-order evidence is resolved.
 */
function buildMedicationSettingsFrame({ protocolId, slot, time, enabled, frequency, week, text, audio } = {}) {
  if (typeof protocolId !== 'string' || !/^\d{10}$/.test(protocolId)) {
    throw new Error('medication_voice_invalid_protocol_id');
  }
  if (!Number.isInteger(slot) || slot < 1 || slot > 3) throw new Error('medication_voice_invalid_slot');
  if (typeof time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new Error('medication_voice_invalid_time');
  }
  if (typeof enabled !== 'boolean') throw new Error('medication_voice_enabled_required');
  if (frequency === 3 || week != null) throw new Error('medication_voice_weekly_unverified');
  if (frequency !== 1 && frequency !== 2) throw new Error('medication_voice_invalid_frequency');
  if (audio != null) inspectMedicationVoice(audio);
  const prefix = Buffer.from(`TAKEPILLS,${time}-${enabled ? 1 : 0}-${frequency},${slot},${textHex(text)},`, 'ascii');
  const voice = audio == null ? Buffer.alloc(0) : encodeVoiceBytes(audio, MAX_PAYLOAD_BYTES - prefix.length);
  const payload = Buffer.concat([prefix, voice]);
  const length = payload.length.toString(16).toUpperCase().padStart(4, '0');
  return Buffer.concat([Buffer.from(`[3G*${protocolId}*${length}*`, 'ascii'), payload, Buffer.from(']')]);
}

function buildMedicationVoiceFrame(value) {
  inspectMedicationVoice(value?.audio);
  return buildMedicationSettingsFrame(value);
}
module.exports = { buildMedicationVoiceFrame, buildMedicationSettingsFrame, inspectMedicationVoice };
