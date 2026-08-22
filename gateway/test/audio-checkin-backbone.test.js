const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SERVICE_CONTRACT,
} = require('../src/service-backbones/audio-checkin');

test('audio-checkin remains a disabled service backbone', () => {
  assert.equal(SERVICE_CONTRACT.lifecycle, 'backbone');
  assert.equal(SERVICE_CONTRACT.enabledByDefault, false);
  assert.equal(SERVICE_CONTRACT.customerVisible, false);
  assert.equal(SERVICE_CONTRACT.minimumPlan, 'family');
  assert.ok(SERVICE_CONTRACT.protocolCommands.length > 0);
  assert.deepEqual(SERVICE_CONTRACT.documentedProtocolVariants, [
    'MONITOR',
    'MONITOR,<verified callback>',
  ]);
  assert.equal(SERVICE_CONTRACT.protocolEvidence, 'vendor-conflict-unproven');
  assert.ok(SERVICE_CONTRACT.backendMilestones.length > 0);
  assert.ok(SERVICE_CONTRACT.frontendMilestones.length > 0);
  assert.ok(SERVICE_CONTRACT.acceptanceGates.length > 0);
  assert.ok(Object.isFrozen(SERVICE_CONTRACT));
});
