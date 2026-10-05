'use strict';
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const { inspectMedicationVoice } = require('./medication-voice-codec');
const MAX_PCM_BYTES = 160_000; // Product limit: ten seconds, 8 kHz mono PCM16.
function validatePcm(pcm) {
  if (!Buffer.isBuffer(pcm) || pcm.length < 8000 || pcm.length > MAX_PCM_BYTES || pcm.length % 2) {
    throw new Error('recording_length_invalid');
  }
  return pcm;
}
function wav(pcm) {
  const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(8000, 24); header.writeUInt32LE(16000, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
let active = 0;
async function encodeMedicationAudio(pcm) {
  validatePcm(pcm);
  if (active >= 2) throw new Error('audio_encoder_busy');
  active++;
  try {
    return await new Promise((resolve, reject) => {
      const worker = new Worker(__filename, { workerData: pcm,
        resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16 } });
      let finished = false;
      const end = (error, value) => {
        if (finished) return; finished = true; clearTimeout(timer);
        worker.terminate(); error ? reject(error) : resolve(value);
      };
      const timer = setTimeout(() => end(new Error('audio_encoder_timeout')), 5000);
      worker.once('error', () => end(new Error('audio_encoder_failed')));
      worker.once('exit', () => end(new Error('audio_encoder_failed')));
      worker.once('message', result => {
        try {
          const audio = Buffer.from(result);
          const metadata = inspectMedicationVoice(audio);
          end(null, { audio, ...metadata });
        } catch { end(new Error('audio_encoder_failed')); }
      });
    });
  } finally { active--; }
}
if (!isMainThread) {
  const pcm = validatePcm(Buffer.from(workerData));
  const codec = require('../vendor/opencore-amr/amrnb.cjs');
  // Upstream encoder omits its final complete block. A zero block preserves
  // all input samples, including a short final block, without truncating speech.
  const samples = new Float32Array(Math.ceil(pcm.length / 320) * 160 + 160);
  for (let i = 0; i < pcm.length / 2; i++) samples[i] = pcm.readInt16LE(i * 2) / 32768;
  parentPort.postMessage(codec.encode(samples, 8000, 7));
}
module.exports = { validatePcm, encodeMedicationAudio, wav, MAX_PCM_BYTES };
