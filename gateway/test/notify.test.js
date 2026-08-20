const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeE164, buildMessage } = require('../src/notify');

test('normalizeE164 leaves an already-E.164 number untouched', () => {
  assert.equal(normalizeE164('+23057123456'), '+23057123456');
});

test('normalizeE164 adds +230 to an 8-digit Mauritius mobile number', () => {
  assert.equal(normalizeE164('57123456'), '+23057123456');
});

test('normalizeE164 adds a bare + prefix to other plain digit strings', () => {
  assert.equal(normalizeE164('447911123456'), '+447911123456');
});

test('normalizeE164 strips spaces/dashes before normalizing', () => {
  assert.equal(normalizeE164('+230 57-123-456'), '+23057123456');
});

test('buildMessage renders SOS safely without exposing IMEI', () => {
  const msg = buildMessage('359633100123456', {
    type: 'sos',
    message: 'Help requested',
  });

  assert.match(msg, /GUARDIAN SOS/);
  assert.match(msg, /SOS alert received/);
  assert.match(msg, /Location unavailable/);
  assert.doesNotMatch(msg, /359633100123456/);
  assert.doesNotMatch(msg, /IMEI/i);
});

test('buildMessage never borrows a later location for a legacy fall alert', () => {
  const msg = buildMessage('359633100123456', {
    type: 'fall',
    eventAt: new Date('2026-08-15T10:00:00.000Z'),
    payload: {},
  }, {
    nickname: 'Jesh',
    accuracySource: 'gps',
    location: {
      lat: -20.1609,
      lng: 57.5012,
      placeLabel: 'Port Louis',
      recordedAt: new Date('2026-08-15T10:05:00.000Z'),
    },
  });

  assert.match(msg, /GUARDIAN FALL ALERT/);
  assert.match(msg, /Location unavailable/);
  assert.doesNotMatch(msg, /Port Louis/);
  assert.doesNotMatch(msg, /maps\.google/);
});
