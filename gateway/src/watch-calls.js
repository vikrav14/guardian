'use strict';

const { prepareCapturedAnswerTrial } = require('./captured-answer-mode-trial');
const { sendWatchCallWithReplies } = require('./watch-call-transport');
const { evaluateSubscription, verifiedFamilyMember } = require('./entitlements');
const { randomUUID } = require('node:crypto');

const LEASE_MS = 30_000;
const REQUEST_KEYS = ['imei', 'mode', 'requestedBy', 'createdAt', 'expiresAt', 'status', 'consentAccepted', 'policyRevision'];
const milliseconds = value => value?.toMillis?.() ?? (value instanceof Date ? value.getTime() : NaN);
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) && !/[\r\n]/.test(value);

function requestError(request, now) {
  if (!request || Object.keys(request).some(key => !REQUEST_KEYS.includes(key)) ||
      typeof request.imei !== 'string' || !/^\d{15}$/.test(request.imei) || request.imei.length !== 15 ||
      !validId(request.requestedBy) || !validId(request.policyRevision) || !['auto', 'manual'].includes(request.mode) ||
      request.consentAccepted !== (request.mode === 'auto')) return 'invalid_request';
  const created = milliseconds(request.createdAt), expiry = milliseconds(request.expiresAt);
  if (!Number.isFinite(created) || !Number.isFinite(expiry) || created > now + 5000 || expiry > created + 90_000) return 'invalid_request';
  if (expiry <= now || created < now - 90_000) return 'expired';
  return null;
}

/** Trusted operator setup. No watch command, phonebook change or mode change. */
async function configureWatchCalls(db, { imei, capture, autoEnabled = true }) {
  const prepared = prepareCapturedAnswerTrial({ imei, mode: 'auto', capture });
  const number = prepared.bytes.toString('ascii').match(/ACALL,(00\d{11})\]$/)[1];
  const policyRef = db.collection('watchCallPolicies').doc(imei);
  const stateRef = db.collection('watchCallSettings').doc(imei);
  const revision = randomUUID();
  await db.runTransaction(async tx => {
    const device = await tx.get(db.collection('devices').doc(imei));
    const state = (await tx.get(stateRef)).data() || {};
    if (!device.exists || device.data().protocolId !== prepared.metadata.protocolId) throw new Error('device_identity_mismatch');
    if (milliseconds(state.leaseUntil) > Date.now()) throw new Error('change_in_progress');
    tx.set(policyRef, { version: 1, managedBy: 'guardian_admin', protocolId: prepared.metadata.protocolId,
      revision, autoEnabled: autoEnabled === true, capture, updatedAt: new Date() });
    tx.set(stateRef, { configured: true, autoAvailable: autoEnabled === true,
      policyRevision: revision, callerHint: `Guardian number ending ${number.slice(-4)}`, updatedAt: new Date() }, { merge: true });
  });
  return { configured: true, autoAvailable: autoEnabled === true, protocolId: prepared.metadata.protocolId, watchCommandSent: false };
}

/**
 * Immutable, short-lived app requests. A transactional lease serializes a
 * device across gateway instances. Claimed requests are never replayed after
 * a crash, and a socket handoff is never promoted to physical confirmation.
 */
