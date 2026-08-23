const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SERVICE_CONTRACT,
} = require('../src/service-backbones/care-wellbeing');

test('care-wellbeing remains disabled while in exact-device acceptance', () => {
  assert.equal(SERVICE_CONTRACT.lifecycle, 'device_acceptance');
  assert.equal(SERVICE_CONTRACT.enabledByDefault, false);
  assert.equal(SERVICE_CONTRACT.customerVisible, false);
  assert.equal(SERVICE_CONTRACT.minimumPlan, 'care');
  assert.ok(SERVICE_CONTRACT.protocolCommands.length > 0);
  assert.deepEqual(SERVICE_CONTRACT.acceptedUploads, ['bphrt', 'oxygen']);
  assert.deepEqual(SERVICE_CONTRACT.blockedUntilCaptured, ['bodytemp', 'bodytemp2', 'BTTIMESET']);
  assert.ok(SERVICE_CONTRACT.backendMilestones.length > 0);
  assert.ok(SERVICE_CONTRACT.frontendMilestones.length > 0);
  assert.ok(SERVICE_CONTRACT.acceptanceGates.length > 0);
  assert.ok(Object.isFrozen(SERVICE_CONTRACT));
});
