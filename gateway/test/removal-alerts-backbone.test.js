const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SERVICE_CONTRACT,
} = require('../src/service-backbones/removal-alerts');

test('removal-alerts remains a disabled implemented service', () => {
  assert.equal(SERVICE_CONTRACT.lifecycle, 'implementation_disabled');
  assert.equal(SERVICE_CONTRACT.enabledByDefault, false);
  assert.equal(SERVICE_CONTRACT.minimumPlan, 'family');
  assert.equal(SERVICE_CONTRACT.customerVisible, false);
  assert.ok(SERVICE_CONTRACT.protocolCommands.length > 0);
  assert.ok(SERVICE_CONTRACT.backendMilestones.length > 0);
  assert.ok(SERVICE_CONTRACT.frontendMilestones.length > 0);
  assert.ok(SERVICE_CONTRACT.acceptanceGates.length > 0);
  assert.ok(Object.isFrozen(SERVICE_CONTRACT));
});
