'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMedicationVoiceFrame, inspectMedicationVoice } = require('../src/medication-voice-codec');

// Synthetic storage frames only; no real recording, medication or device data.
function audio(frameCount = 1, fill = 0) {
  const frames = Array.from({ length: frameCount }, () => {
    const frame = Buffer.alloc(32, fill); frame[0] = 0x3c; frame[31] &= 0xf0; return frame;
  });
  return Buffer.concat([Buffer.from('#!AMR\n'), ...frames]);
}
function input(overrides = {}) {
  return { protocolId: '8800000015', slot: 1, time: '09:30', enabled: true,
    frequency: 1, text: 'A', audio: audio(), ...overrides };
}
function body(frame) {
  assert.equal(frame.subarray(0, 4).toString(), '[3G*');
  assert.equal(parseInt(frame.subarray(15, 19).toString(), 16), frame.length - 21);
  assert.equal(frame.at(-1), 0x5d);
  return frame.subarray(20, -1);
}

test('framing uses escaped binary byte length and preserves all five delimiters', () => {
  const sample = audio();
  Buffer.from([0x7d,0x5b,0x5d,0x2c,0x2a,0x80,0xff]).copy(sample, 7);
  const original = Buffer.from(sample);
  const result = buildMedicationVoiceFrame(input({ audio: sample }));
  const prefix = Buffer.from('TAKEPILLS,09:30-1-1,1,0041,');
  const expectedVoice = Buffer.concat([Buffer.from('#!AMR\n'), Buffer.from([
    0x3c,0x7d,1,0x7d,2,0x7d,3,0x7d,4,0x7d,5,0x80,0xff,
  ]), Buffer.alloc(24)]);
  assert.deepEqual(body(result), Buffer.concat([prefix, expectedVoice]));
  assert.deepEqual(sample, original, 'must not mutate the stored recording');
  sample.fill(0);
  assert.deepEqual(body(result), Buffer.concat([prefix, expectedVoice]), 'result owns its bytes');
});

test('slot is independent of daily/once and explicit off keeps the recording', () => {
  const daily = body(buildMedicationVoiceFrame(input({ slot: 1, frequency: 2, enabled: false })));
  assert.ok(daily.subarray(0, 27).toString('ascii').startsWith('TAKEPILLS,09:30-0-2,1,0041,'));
  const once = body(buildMedicationVoiceFrame(input({ slot: 3, frequency: 1 })));
  assert.ok(once.subarray(0, 27).toString('ascii').startsWith('TAKEPILLS,09:30-1-1,3,0041,'));
  assert.deepEqual(daily.subarray(daily.indexOf(Buffer.from('#!AMR\n'))),
    once.subarray(once.indexOf(Buffer.from('#!AMR\n'))));
});

test('Unicode text uses UTF-16BE code units without audio/string conversion', () => {
  const payload = body(buildMedicationVoiceFrame(input({ text: 'Aé😀' })));
  assert.ok(payload.subarray(0, 50).toString('latin1').startsWith('TAKEPILLS,09:30-1-1,1,004100e9d83dde00,'));
  for (const text of ['\ud800', '\udc00', 'A\ud800B']) {
    assert.throws(() => buildMedicationVoiceFrame(input({ text })), /invalid_unicode/);
  }
});

test('profile metadata counts frames without claiming playback', () => {
  assert.deepEqual(inspectMedicationVoice(audio(174)), {
    codec:'amr-nb', sampleRateHz:8000, channels:1, bitRate:12200, frameCount:174, durationMs:3480,
  });
});

test('rejects truncated, empty, corrupt, wideband and other-profile audio', () => {
  const badQuality = audio(); badQuality[6] = 0x38;
  const otherRate = audio(); otherRate[6] = 0x34;
  const pad = audio(); pad[37] = 1;
  for (const sample of [Buffer.alloc(0), Buffer.from('#!AMR\n'), Buffer.from('#!AMR-WB\n'),
    audio().subarray(0, -1), badQuality, otherRate, pad, Buffer.from('RIFF'), 'audio']) {
    assert.throws(() => buildMedicationVoiceFrame(input({ audio: sample })), /medication_voice_/);
  }
});

test('rejects ambiguous settings and weekly voice without leaking supplied values', () => {
  for (const change of [
    { protocolId:'bad*[private]' }, { slot:0 }, { slot:4 }, { slot:'1' },
    { time:'24:00' }, { time:'9:30' }, { time:'09:60' }, { time:'09:30,CR' },
    { enabled:undefined }, { enabled:1 }, { enabled:'false' }, { frequency:'1' },
    { frequency:3 }, { frequency:0 }, { week:'1000000' }, { text:'' }, { text:'  ' },
  ]) {
    assert.throws(() => buildMedicationVoiceFrame(input(change)), error => {
      assert.match(error.message, /^medication_voice_[a-z_]+$/); return true;
    });
  }
});

test('bounds raw audio, text and escaped payload before creating oversized frames', () => {
  assert.throws(() => buildMedicationVoiceFrame(input({ audio:audio(2048) })), /audio_too_large/);
  assert.throws(() => buildMedicationVoiceFrame(input({ text:'A'.repeat(16384) })), /payload_too_large/);
  // Raw size fits, but escaping the many reserved bytes would exceed 16-bit LEN.
  assert.throws(() => buildMedicationVoiceFrame(input({ audio:audio(1100, 0x7d) })), /payload_too_large/);
  // Text leaves no room for the valid audio, despite each input fitting alone.
  assert.throws(() => buildMedicationVoiceFrame(input({ text:'A'.repeat(16380) })), /payload_too_large/);
  body(buildMedicationVoiceFrame(input({ audio:audio(100, 0x7d) })));
});
