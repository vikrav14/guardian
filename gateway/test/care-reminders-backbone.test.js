const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SERVICE_CONTRACT,
} = require('../src/service-backbones/care-reminders');

test('care-reminders remains disabled and customer-hidden', () => {
  assert.equal(SERVICE_CONTRACT.lifecycle, 'implementation-disabled');
  assert.equal(SERVICE_CONTRACT.enabledByDefault, false);
  assert.equal(SERVICE_CONTRACT.customerVisible, false);
  assert.equal(SERVICE_CONTRACT.minimumPlan, 'care');
  assert.ok(SERVICE_CONTRACT.protocolCommands.length > 0);
  assert.deepEqual(SERVICE_CONTRACT.acceptedProtocolCommands, []);
  assert.ok(SERVICE_CONTRACT.backendMilestones.length > 0);
  assert.ok(SERVICE_CONTRACT.frontendMilestones.length > 0);
  assert.ok(SERVICE_CONTRACT.acceptanceGates.length > 0);
  assert.ok(Object.isFrozen(SERVICE_CONTRACT));
});
