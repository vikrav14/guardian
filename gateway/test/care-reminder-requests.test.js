'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeAction,
  assessCareReminderAccess,
} = require('../src/care-reminder-requests');

const activeCare = {
  version: 1,
  managedBy: 'guardian_admin',
  plan: 'care',
  status: 'active',
};

const activeFamily = {
  version: 1,
  managedBy: 'guardian_admin',
  plan: 'family',
  status: 'active',
};

test('only upsert and delete actions are accepted', () => {
  assert.equal(normalizeAction('upsert'), 'upsert');
  assert.equal(normalizeAction('DELETE'), 'delete');
  assert.throws(() => normalizeAction('send-now'), /upsert or delete/);
});

test('Care owner with linked device may create backend-only reminder', () => {
  const result = assessCareReminderAccess({
    requesterUid: 'owner-1',
    user: { linkedImeis: ['861397012345670'] },
    owner: { memberUids: [] },
    subscription: activeCare,
    imei: '861397012345670',
  });
  assert.deepEqual(result, { ok: true, ownerUid: 'owner-1' });
});

test('Family plan and unlinked device fail closed', () => {
  const family = assessCareReminderAccess({
    requesterUid: 'owner-1',
    user: { linkedImeis: ['861397012345670'] },
    subscription: activeFamily,
    imei: '861397012345670',
  });
  assert.deepEqual(family, { ok: false, reason: 'care_plan_required' });

  const unlinked = assessCareReminderAccess({
    requesterUid: 'owner-1',
    user: { linkedImeis: [] },
    subscription: activeCare,
    imei: '861397012345670',
  });
  assert.deepEqual(unlinked, { ok: false, reason: 'device_not_linked' });
});

test('inherited Care access requires backend-verified memberUids', () => {
  const allowed = assessCareReminderAccess({
    requesterUid: 'member-1',
    user: {
      serviceOwnerUid: 'owner-1',
      linkedImeis: ['861397012345670'],
    },
    owner: { memberUids: ['member-1'] },
    subscription: activeCare,
    imei: '861397012345670',
  });
  assert.deepEqual(allowed, { ok: true, ownerUid: 'owner-1' });

  const denied = assessCareReminderAccess({
    requesterUid: 'member-1',
    user: {
      serviceOwnerUid: 'owner-1',
      linkedImeis: ['861397012345670'],
    },
    owner: { memberUids: [] },
    subscription: activeCare,
    imei: '861397012345670',
  });
  assert.deepEqual(denied, {
    ok: false,
    reason: 'family_membership_not_verified',
  });
});
