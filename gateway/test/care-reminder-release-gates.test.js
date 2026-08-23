'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('Care reminder environment examples remain default-off', () => {
  const env = read('.env.example');
  assert.match(env, /^CARE_REMINDERS_REQUESTS_ENABLED=false$/m);
  assert.match(env, /^CARE_REMINDERS_DEVICE_MODE=unverified$/m);
  assert.match(env, /^CARE_REMINDERS_CUSTOMER_ENABLED=false$/m);
});

test('Care reminder request processor cannot dispatch a watch command', () => {
  const source = read('src/care-reminder-requests.js');
  assert.doesNotMatch(source, /sendDeviceCommand/);
  assert.doesNotMatch(source, /sendDownlinkCommand/);
  assert.doesNotMatch(source, /sendMetaTemplate/);
  assert.match(source, /deviceCommandSent:\s*false/);
});

test('unaccepted reminder protocol surfaces are absent from generic command dispatch', () => {
  const commands = read('src/commands.js');
  for (const command of ['SEDENTARY', 'REMIND', 'HSW']) {
    assert.doesNotMatch(commands, new RegExp(`['\"]${command}['\"]\\s*:`));
  }
});
