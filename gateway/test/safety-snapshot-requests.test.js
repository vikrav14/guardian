'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { assessSnapshotAccess } = require('../src/safety-snapshot-requests');

const imei = '999999999999999';
const active = (plan) => ({
  version: 1,
  managedBy: 'guardian_admin',
  plan,
  status: 'active',
});

test('Family and Care linked users are eligible for snapshot requests', () => {
  for (const plan of ['family', 'care']) {
    const result = assessSnapshotAccess({
      requesterUid: 'owner',
      user: { linkedImeis: [imei] },
      owner: { memberUids: [] },
      subscription: active(plan),
      imei,
    });
    assert.equal(result.ok, true);
    assert.equal(result.plan, plan);
  }
});

test('Essential is rejected and an unlinked Family user is rejected', () => {
  const essential = assessSnapshotAccess({
    requesterUid: 'owner',
    user: { linkedImeis: [imei] },
    owner: {},
    subscription: active('essential'),
    imei,
  });
  assert.deepEqual(essential, { ok: false, reason: 'family_plan_required' });

  const unlinked = assessSnapshotAccess({
    requesterUid: 'owner',
    user: { linkedImeis: [] },
    owner: {},
    subscription: active('family'),
    imei,
  });
  assert.deepEqual(unlinked, { ok: false, reason: 'device_not_linked' });
});

test('inherited family access requires backend-managed memberUids', () => {
  const rejected = assessSnapshotAccess({
    requesterUid: 'member',
    user: { serviceOwnerUid: 'owner', linkedImeis: [imei] },
    owner: { familyMembers: [{ uid: 'member' }] },
    subscription: active('family'),
    imei,
  });
  assert.deepEqual(rejected, { ok: false, reason: 'family_membership_not_verified' });

  const accepted = assessSnapshotAccess({
    requesterUid: 'member',
    user: { serviceOwnerUid: 'owner', linkedImeis: [imei] },
    owner: { memberUids: ['member'] },
    subscription: active('family'),
    imei,
  });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.ownerUid, 'owner');
});
