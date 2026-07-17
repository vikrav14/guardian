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

test('buildMessage includes the alert type, message, and imei', () => {
  const msg = buildMessage('359633100123456', { type: 'sos', message: 'Help requested' });
  assert.match(msg, /SOS/);
  assert.match(msg, /Help requested/);
  assert.match(msg, /359633100123456/);
});
