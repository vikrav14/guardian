'use strict';
const { loadEntitlementsForUser } = require('./entitlements');
class VoiceError extends Error {
  constructor(code, status = 409) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
function voiceRuntime(env = process.env) {
  const imei = env.VOICE_MESSAGES_PILOT_IMEI || '',
    uid = env.VOICE_MESSAGES_PILOT_UID || '';
  return {
    imei,
    uid,
    enabled:
      env.VOICE_MESSAGES_ENABLED === 'true' &&
      /^\d{15}$/.test(imei) &&
      /^[^/\s]{1,128}$/.test(uid),
  };
}
async function authorizeVoice({ db, uid, imei, runtime, now = new Date() }) {
  if (!runtime.enabled || runtime.imei !== imei || runtime.uid !== uid)
    throw new VoiceError('feature_unavailable', 403);
  const snap = await db.collection('users').doc(uid).get(),
    user = { ...snap.data(), uid };
  if (!snap.exists || !user.linkedImeis?.includes(imei))
    throw new VoiceError('device_not_linked', 403);
  const access = await loadEntitlementsForUser(db, user, { now });
  if (!access.serviceActive || !['family', 'care'].includes(access.plan))
    throw new VoiceError('active_service_required', 403);
  return { imei, uid, ownerUid: access.ownerUid };
}
function sendRequest(value, now = Date.now()) {
  if (
    !value ||
    Object.keys(value).sort().join(',') !== 'createdAt,id,pcm' ||
    !UUID.test(value.id || '') ||
    !Number.isSafeInteger(value.createdAt) ||
    value.createdAt < now - 90000 ||
    value.createdAt > now + 30000 ||
    typeof value.pcm !== 'string' ||
    value.pcm.length > 640000 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value.pcm,
    )
  )
    throw new VoiceError('invalid_or_expired_request', 400);
  return value;
}
const RETENTION_MS = 86400000;
function publicMessage(row, uid, now = Date.now()) {
  const expired = row.expiresAtMs <= now || !!row.deletedAtMs;
  return {
    id: row.id,
    direction: row.direction,
    createdAt: row.createdAtMs,
    expiresAt: row.expiresAtMs,
    durationMs: row.durationMs,
    status: expired
      ? 'expired'
      : ['preparing', 'sending'].includes(row.status) &&
          row.dispatchUntilMs <= now
        ? 'unconfirmed'
        : row.status,
    played: row.playedBy?.includes(uid) === true,
    reason: row.reason || null,
  };
}
module.exports = {
  VoiceError,
  UUID,
  voiceRuntime,
  authorizeVoice,
  sendRequest,
  publicMessage,
  RETENTION_MS,
};