async function processWatchCallRequest(db, requestId, { now = Date.now, send = sendWatchCallWithReplies } = {}) {
  if (!db || !validId(requestId)) return { outcome: 'invalid_request' };
  const ref = db.collection('watchCallRequests').doc(requestId);
  const claim = await db.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    const request = snapshot.data();
    if (!request || request.status !== 'pending') return null;
    const clock = now();
    const reject = reason => {
      tx.update(ref, { status: 'not_sent', reason, completedAt: new Date(clock) });
      return { rejected: true, reason };
    };
    const error = requestError(request, clock);
    if (error) return reject(error);
    const policy = (await tx.get(db.collection('watchCallPolicies').doc(request.imei))).data();
    const user = (await tx.get(db.collection('users').doc(request.requestedBy))).data();
    const stateRef = db.collection('watchCallSettings').doc(request.imei);
    const state = (await tx.get(stateRef)).data() || {};
    const phonebook = (await tx.get(db.collection('watchPhonebookSettings').doc(request.imei))).data();
    const emergency = (await tx.get(db.collection('watchEmergencySettings').doc(request.imei))).data();
    const jobRef = db.collection('watchEmergencyJobs').doc(request.imei);
    const job = (await tx.get(jobRef)).data();
    if (!Array.isArray(user?.linkedImeis) || !user.linkedImeis.includes(request.imei)) return reject('not_authorized');
    if (policy?.version !== 1 || policy.managedBy !== 'guardian_admin') return reject('not_configured');
    if (policy.revision !== request.policyRevision) return reject('settings_changed');
    // Manual restoration remains available to linked guardians after an
    // entitlement expires or Auto is disabled by support.
    if (request.mode === 'auto') {
      if (emergency?.enabled || job?.active) return reject('emergency_policy_active');
      if (policy.autoEnabled !== true) return reject('auto_unavailable');
      const ownerUid = user.serviceOwnerUid || request.requestedBy;
      if (!validId(ownerUid)) return reject('not_authorized');
      const owner = ownerUid === request.requestedBy ? user : (await tx.get(db.collection('users').doc(ownerUid))).data();
      const subscription = (await tx.get(db.collection('serviceSubscriptions').doc(ownerUid))).data();
      const entitlement = evaluateSubscription(subscription, { now: new Date(clock), ownerUid });
      if ((ownerUid !== request.requestedBy && !verifiedFamilyMember(owner, request.requestedBy)) ||
          !entitlement.serviceActive || !['family', 'care'].includes(entitlement.plan)) return reject('service_unavailable');
    }
    if (milliseconds(state.latestRequestedAt) > milliseconds(request.createdAt)) return reject('superseded');
    if (request.mode === 'manual' && job?.active) {
      // Durable cancellation is accepted even while an emergency Auto write is
      // in flight. The worker keeps the lease and then restores Manual. Its
      // post-probe guard suppresses Auto whenever cancellation precedes it.
      tx.set(stateRef, { latestRequestedAt: request.createdAt }, { merge: true });
      tx.update(jobRef, { cancel: true, endsAt: new Date(clock), retryAt: new Date(clock), manualRequestId: requestId });
      tx.update(ref, { status: 'restoration_pending', startedAt: new Date(clock) });
      tx.set(db.collection('watchEmergencySettings').doc(request.imei), {
        status: 'restoration_pending', updatedAt: new Date(clock),
      }, { merge: true });
      return { deferred: true };
    }
    if (milliseconds(state.leaseUntil) > clock || milliseconds(phonebook?.leaseUntil) > clock) return reject('change_in_progress');
    let prepared;
    try { prepared = prepareCapturedAnswerTrial({ imei: request.imei, mode: request.mode, capture: policy.capture }); }
    catch { return reject('not_configured'); }
    if (prepared.metadata.protocolId !== policy.protocolId) return reject('not_configured');
    const leaseUntil = Math.min(clock + LEASE_MS, milliseconds(request.expiresAt));
    tx.update(ref, { status: 'sending', startedAt: new Date(clock), leaseUntil: new Date(leaseUntil) });
    tx.set(stateRef, { requestId, requestedMode: request.mode, requestedBy: request.requestedBy,
      latestRequestedAt: request.createdAt, status: 'sending', leaseUntil: new Date(leaseUntil),
      updatedAt: new Date(clock) }, { merge: true });
    return { request, capture: policy.capture, stateRef, leaseUntil };
  });
  if (!claim || claim.rejected || claim.deferred) return { outcome: claim?.deferred ? 'restoration_pending' : claim?.reason || 'already_processed' };

  let result;
  if (now() >= claim.leaseUntil) result = { outcome: 'not_sent', reason: 'expired_before_handoff' };
  else {
    try { result = await send({ imei: claim.request.imei, mode: claim.request.mode, capture: claim.capture },
      { deadlineAt: claim.leaseUntil, now }); }
    catch { result = { outcome: 'handoff_unknown', reason: 'socket_write_uncertain' }; }
  }
  // Explicit allowlist: never persist a raw transport result or private frame.
  const status = ['device_replied', 'socket_handoff', 'not_sent', 'handoff_unknown'].includes(result?.outcome) ? result.outcome : 'handoff_unknown';
  const reason = ['no_fresh_identified_session', 'capture_device_mismatch', 'socket_write_uncertain', 'expired_before_handoff',
    'connection_unconfirmed', 'connection_changed', 'transport_busy', 'watch_reply_missing']
    .includes(result?.reason) ? result.reason : null;
  const completion = { status, reason, completedAt: new Date(now()), appliedStateVerified: false,
    callerScopeVerified: false, automaticExpiry: false,
    deviceReplyObserved: status === 'device_replied',
    expectedReplies: claim.request.mode === 'manual' ? ['APPLOCK', 'ACALL'] : ['ACALL'],
    receivedReplies: ['APPLOCK', 'ACALL'].filter(command => Array.isArray(result?.receivedReplies) && result.receivedReplies.includes(command)),
  };
  try {
    await db.runTransaction(async tx => {
      const state = (await tx.get(claim.stateRef)).data() || {};
      tx.update(ref, completion);
      if (state.requestId === requestId) {
        tx.set(claim.stateRef, { ...completion, leaseUntil: null, updatedAt: completion.completedAt,
          ...(['device_replied', 'socket_handoff'].includes(status) ? { lastHandoffMode: claim.request.mode, lastHandoffAt: completion.completedAt } : {}) }, { merge: true });
      }
    });
  } catch {
    // The watch may have changed already. The durable 'sending' record is
    // intentionally left uncertain, never retried by the pending watcher.
    console.error('[watch-calls] result persistence unavailable; no automatic replay');
    return { outcome: 'handoff_unknown', reason: 'result_persistence_unavailable' };
  }
  console.log(`[watch-calls] request=${requestId} mode=${claim.request.mode} outcome=${status}`);
  return { outcome: status, reason };
}

let unsubscribe = null;
function startWatchCallWatcher(db) {
  if (!db || unsubscribe) return;
  unsubscribe = db.collection('watchCallRequests').where('status', '==', 'pending').onSnapshot(snapshot => {
    for (const change of snapshot.docChanges()) {
      if (change.type === 'removed' || change.doc.data().status !== 'pending') continue;
      processWatchCallRequest(db, change.doc.id).catch(() => console.error('[watch-calls] request processing unavailable'));
    }
  }, () => console.error('[watch-calls] request watcher unavailable'));
  console.log('[watch-calls] watching short-lived Calls requests');
}

module.exports = { configureWatchCalls, processWatchCallRequest, startWatchCallWatcher, requestError };
