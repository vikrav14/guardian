const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SERVICE_CONTRACT,
} = require('../src/service-backbones/remote-photo');

test('Safety snapshot has an observed command but remains default-off', () => {
  assert.equal(SERVICE_CONTRACT.lifecycle, 'controlled_app_integration');
  assert.equal(SERVICE_CONTRACT.enabledByDefault, false);
  assert.equal(SERVICE_CONTRACT.customerVisible, false);
  assert.equal(SERVICE_CONTRACT.minimumPlan, 'family');
  assert.ok(SERVICE_CONTRACT.protocolCommands.includes('PIC'));
  assert.ok(SERVICE_CONTRACT.protocolCommands.includes('rcapture'));
  assert.deepEqual(SERVICE_CONTRACT.acceptedProtocolCommands, ['rcapture']);
  assert.ok(SERVICE_CONTRACT.backendMilestones.length > 0);
  assert.ok(SERVICE_CONTRACT.frontendMilestones.length > 0);
  assert.ok(SERVICE_CONTRACT.acceptanceGates.length > 0);
  assert.ok(Object.isFrozen(SERVICE_CONTRACT));
});
