const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SERVICE_CONTRACT,
} = require('../src/service-backbones/care-wellbeing');

test('care-wellbeing is a disabled-by-default Care estimate service', () => {
  assert.equal(SERVICE_CONTRACT.lifecycle, 'customer_estimate');
  assert.equal(SERVICE_CONTRACT.enabledByDefault, false);
  assert.equal(SERVICE_CONTRACT.customerVisible, true);
  assert.equal(SERVICE_CONTRACT.minimumPlan, 'care');
  assert.ok(SERVICE_CONTRACT.protocolCommands.length > 0);
  assert.deepEqual(SERVICE_CONTRACT.acceptedUploads, ['bphrt', 'oxygen', 'btemp2']);
  assert.deepEqual(SERVICE_CONTRACT.blockedUntilCaptured, ['BTTIMESET']);
  assert.deepEqual(SERVICE_CONTRACT.pilotOnlyRequests, []);
  assert.ok(SERVICE_CONTRACT.backendMilestones.length > 0);
  assert.ok(SERVICE_CONTRACT.frontendMilestones.length > 0);
  assert.ok(SERVICE_CONTRACT.acceptanceGates.length > 0);
  assert.ok(Object.isFrozen(SERVICE_CONTRACT));
});
