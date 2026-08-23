'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SNAPSHOT_STATE,
  buildSnapshotAuthorization,
  assessCooldown,
  canAcceptUpload,
  markSnapshotAvailable,
  markSnapshotDeleted,
} = require('../src/safety-snapshot-policy');

const now = new Date('2026-08-23T19:00:00.000Z');
const imei = '999999999999999';

function validInput() {
  return {
    imei,
    requestedBy: 'guardian-1',
    serviceOwnerUid: 'owner-1',
    purpose: 'Check the immediate surroundings after a safety concern.',
    consentConfirmed: true,
    safetyPurposeConfirmed: true,
  };
}

test('authorization is one-device, short-lived and never dispatches a command', () => {
  const auth = buildSnapshotAuthorization(validInput(), { now });
  assert.equal(auth.state, SNAPSHOT_STATE.WAITING_FOR_DEVICE_ACCEPTANCE);
  assert.equal(auth.deviceCommandSent, false);
  assert.equal(auth.deviceCommand, null);
  assert.equal(auth.publicUrl, null);
  assert.equal(auth.authorizationExpiresAt.toISOString(), '2026-08-23T19:10:00.000Z');
});

test('explicit consent and safety-purpose confirmation are mandatory', () => {
  assert.throws(
    () => buildSnapshotAuthorization({ ...validInput(), consentConfirmed: false }, { now }),
    /consent/i,
  );
  assert.throws(
    () => buildSnapshotAuthorization({ ...validInput(), safetyPurposeConfirmed: false }, { now }),
    /safety-purpose/i,
  );
});

test('cooldown prevents repeated snapshot requests', () => {
  const result = assessCooldown(new Date('2026-08-23T18:55:00.000Z'), { now });
  assert.equal(result.allowed, false);
  assert.equal(result.retryAt.toISOString(), '2026-08-23T19:10:00.000Z');
});

test('upload must match device and unexpired authorization', () => {
  const auth = { ...buildSnapshotAuthorization(validInput(), { now }), requestId: 'req-1' };
  assert.deepEqual(canAcceptUpload(auth, { now, imei, requestId: 'req-1' }), {
    allowed: true,
    reason: null,
  });
  assert.equal(canAcceptUpload(auth, { now, imei: '888888888888888', requestId: 'req-1' }).reason, 'device_mismatch');
  assert.equal(canAcceptUpload(auth, { now: new Date('2026-08-23T19:11:00.000Z'), imei, requestId: 'req-1' }).reason, 'authorization_expired');
});

test('accepted media must remain private and deletion clears the media path', () => {
  const auth = buildSnapshotAuthorization(validInput(), { now });
  assert.throws(
    () => markSnapshotAvailable(auth, { privatePath: 'private/a.jpg', publicUrl: 'https://example.test/a.jpg' }, { now }),
    /public/i,
  );
  const available = markSnapshotAvailable(auth, {
    privatePath: 'safetySnapshots/owner-1/request-1/photo.jpg',
    contentType: 'image/jpeg',
    sizeBytes: 12345,
  }, { now });
  assert.equal(available.state, SNAPSHOT_STATE.AVAILABLE);
  assert.equal(available.publicUrl, null);

  const deleted = markSnapshotDeleted(available, { now });
  assert.equal(deleted.state, SNAPSHOT_STATE.DELETED);
  assert.equal(deleted.mediaPath, null);
  assert.equal(deleted.publicUrl, null);
});
