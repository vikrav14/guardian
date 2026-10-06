'use strict';

const admin = require('firebase-admin');
const { evaluateSubscription } = require('./entitlements');
const {
  buildSnapshotAuthorization,
  assessCooldown,
  SNAPSHOT_STATE,
} = require('./safety-snapshot-policy');

let requestWatchUnsub = null;

function assessSnapshotAccess({ requesterUid, user, owner, subscription, imei, now = new Date() }) {
  const uid = String(requesterUid || '');
  const ownerUid = String(user?.serviceOwnerUid || uid);
  if (!uid || !ownerUid) return { ok: false, reason: 'missing_identity' };

  const linkedImeis = Array.isArray(user?.linkedImeis) ? user.linkedImeis.map(String) : [];
  if (!linkedImeis.includes(String(imei || ''))) return { ok: false, reason: 'device_not_linked' };

  if (ownerUid !== uid) {
    const members = Array.isArray(owner?.memberUids) ? owner.memberUids.map(String) : [];
    if (!members.includes(uid)) return { ok: false, reason: 'family_membership_not_verified' };
  }

  const entitlements = evaluateSubscription(subscription || {}, { now, ownerUid });
  if (!entitlements.serviceActive) return { ok: false, reason: entitlements.reason || 'service_inactive' };
  if (!['family', 'care'].includes(entitlements.plan)) return { ok: false, reason: 'family_plan_required' };
  return { ok: true, ownerUid, plan: entitlements.plan };
}

async function processSnapshotRequest(db, requestId, { now = new Date(), cooldownMinutes = 15 } = {}) {
  if (!db || !requestId) return { ok: false, reason: 'missing_request' };
  const requestRef = db.collection('safetySnapshotRequests').doc(requestId);

  return db.runTransaction(async (tx) => {
    const requestSnap = await tx.get(requestRef);
    if (!requestSnap.exists) return { ok: false, reason: 'request_not_found' };
    const request = requestSnap.data() || {};
    if (request.status !== 'pending') return { ok: false, reason: 'request_not_pending' };

    const requesterUid = String(request.requestedBy || '');
    const imei = String(request.imei || '');
    const userRef = db.collection('users').doc(requesterUid);
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) {
      tx.set(requestRef, { status: 'rejected', reason: 'user_not_found', processedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      return { ok: false, reason: 'user_not_found' };
    }

    const user = userSnap.data() || {};
    const ownerUid = String(user.serviceOwnerUid || requesterUid);
    const ownerRef = db.collection('users').doc(ownerUid);
    const subscriptionRef = db.collection('serviceSubscriptions').doc(ownerUid);
    const ownerSnap = ownerUid === requesterUid ? userSnap : await tx.get(ownerRef);
    const subscriptionSnap = await tx.get(subscriptionRef);
    const access = assessSnapshotAccess({ requesterUid, user, owner: ownerSnap.exists ? ownerSnap.data() || {} : null, subscription: subscriptionSnap.exists ? subscriptionSnap.data() || {} : null, imei, now });
    if (!access.ok) {
      tx.set(requestRef, { status: 'rejected', reason: access.reason, processedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      return access;
    }

    const recentQuery = db.collection('safetySnapshotAuthorizations')
      .where('imei', '==', imei)
      .where('serviceOwnerUid', '==', access.ownerUid)
      .orderBy('createdAt', 'desc')
      .limit(1);
    const recentSnap = await tx.get(recentQuery);
    const previousRequestedAt = recentSnap.empty ? null : recentSnap.docs[0].data()?.createdAt;
    const cooldown = assessCooldown(previousRequestedAt, { now, cooldownMinutes });
    if (!cooldown.allowed) {
      tx.set(requestRef, { status: 'rejected', reason: 'cooldown_active', retryAt: cooldown.retryAt, processedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      return { ok: false, reason: 'cooldown_active', retryAt: cooldown.retryAt };
    }

    let authorization;
    try {
      authorization = buildSnapshotAuthorization({
        imei,
        requestedBy: requesterUid,
        serviceOwnerUid: access.ownerUid,
        purpose: request.purpose,
        consentConfirmed: request.consentConfirmed,
        safetyPurposeConfirmed: request.safetyPurposeConfirmed,
      }, { now });
    } catch (error) {
      tx.set(requestRef, { status: 'rejected', reason: 'invalid_request', validationMessage: String(error.message || 'invalid_request').slice(0, 160), processedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      return { ok: false, reason: 'invalid_request' };
    }

    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    const authRef = db.collection('safetySnapshotAuthorizations').doc(requestId);
    const auditRef = db.collection('safetySnapshotAudit').doc(requestId);
    tx.set(authRef, {
      ...authorization,
      requestId,
      state: SNAPSHOT_STATE.WAITING_FOR_DEVICE_ACCEPTANCE,
      deviceCommandSent: false,
      deviceCommand: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    tx.set(auditRef, {
      requestId,
      imei,
      requestedBy: requesterUid,
      serviceOwnerUid: access.ownerUid,
      purpose: authorization.purpose,
      consentConfirmed: true,
      safetyPurposeConfirmed: true,
      outcome: 'accepted_backend_only',
      deviceCommandSent: false,
      createdAt: timestamp,
    });
    tx.set(requestRef, { status: 'accepted_backend_only', authorizationId: requestId, processedAt: timestamp }, { merge: true });

    return { ok: true, requestId, authorizationId: requestId, state: SNAPSHOT_STATE.WAITING_FOR_DEVICE_ACCEPTANCE, deviceCommandSent: false };
  });
}

function startPendingSnapshotRequestWatcher(db) {
  if (!db || requestWatchUnsub) return;
  requestWatchUnsub = db.collection('safetySnapshotRequests').where('status', '==', 'pending').onSnapshot(
    (snap) => {
      snap.docChanges().forEach((change) => {
        if (change.type !== 'added' && change.type !== 'modified') return;
        if ((change.doc.data() || {}).status !== 'pending') return;
        processSnapshotRequest(db, change.doc.id)
          .then((result) => console.log(`[safety-snapshot] request ${change.doc.id} ${result.ok ? 'accepted_backend_only' : result.reason}`))
          .catch((error) => console.error('[safety-snapshot] request watcher error', error.message));
      });
    },
    (error) => console.error('[safety-snapshot] request watcher failed', error.message),
  );
  console.log('[safety-snapshot] watching pending requests (backend-only; no device dispatch)');
}

function stopPendingSnapshotRequestWatcher() {
  if (!requestWatchUnsub) return;
  requestWatchUnsub();
  requestWatchUnsub = null;
}

module.exports = {
  assessSnapshotAccess,
  processSnapshotRequest,
  startPendingSnapshotRequestWatcher,
  stopPendingSnapshotRequestWatcher,
};
