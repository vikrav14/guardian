const crypto = require('crypto');

const PENDING_TTL_SECONDS = 600;
const ACTION_STATUS = Object.freeze({
  AWAITING: 'awaiting_confirmation', EXECUTING: 'executing', QUEUED: 'queued',
  ACKNOWLEDGED: 'acknowledged', FAILED: 'failed', TIMED_OUT: 'timed_out',
  CANCELLED: 'cancelled', EXPIRED: 'expired', SUPERSEDED: 'superseded',
});

function actionKey({ callerUid, targetImei, actionType, parameters }) {
  return crypto.createHash('sha256')
    .update(JSON.stringify({ callerUid, targetImei, actionType, parameters: parameters || {} }))
    .digest('hex');
}

function asDate(value) {
  if (!value) return null;
  return value?.toDate?.() || (value instanceof Date ? value : new Date(value));
}

async function getPendingAction(db, callerUid, now = new Date()) {
  if (!db || !callerUid) return null;
  const snap = await db.collection('pending_actions')
    .where('callerUid', '==', callerUid)
    .limit(20).get();
  const candidates = snap.docs
    .filter((doc) => doc.data()?.status === ACTION_STATUS.AWAITING)
    .sort((a, b) => (asDate(b.data()?.createdAt)?.getTime() || 0) - (asDate(a.data()?.createdAt)?.getTime() || 0));
  if (candidates.length === 0) return null;
  const doc = candidates[0];
  const data = doc.data() || {};
  const expiresAt = asDate(data.expiresAt);
  if (!expiresAt || expiresAt <= now) {
    await doc.ref.update({ status: ACTION_STATUS.EXPIRED, expiredAt: now });
    return null;
  }
  return { id: doc.id, ref: doc.ref, ...data, createdAt: asDate(data.createdAt), expiresAt };
}

async function storePendingAction(db, callerUid, action, { now = new Date() } = {}) {
  if (!db || !callerUid) throw new Error('Authenticated caller is required.');
  const targetImei = String(action.targetImei || '');
  const actionType = String(action.actionType || '');
  if (!targetImei || !actionType) throw new Error('Action target and type are required.');
  const previous = await getPendingAction(db, callerUid, now);
  if (previous) await previous.ref.update({ status: ACTION_STATUS.SUPERSEDED, supersededAt: now });
  const parameters = action.parameters || {};
  const idempotencyKey = actionKey({ callerUid, targetImei, actionType, parameters });
  const ref = db.collection('pending_actions').doc();
  const expiresAt = new Date(now.getTime() + PENDING_TTL_SECONDS * 1000);
  await ref.set({
    callerUid, targetImei, wearerName: action.wearerName || null, actionType,
    parameters, status: ACTION_STATUS.AWAITING, idempotencyKey,
    createdAt: now, expiresAt,
  });
  return { id: ref.id, idempotencyKey, expiresAt };
}

async function claimPendingAction(db, pending, callerUid, linkedImeis, { now = new Date() } = {}) {
  if (!pending || pending.callerUid !== callerUid) return { ok: false, reason: 'caller_mismatch' };
  if (!linkedImeis.includes(pending.targetImei)) return { ok: false, reason: 'target_not_authorised' };
  if (!pending.expiresAt || pending.expiresAt <= now) {
    await pending.ref.update({ status: ACTION_STATUS.EXPIRED, expiredAt: now });
    return { ok: false, reason: 'expired' };
  }
  if (typeof db.runTransaction === 'function') {
    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(pending.ref);
      const data = snapshot.data() || {};
      if (data.status !== ACTION_STATUS.AWAITING) return { ok: false, reason: 'already_claimed' };
      transaction.update(pending.ref, { status: ACTION_STATUS.EXECUTING, confirmedAt: now });
      return { ok: true, action: { id: pending.id, ...data } };
    });
  }
  await pending.ref.update({ status: ACTION_STATUS.EXECUTING, confirmedAt: now });
  return { ok: true, action: pending };
}

async function setActionOutcome(db, actionId, status, details = {}, now = new Date()) {
  if (!Object.values(ACTION_STATUS).includes(status)) throw new Error(`Invalid action status: ${status}`);
  await db.collection('pending_actions').doc(actionId).update({ status, outcomeAt: now, ...details });
}

async function cancelPendingAction(db, callerUid, { now = new Date() } = {}) {
  const pending = await getPendingAction(db, callerUid, now);
  if (!pending) return null;
  await pending.ref.update({ status: ACTION_STATUS.CANCELLED, cancelledAt: now });
  return pending;
}

async function removePendingAction(db, actionId) {
  await setActionOutcome(db, actionId, ACTION_STATUS.CANCELLED, { legacyRemoval: true });
}

async function cleanupExpiredActions(db, now = new Date()) {
  const snap = await db.collection('pending_actions')
    .where('status', '==', ACTION_STATUS.AWAITING).limit(100).get();
  const expired = snap.docs.filter((doc) => {
    const expiresAt = asDate(doc.data()?.expiresAt);
    return expiresAt && expiresAt <= now;
  });
  for (const doc of expired) await doc.ref.update({ status: ACTION_STATUS.EXPIRED, expiredAt: now });
  return expired.length;
}

module.exports = {
  PENDING_TTL_SECONDS, ACTION_STATUS, actionKey, storePendingAction,
  getPendingAction, claimPendingAction, setActionOutcome, cancelPendingAction,
  removePendingAction, cleanupExpiredActions,
};
