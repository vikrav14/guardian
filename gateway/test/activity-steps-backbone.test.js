const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SERVICE_CONTRACT,
} = require('../src/service-backbones/activity-steps');

test('activity-steps implementation remains customer-disabled', () => {
  assert.equal(SERVICE_CONTRACT.lifecycle, 'implementation_complete_disabled');
  assert.equal(SERVICE_CONTRACT.enabledByDefault, false);
  assert.equal(SERVICE_CONTRACT.customerVisible, false);
  assert.equal(SERVICE_CONTRACT.minimumPlan, 'family');
  assert.ok(SERVICE_CONTRACT.protocolCommands.length > 0);
  assert.ok(SERVICE_CONTRACT.completedBackendCapabilities.length > 0);
  assert.ok(SERVICE_CONTRACT.completedFrontendCapabilities.length > 0);
  assert.ok(SERVICE_CONTRACT.acceptanceGates.length > 0);
  assert.ok(Object.isFrozen(SERVICE_CONTRACT));
});
