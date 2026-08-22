const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SERVICE_CONTRACT,
} = require('../src/service-backbones/voice-messages');

test('voice-messages remains a disabled service backbone', () => {
  assert.equal(SERVICE_CONTRACT.lifecycle, 'backbone');
  assert.equal(SERVICE_CONTRACT.enabledByDefault, false);
  assert.equal(SERVICE_CONTRACT.minimumPlan, 'family');
  assert.ok(SERVICE_CONTRACT.protocolCommands.length > 0);
  assert.ok(SERVICE_CONTRACT.backendMilestones.length > 0);
  assert.ok(SERVICE_CONTRACT.frontendMilestones.length > 0);
  assert.ok(SERVICE_CONTRACT.acceptanceGates.length > 0);
  assert.ok(Object.isFrozen(SERVICE_CONTRACT));
});
