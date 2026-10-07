'use strict';
const { inspectMedicationVoice } = require('./medication-voice-codec');
const MAX_SECONDS = 30,
  MAX_PCM_BYTES = MAX_SECONDS * 16000;
const ESCAPE = new Map([
  [0x7d, 1],
  [0x5b, 2],
  [0x5d, 3],
  [0x2c, 4],
  [0x2a, 5],
]);
const RAW = [null, 0x7d, 0x5b, 0x5d, 0x2c, 0x2a];
function inspectVoice(audio) {
  const value = inspectMedicationVoice(audio);
  if (value.durationMs > MAX_SECONDS * 1000) throw Error('voice_too_long');
  return value;
}
function isVoiceFrame(frame) {
  // Classify without converting private audio into text, even when malformed.
  if (!Buffer.isBuffer(frame) || frame[0] !== 0x5b) return false;
  let at = 0;
  for (let field = 0; field < 3; field++) {
    at = frame.indexOf(0x2a, at + 1);
    if (at < 0) return false;
  }
  return (
    frame[at + 1] === 84 &&
    frame[at + 2] === 75 &&
    [44, 93].includes(frame[at + 3])
  );
}
function decodeVoiceFrame(frame) {
  if (!isVoiceFrame(frame)) return null;
  const head = /^\[([A-Za-z0-9]{2})\*(\d{10})\*([a-fA-F0-9]{4})\*/.exec(
    frame.subarray(0, 20).toString('latin1'),
  );
  if (!head) throw Error('voice_invalid_header');
  const body = frame.subarray(20, -1);
  if (frame.at(-1) !== 0x5d || parseInt(head[3], 16) !== body.length)
    throw Error('voice_invalid_length');
  const meta = { prefix: head[1], protocolId: head[2] };
  if (body.equals(Buffer.from('TK'))) return { ...meta, kind: 'bare' };
  if (body.length === 4 && [48, 49].includes(body[3]))
    return { ...meta, kind: 'result', result: body[3] - 48 };
  const bytes = [];
  for (let i = 3; i < body.length; i++) {
    let byte = body[i];
    if (byte === 0x7d) {
      const code = body[++i];
      if (!RAW[code]) throw Error('voice_invalid_escape');
      byte = RAW[code];
    } else if (ESCAPE.has(byte)) throw Error('voice_unescaped_reserved_byte');
    bytes.push(byte);
  }
  const audio = Buffer.from(bytes),
    media = inspectVoice(audio);
  return { ...meta, kind: 'audio', audio, ...media };
}
function buildVoiceFrame(protocolId, audio) {
  if (!/^\d{10}$/.test(protocolId)) throw Error('voice_invalid_identity');
  inspectVoice(audio);
  const bytes = [84, 75, 44];
  for (const byte of audio) {
    const code = ESCAPE.get(byte);
    if (code) bytes.push(0x7d, code);
    else bytes.push(byte);
  }
  if (bytes.length > 0xffff) throw Error('voice_wire_too_large');
  return Buffer.concat([
    Buffer.from(
      `[SG*${protocolId}*${bytes.length.toString(16).toUpperCase().padStart(4, '0')}*`,
    ),
    Buffer.from(bytes),
    Buffer.from(']'),
  ]);
}
module.exports = {
  MAX_SECONDS,
  MAX_PCM_BYTES,
  inspectVoice,
  isVoiceFrame,
  decodeVoiceFrame,
  buildVoiceFrame,
};
