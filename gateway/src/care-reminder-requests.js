'use strict';

const admin = require('firebase-admin');
const { evaluateSubscription } = require('./entitlements');
const { buildCareReminderSchedule } = require('./care-reminder-policy');

function normalizeAction(value) {
  const action = String(value || '').trim().toLowerCase();
  if (!['upsert', 'delete'].includes(action)) {
    throw new Error('action must be upsert or delete');
  }
  return action;
}

function assessCareReminderAccess({ requesterUid, user, owner, subscription, imei, now = new Date() }) {
  const uid = String(requesterUid || '');
  const ownerUid = String(user?.serviceOwnerUid || uid);
  if (!uid || !ownerUid) return { ok: false, reason: 'missing_identity' };

  const linkedImeis = Array.isArray(user?.linkedImeis) ? user.linkedImeis.map(String) : [];
  if (!linkedImeis.includes(String(imei || ''))) {
    return { ok: false, reason: 'device_not_linked' };
  }

  if (ownerUid !== uid) {
    const members = Array.isArray(owner?.memberUids) ? owner.memberUids.map(String) : [];
    if (!members.includes(uid)) return { ok: false, reason: 'family_membership_not_verified' };
  }

  const entitlements = evaluateSubscription(subscription || {}, { now, ownerUid });
  if (!entitlements.serviceActive) return { ok: false, reason: entitlements.reason || 'service_inactive' };
  if (entitlements.plan !== 'care') return { ok: false, reason: 'care_plan_required' };
  return { ok: true, ownerUid };
}

async function processCareReminderRequest(db, requestId, { now = new Date() } = {}) {
  if (!db || !requestId) return { ok: false, reason: 'missing_request' };
  const requestRef = db.collection('careReminderRequests').doc(requestId);

  return db.runTransaction(async (tx) => {
    const requestSnap = await tx.get(requestRef);
    if (!requestSnap.exists) return { ok: false, reason: 'request_not_found' };
    const request = requestSnap.data() || {};
    if (request.status !== 'pending') return { ok: false, reason: 'request_not_pending' };

    let action;
    try {
      action = normalizeAction(request.action);
    } catch (error) {
      tx.set(requestRef, {
        status: 'rejected',
        reason: 'invalid_action',
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      return { ok: false, reason: 'invalid_action' };
    }

    const requesterUid = String(request.requestedBy || '');
    const imei = String(request.imei || '');
    const userRef = db.collection('users').doc(requesterUid);
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) {
      tx.set(requestRef, {
        status: 'rejected', reason: 'user_not_found',
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      return { ok: false, reason: 'user_not_found' };
    }

    const user = userSnap.data() || {};
    const ownerUid = String(user.serviceOwnerUid || requesterUid);
    const ownerRef = db.collection('users').doc(ownerUid);
    const subscriptionRef = db.collection('serviceSubscriptions').doc(ownerUid);
    const ownerSnap = ownerUid === requesterUid ? userSnap : await tx.get(ownerRef);
    const subscriptionSnap = await tx.get(subscriptionRef);
    const access = assessCareReminderAccess({
      requesterUid,
      user,
      owner: ownerSnap.exists ? ownerSnap.data() || {} : null,
      subscription: subscriptionSnap.exists ? subscriptionSnap.data() || {} : null,
      imei,
      now,
    });
    if (!access.ok) {
      tx.set(requestRef, {
        status: 'rejected', reason: access.reason,
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      return access;
    }

    const scheduleId = String(request.scheduleId || requestId).trim();
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(scheduleId)) {
      tx.set(requestRef, {
        status: 'rejected', reason: 'invalid_schedule_id',
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      return { ok: false, reason: 'invalid_schedule_id' };
    }

    const scheduleRef = db.collection('careReminderSchedules').doc(scheduleId);
    const auditRef = db.collection('careReminderAudit').doc(requestId);
    const timestamp = admin.firestore.FieldValue.serverTimestamp();

    if (action === 'delete') {
      const existing = await tx.get(scheduleRef);
      if (existing.exists && String(existing.data()?.imei || '') !== imei) {
        tx.set(requestRef, {
          status: 'rejected', reason: 'schedule_device_mismatch', processedAt: timestamp,
        }, { merge: true });
        return { ok: false, reason: 'schedule_device_mismatch' };
      }
      if (existing.exists) tx.delete(scheduleRef);
      tx.set(auditRef, {
        requestId,
        action,
        scheduleId,
        imei,
        requestedBy: requesterUid,
        serviceOwnerUid: access.ownerUid,
        outcome: 'accepted_backend_only',
        deviceCommandSent: false,
        createdAt: timestamp,
      });
      tx.set(requestRef, { status: 'accepted', processedAt: timestamp }, { merge: true });
      return { ok: true, action, scheduleId, deviceCommandSent: false };
    }

    let schedule;
    try {
      schedule = buildCareReminderSchedule({ ...(request.schedule || {}), imei }, { now });
    } catch (error) {
      tx.set(requestRef, {
        status: 'rejected', reason: 'invalid_schedule',
        validationMessage: String(error.message || 'invalid_schedule').slice(0, 160),
        processedAt: timestamp,
      }, { merge: true });
      return { ok: false, reason: 'invalid_schedule' };
    }

    tx.set(scheduleRef, {
      ...schedule,
      scheduleId,
      serviceOwnerUid: access.ownerUid,
      lastChangedBy: requesterUid,
      createdAt: timestamp,
      updatedAt: timestamp,
    }, { merge: true });
    tx.set(auditRef, {
      requestId,
      action,
      scheduleId,
      imei,
      requestedBy: requesterUid,
      serviceOwnerUid: access.ownerUid,
      outcome: 'accepted_backend_only',
      deviceCommandSent: false,
      schedule: {
        kind: schedule.kind,
        label: schedule.label,
        localTime: schedule.localTime,
        weekdays: schedule.weekdays,
        enabled: schedule.enabled,
      },
      createdAt: timestamp,
    });
    tx.set(requestRef, {
      status: 'accepted', scheduleId, processedAt: timestamp,
    }, { merge: true });
    return { ok: true, action, scheduleId, deviceCommandSent: false };
  });
}

module.exports = {
  normalizeAction,
  assessCareReminderAccess,
  processCareReminderRequest,
};
