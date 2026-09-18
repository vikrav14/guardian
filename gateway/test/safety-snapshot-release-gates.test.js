const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { SERVICE_CONTRACT } = require('../src/service-backbones/remote-photo');
const { readSafetySnapshotRuntime } = require('../src/safety-snapshot-runtime');

test('Safety snapshot release gates remain fail-closed', () => {
  const runtime = readSafetySnapshotRuntime({});
  assert.equal(SERVICE_CONTRACT.customerVisible, false);
  assert.deepEqual(SERVICE_CONTRACT.acceptedProtocolCommands, []);
  assert.equal(runtime.requestWatcherEnabled, false);
  assert.equal(runtime.customerEnabled, false);
  assert.equal(runtime.mediaIngressAllowed, false);
  assert.equal(runtime.deviceDispatchAllowed, false);
});

test('generic command layer has no Safety snapshot capture builder', () => {
  const commands = fs.readFileSync(path.join(__dirname, '..', 'src', 'commands.js'), 'utf8');
  assert.equal(/rcapture\s*[:(]/i.test(commands), false);
  assert.equal(/PIC\s*[:(]/.test(commands), false);
  assert.equal(/FTPIP\s*[:(]/.test(commands), false);
  assert.equal(/FTPPWD\s*[:(]/.test(commands), false);
});
