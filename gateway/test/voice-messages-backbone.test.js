const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SERVICE_CONTRACT,
  SOS_VOICE_BUTTON_PREFIX,
  unescapeV52VoiceData,
  inspectAmr,
  validateSosVoiceClip,
  buildVoiceClipId,
  parseSosVoiceButtonPayload,
} = require('../src/service-backbones/voice-messages');

function oneFrameAmr() {
  const frame = Buffer.alloc(13, 0);
  frame[0] = 0x04; // AMR-NB FT=0, quality bit set; 12 payload bytes.
  return Buffer.concat([Buffer.from('#!AMR\n', 'ascii'), frame]);
}

test('voice-messages is implemented behind a disabled acceptance gate', () => {
  assert.equal(SERVICE_CONTRACT.lifecycle, 'development');
  assert.equal(SERVICE_CONTRACT.enabledByDefault, false);
  assert.equal(SERVICE_CONTRACT.customerVisible, false);
  assert.equal(SERVICE_CONTRACT.minimumPlan, 'family');
  assert.deepEqual(SERVICE_CONTRACT.protocolCommands, ['TK']);
  assert.match(SERVICE_CONTRACT.safetyControls.join(' '), /active SOS only/);
  assert.match(SERVICE_CONTRACT.safetyControls.join(' '), /no remote microphone/);
  assert.ok(Object.isFrozen(SERVICE_CONTRACT));
});

test('V52 TK unescape restores every vendor-documented binary byte', () => {
  const wire = Buffer.from([
    0x41,
    0x7d, 0x01,
    0x7d, 0x02,
    0x7d, 0x03,
    0x7d, 0x04,
    0x7d, 0x05,
    0xff,
  ]);
  assert.deepEqual(
    unescapeV52VoiceData(wire),
    Buffer.from([0x41, 0x7d, 0x5b, 0x5d, 0x2c, 0x2a, 0xff])
  );
  assert.throws(
    () => unescapeV52VoiceData(Buffer.from([0x7d, 0x09])),
    /invalid_v52_tk_escape/
  );
});

test('AMR inspection proves codec, frame count, duration and size', () => {
  const audio = oneFrameAmr();
  assert.deepEqual(inspectAmr(audio), {
    ok: true,
    codec: 'amr-nb',
    contentType: 'audio/amr',
    extension: 'amr',
    frameCount: 1,
    durationMs: 20,
    byteLength: audio.length,
  });
  assert.equal(validateSosVoiceClip(audio).ok, true);
  assert.equal(validateSosVoiceClip(Buffer.from('not audio')).reason, 'unsupported_amr_header');
});

test('AMR validation rejects truncated frames and clips over the configured duration', () => {
  const truncated = Buffer.concat([
    Buffer.from('#!AMR\n', 'ascii'),
    Buffer.from([0x04, 0x00]),
  ]);
  assert.equal(validateSosVoiceClip(truncated).reason, 'invalid_amr_frame');

  const twoFrames = Buffer.concat([oneFrameAmr(), oneFrameAmr().subarray(6)]);
  assert.equal(
    validateSosVoiceClip(twoFrames, { maxDurationMs: 20 }).reason,
    'voice_clip_too_long'
  );
});

test('AMR-WB is detected but rejected until the delivery path is accepted', () => {
  const amrWideband = Buffer.concat([
    Buffer.from('#!AMR-WB\n', 'ascii'),
    Buffer.from([0x04]),
    Buffer.alloc(17),
  ]);

  assert.equal(inspectAmr(amrWideband).codec, 'amr-wb');
  assert.deepEqual(validateSosVoiceClip(amrWideband), {
    ok: false,
    reason: 'unsupported_amr_codec',
    codec: 'amr-wb',
  });
});

test('clip ids are deterministic without exposing IMEI or audio', () => {
  const audio = oneFrameAmr();
  const first = buildVoiceClipId({ imei: '123456789012345', alertId: 'a1', audio });
  const second = buildVoiceClipId({ imei: '123456789012345', alertId: 'a1', audio });
  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{40}$/);
  assert.doesNotMatch(first, /123456/);
});

test('SOS voice quick-reply payload accepts only bounded opaque tokens', () => {
  const token = 'abcdefghijklmnopqrstuvwxyz123456';
  assert.equal(
    parseSosVoiceButtonPayload(`${SOS_VOICE_BUTTON_PREFIX}${token}`),
    token
  );
  assert.equal(parseSosVoiceButtonPayload('Play SOS voice message'), null);
  assert.equal(parseSosVoiceButtonPayload(`${SOS_VOICE_BUTTON_PREFIX}short`), null);
});
