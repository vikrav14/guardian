const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SERVICE_CONTRACT,
} = require('../src/service-backbones/approved-calling');

test('approved-calling remains a disabled service backbone', () => {
  assert.equal(SERVICE_CONTRACT.lifecycle, 'backbone');
  assert.equal(SERVICE_CONTRACT.enabledByDefault, false);
  assert.equal(SERVICE_CONTRACT.customerVisible, false);
  assert.equal(SERVICE_CONTRACT.minimumPlan, 'essential');
  assert.equal(SERVICE_CONTRACT.callDirection, 'approved-guardian-to-watch-only');
  assert.deepEqual(SERVICE_CONTRACT.protocolCommands, ['PHBX']);
  assert.ok(!SERVICE_CONTRACT.protocolCommands.includes('CALL'));
  assert.ok(SERVICE_CONTRACT.provenBehaviors.includes('unknown number is blocked'));
  assert.ok(SERVICE_CONTRACT.backendMilestones.length > 0);
  assert.ok(SERVICE_CONTRACT.frontendMilestones.length > 0);
  assert.ok(SERVICE_CONTRACT.acceptanceGates.length > 0);
  assert.ok(Object.isFrozen(SERVICE_CONTRACT));
});
