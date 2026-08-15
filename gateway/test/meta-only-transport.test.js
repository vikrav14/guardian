'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

function source(name) {
  return fs.readFileSync(path.join(__dirname, '..', 'src', name), 'utf8');
}

test('WhatsApp transport is Meta-only with no Twilio route or fallback', () => {
  assert.doesNotMatch(source('notify.js'), /twilioWhatsAppFrom|sendWhatsApp/);
  assert.doesNotMatch(source('sos-whatsapp.js'), /fallbackSend|twilio-fallback/);
  assert.doesNotMatch(source('fall-whatsapp.js'), /fallbackSend|twilio-fallback/);
  assert.doesNotMatch(source('http.js'), /webhooks\/twilio\/whatsapp|sendTwiml/);
  assert.doesNotMatch(source('config.js'), /TWILIO_WHATSAPP_FROM|twilioWhatsAppFrom/);
});
