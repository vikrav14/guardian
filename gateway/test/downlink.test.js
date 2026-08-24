const test = require('node:test');
const assert = require('node:assert/strict');
const { redactDownlinkCommand } = require('../src/downlink');

test('downlink logging redacts PHBX contact data and an optional picture', () => {
  assert.equal(
    redactDownlinkCommand('PHBX,1,0054006500730074,+23057123456,'),
    'PHBX,1,<name-redacted>,***3456,'
  );
  assert.equal(
    redactDownlinkCommand('PHBX,2,0041006C00650078,+23057123456,ABCDEF'),
    'PHBX,2,<name-redacted>,***3456,<picture-redacted>'
  );
});

test('downlink logging redacts call destinations without changing safe commands', () => {
  assert.equal(redactDownlinkCommand('CALL,+23057123456'), 'CALL,***3456');
  assert.equal(redactDownlinkCommand('MONITOR,+23057123456'), 'MONITOR,***3456');
  assert.equal(redactDownlinkCommand('SOS1,+23057123456'), 'SOS1,***3456');
  assert.equal(redactDownlinkCommand('FIND'), 'FIND');
});
