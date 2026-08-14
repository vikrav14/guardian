const test = require('node:test');
const assert = require('node:assert/strict');

const {
  assessFamilyJoin,
  familyMemberEntry,
  uniqueStrings,
  upsertFamilyMember,
} = require('../src/family-membership');

const NOW = new Date('2026-08-14T00:00:00Z');
const FUTURE = new Date('2026-08-15T00:00:00Z');

test('Essential admits exactly one verified caregiver', () => {
  const accepted = assessFamilyJoin({
    requesterUid: 'member-1',
    ownerUid: 'owner',
    memberUids: [],
    caregiverLimit: 1,
    inviteStatus: 'pending',
    expiresAt: FUTURE,
    now: NOW,
  });
  const rejected = assessFamilyJoin({
    requesterUid: 'member-2',
    ownerUid: 'owner',
    memberUids: ['member-1'],
    caregiverLimit: 1,
    inviteStatus: 'pending',
    expiresAt: FUTURE,
    now: NOW,
  });

  assert.deepEqual(accepted.members, ['member-1']);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.reason, 'caregiver_limit_reached');
});

test('Family and Care admit up to five unique caregivers', () => {
  const result = assessFamilyJoin({
    requesterUid: 'member-5',
    ownerUid: 'owner',
    memberUids: ['member-1', 'member-2', 'member-3', 'member-4'],
    caregiverLimit: 5,
    inviteStatus: 'pending',
    expiresAt: FUTURE,
    now: NOW,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.members, [
    'member-1',
    'member-2',
    'member-3',
    'member-4',
    'member-5',
  ]);
});

test('expired, consumed, self and inactive joins fail closed', () => {
  const base = {
    requesterUid: 'member',
    ownerUid: 'owner',
    memberUids: [],
    caregiverLimit: 5,
    inviteStatus: 'pending',
    expiresAt: FUTURE,
    now: NOW,
  };
  assert.equal(
    assessFamilyJoin({ ...base, expiresAt: NOW }).reason,
    'invite_expired',
  );
  assert.equal(
    assessFamilyJoin({ ...base, inviteStatus: 'accepted' }).reason,
    'invite_not_pending',
  );
  assert.equal(
    assessFamilyJoin({ ...base, requesterUid: 'owner' }).reason,
    'cannot_join_own_family',
  );
  assert.equal(
    assessFamilyJoin({ ...base, caregiverLimit: 0 }).reason,
    'service_inactive',
  );
});

test('an existing verified member is idempotent even at the limit', () => {
  const result = assessFamilyJoin({
    requesterUid: 'member',
    ownerUid: 'owner',
    memberUids: ['member'],
    caregiverLimit: 1,
    inviteStatus: 'pending',
    expiresAt: FUTURE,
    now: NOW,
  });

  assert.equal(result.ok, true);
  assert.equal(result.alreadyMember, true);
  assert.deepEqual(result.members, ['member']);
});

test('family display entries are deterministic and deduplicated', () => {
  const next = familyMemberEntry('member', {
    displayName: 'Maya',
    email: 'maya@example.test',
  });
  const list = upsertFamilyMember([
    { uid: 'member', displayName: 'Old name' },
  ], next);

  assert.deepEqual(list, [
    { uid: 'member', displayName: 'Maya', email: 'maya@example.test' },
  ]);
  assert.deepEqual(uniqueStrings(['a', 'a', 2]), ['a', '2']);
});
