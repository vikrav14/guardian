'use strict';

const SNAPSHOT_STATE = Object.freeze({
  REQUESTED: 'requested',
  WAITING_FOR_DEVICE_ACCEPTANCE: 'waiting_for_device_acceptance',
  AVAILABLE: 'available',
  EXPIRED: 'expired',
  DELETED: 'deleted',
  REJECTED: 'rejected',
});

const DEFAULT_AUTH_MINUTES = 10;
const DEFAULT_RETENTION_HOURS = 24;
const DEFAULT_COOLDOWN_MINUTES = 15;

function asDate(value) {
  if (!value) return null;
  const date = value?.toDate?.() || (value instanceof Date ? value : new Date(value));
  return Number.isFinite(date?.getTime?.()) ? date : null;
}

function normalizePurpose(value) {
  const purpose = String(value || '').trim().replace(/\s+/g, ' ');
  if (purpose.length < 3 || purpose.length > 160) {
    throw new Error('purpose must contain 3-160 characters');
  }
  if (/[\u0000-\u001f\u007f]/.test(purpose)) {
    throw new Error('purpose contains unsupported control characters');
  }
  return purpose;
}

function buildSnapshotAuthorization(input, {
  now = new Date(),
  authorizationMinutes = DEFAULT_AUTH_MINUTES,
  retentionHours = DEFAULT_RETENTION_HOURS,
} = {}) {
  const imei = String(input?.imei || '').trim();
  const requestedBy = String(input?.requestedBy || '').trim();
  const serviceOwnerUid = String(input?.serviceOwnerUid || '').trim();
  if (!/^\d{15}$/.test(imei)) throw new Error('imei must be a 15-digit device identifier');
  if (!requestedBy || !serviceOwnerUid) throw new Error('requester and service owner are required');
  if (input?.consentConfirmed !== true) throw new Error('explicit household consent is required');
  if (input?.safetyPurposeConfirmed !== true) throw new Error('safety-purpose confirmation is required');

  const authMs = Math.max(1, Number(authorizationMinutes)) * 60_000;
  const retentionMs = Math.max(1, Number(retentionHours)) * 60 * 60_000;
  return Object.freeze({
    imei,
    requestedBy,
    serviceOwnerUid,
    purpose: normalizePurpose(input.purpose),
    consentConfirmed: true,
    safetyPurposeConfirmed: true,
    state: SNAPSHOT_STATE.WAITING_FOR_DEVICE_ACCEPTANCE,
    authorizationExpiresAt: new Date(now.getTime() + authMs),
    mediaExpiresAt: new Date(now.getTime() + retentionMs),
    deviceCommandSent: false,
    deviceCommand: null,
    mediaPath: null,
    publicUrl: null,
    createdAt: now,
    updatedAt: now,
  });
}

function assessCooldown(previousRequestedAt, {
  now = new Date(),
  cooldownMinutes = DEFAULT_COOLDOWN_MINUTES,
} = {}) {
  const previous = asDate(previousRequestedAt);
  if (!previous) return { allowed: true, retryAt: null };
  const retryAt = new Date(previous.getTime() + Math.max(1, Number(cooldownMinutes)) * 60_000);
  return now >= retryAt
    ? { allowed: true, retryAt: null }
    : { allowed: false, retryAt };
}

function canAcceptUpload(authorization, { now = new Date(), imei, requestId } = {}) {
  if (!authorization) return { allowed: false, reason: 'authorization_missing' };
  if (String(authorization.imei || '') !== String(imei || '')) {
    return { allowed: false, reason: 'device_mismatch' };
  }
  if (requestId && authorization.requestId && String(authorization.requestId) !== String(requestId)) {
    return { allowed: false, reason: 'request_mismatch' };
  }
  if (authorization.state === SNAPSHOT_STATE.DELETED || authorization.state === SNAPSHOT_STATE.EXPIRED) {
    return { allowed: false, reason: authorization.state };
  }
  const expires = asDate(authorization.authorizationExpiresAt);
  if (!expires || expires <= now) return { allowed: false, reason: 'authorization_expired' };
  return { allowed: true, reason: null };
}

function markSnapshotAvailable(authorization, media, { now = new Date() } = {}) {
  if (!media?.privatePath) throw new Error('private media path is required');
  if (media.publicUrl) throw new Error('public snapshot URLs are forbidden');
  return Object.freeze({
    ...authorization,
    state: SNAPSHOT_STATE.AVAILABLE,
    mediaPath: String(media.privatePath),
    contentType: String(media.contentType || ''),
    sizeBytes: Number(media.sizeBytes || 0),
    capturedAt: asDate(media.capturedAt) || now,
    publicUrl: null,
    updatedAt: now,
  });
}

function markSnapshotDeleted(authorization, { now = new Date(), reason = 'user_requested' } = {}) {
  return Object.freeze({
    ...authorization,
    state: SNAPSHOT_STATE.DELETED,
    mediaPath: null,
    publicUrl: null,
    deletedAt: now,
    deleteReason: String(reason || 'user_requested'),
    updatedAt: now,
  });
}

module.exports = {
  SNAPSHOT_STATE,
  DEFAULT_AUTH_MINUTES,
  DEFAULT_RETENTION_HOURS,
  DEFAULT_COOLDOWN_MINUTES,
  asDate,
  normalizePurpose,
  buildSnapshotAuthorization,
  assessCooldown,
  canAcceptUpload,
  markSnapshotAvailable,
  markSnapshotDeleted,
};
