const test = require('node:test');
const assert = require('node:assert/strict');
const { subscriptionPatch } = require('../scripts/set-service-subscription');

test('admin subscription patch writes the trusted versioned contract', () => {
  const patch = subscriptionPatch({ plan: 'care', status: 'active', until: null });
  assert.equal(patch.version, 1);
  assert.equal(patch.managedBy, 'guardian_admin');
  assert.equal(patch.plan, 'care');
  assert.equal(patch.status, 'active');
});

test('bounded statuses use the correct expiry field', () => {
  const until = new Date('2026-09-01T00:00:00Z');
  assert.equal(subscriptionPatch({ plan: 'family', status: 'trialing', until }).trialEndsAt, until);
  assert.equal(subscriptionPatch({ plan: 'family', status: 'past_due', until }).graceEndsAt, until);
  assert.equal(subscriptionPatch({ plan: 'family', status: 'cancelled', until }).currentPeriodEnd, until);
});
