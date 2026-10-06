'use strict';
const {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} = require('node:worker_threads');
const { MAX_PCM_BYTES, inspectVoice } = require('./voice-message-codec');
function wav(pcm) {
  validatePcm(pcm);
  const h = Buffer.alloc(44);
  h.write('RIFF');
  h.writeUInt32LE(pcm.length + 36, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(8000, 24);
  h.writeUInt32LE(16000, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
function validatePcm(pcm) {
  if (
    !Buffer.isBuffer(pcm) ||
    pcm.length < 8000 ||
    pcm.length > MAX_PCM_BYTES ||
    pcm.length % 2
  )
    throw Error('recording_length_invalid');
  return pcm;
}
let active = 0;
async function convertVoice(bytes, mode) {
  if (mode === 'encode') validatePcm(bytes);
  else if (mode === 'decode') inspectVoice(bytes);
  else throw Error('audio_operation_invalid');
  if (active >= 2) throw Error('audio_busy');
  active++;
  try {
    return await new Promise((resolve, reject) => {
      const worker = new Worker(__filename, {
        workerData: { bytes, mode },
        resourceLimits: {
          maxOldGenerationSizeMb: 64,
          maxYoungGenerationSizeMb: 16,
        },
      });
      let done = false;
      const finish = (error, value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        void worker.terminate();
        error ? reject(Error(error)) : resolve(value);
      };
      const timer = setTimeout(() => finish('audio_timeout'), 5000);
      worker.once('error', () => finish('audio_failed'));
      worker.once('exit', () => finish('audio_failed'));
      worker.once('message', (value) => {
        try {
          const result = Buffer.from(value);
          mode === 'encode' ? inspectVoice(result) : validatePcm(result);
          finish(null, result);
        } catch {
          finish('audio_failed');
        }
      });
    });
  } finally {
    active--;
  }
}
if (!isMainThread) {
  const bytes = Buffer.from(workerData.bytes),
    codec = require('../vendor/opencore-amr/amrnb.cjs');
  if (workerData.mode === 'encode') {
    validatePcm(bytes);
    const samples = new Float32Array(Math.ceil(bytes.length / 320) * 160 + 160);
    for (let i = 0; i < bytes.length / 2; i++)
      samples[i] = bytes.readInt16LE(i * 2) / 32768;
    parentPort.postMessage(codec.encode(samples, 8000, 7));
  } else {
    const info = inspectVoice(bytes),
      samples = codec._decode(bytes);
    if (!samples || samples.length !== info.frameCount * 160)
      throw Error('audio_decode_incomplete');
    const pcm = Buffer.alloc(samples.length * 2);
    for (let i = 0; i < samples.length; i++)
      pcm.writeInt16LE(samples[i], i * 2);
    parentPort.postMessage(pcm);
  }
}
module.exports = { convertVoice, validatePcm, wav };
