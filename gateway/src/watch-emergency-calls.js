'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { prepareCapturedAnswerTrial } = require('./captured-answer-mode-trial');
const { sendWatchCallWithReplies } = require('./watch-call-transport');
const { evaluateSubscription } = require('./entitlements');

const WINDOW_MS = 5 * 60_000;
const AUTO_START_MS = 30_000;
const LEASE_MS = 30_000;
const ms = value => value?.toMillis?.() ?? (value instanceof Date ? value.getTime() : NaN);
const validImei = value => typeof value === 'string' && /^\d{15}$/.test(value);
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const ref = (db, name, id) => db.collection(name).doc(id);
const canonicalPhone = value => typeof value === 'string'
  ? value.replace(/[\s()+.-]/g, '').replace(/^00/, '') : '';

function capturedCaller(imei, policy) {
  const prepared = prepareCapturedAnswerTrial({ imei, mode: 'auto', capture: policy?.capture });
  if (prepared.metadata.protocolId !== policy.protocolId) throw new Error('identity_mismatch');
  return prepared.bytes.toString('ascii').match(/ACALL,(00\d{11})\]$/)[1];
}
function eligible(imei, policy, calls, user, subscription, clock) {
  if (policy?.version !== 1 || policy.managedBy !== 'guardian_admin' ||
      calls?.version !== 1 || calls.managedBy !== 'guardian_admin' || calls.autoEnabled !== true ||
      calls.revision !== policy.callPolicyRevision) return 'call_settings_changed';
  if (!user?.linkedImeis?.includes(imei) || (user.serviceOwnerUid && user.serviceOwnerUid !== policy.managerUid)) return 'manager_access_changed';
  const entitlement = evaluateSubscription(subscription, { now: new Date(clock), ownerUid: policy.managerUid });
  if (!entitlement.serviceActive || !['family', 'care'].includes(entitlement.plan)) return 'service_unavailable';
  const primary = Array.isArray(user.emergencyContacts) ? user.emergencyContacts.filter(c => c.isPrimary === true) : [];
  try {
    if (primary.length !== 1 || canonicalPhone(primary[0].phone) !== canonicalPhone(capturedCaller(imei, calls))) return 'primary_contact_mismatch';
  } catch { return 'call_settings_changed'; }
  return null;
}
async function authority(tx, db, imei, policy) {
  const calls = (await tx.get(ref(db, 'watchCallPolicies', imei))).data();
  const user = validId(policy?.managerUid) ? (await tx.get(ref(db, 'users', policy.managerUid))).data() : null;
  const subscription = validId(policy?.managerUid) ? (await tx.get(ref(db, 'serviceSubscriptions', policy.managerUid))).data() : null;
  return { calls, user, subscription };
}

// Operator binds the already proven capture to the service owner's primary.
// Setup alone does not enable emergency answering or send anything to the watch.
async function configureEmergencyCalls(db, { imei, managerUid }, { now = Date.now } = {}) {
  if (!validImei(imei) || (managerUid != null && !validId(managerUid))) throw new Error('invalid_arguments');
  if (!managerUid) {
    const calls = (await ref(db, 'watchCallPolicies', imei).get()).data();
    const caller = canonicalPhone(capturedCaller(imei, calls));
    const users = await db.collection('users').where('linkedImeis', 'array-contains', imei).get();
    const candidates = users.docs.filter(doc => {
      const user = doc.data();
      const primary = (Array.isArray(user.emergencyContacts) ? user.emergencyContacts : []).filter(c => c.isPrimary === true);
      return (!user.serviceOwnerUid || user.serviceOwnerUid === doc.id) && primary.length === 1 && canonicalPhone(primary[0].phone) === caller;
    });
    if (candidates.length !== 1) throw new Error('primary_owner_ambiguous');
    managerUid = candidates[0].id;
  }
  await db.runTransaction(async tx => {
    const calls = (await tx.get(ref(db, 'watchCallPolicies', imei))).data();
    const policy = { version: 1, managedBy: 'guardian_admin', managerUid, callPolicyRevision: calls?.revision || '', revision: randomUUID() };
    const { user, subscription } = await authority(tx, db, imei, policy);
    const job = (await tx.get(ref(db, 'watchEmergencyJobs', imei))).data();
    const settings = (await tx.get(ref(db, 'watchEmergencySettings', imei))).data();
    const state = (await tx.get(ref(db, 'watchCallSettings', imei))).data();
    const device = (await tx.get(ref(db, 'devices', imei))).data();
    const reason = eligible(imei, policy, calls, user, subscription, now());
    if (reason) throw new Error(reason);
    if (device?.protocolId !== calls.protocolId) throw new Error('identity_mismatch');
    if (job?.active || settings?.enabled || ms(state?.leaseUntil) > now()) throw new Error('change_in_progress');
    tx.set(ref(db, 'watchEmergencyPolicies', imei), policy);
    tx.set(ref(db, 'watchEmergencySettings', imei), { configured: true, managerUid, revision: policy.revision,
      enabled: false, ready: false, status: 'disabled', windowMinutes: 5,
      callerHint: `Primary contact ending ${capturedCaller(imei, calls).slice(-4)}`, updatedAt: new Date(now()) });
  });
  return { configured: true, enabled: false, watchCommandSent: false };
}

function manualJob(capture, clock, previous = {}) {
  // Keep any in-flight lease/token. Cancellation cannot open a second writer.
  return { ...previous, capture: previous.active ? previous.capture : capture,
    active: true, phase: previous.active ? previous.phase : 'restore_pending',
    cancel: true, endsAt: new Date(clock), retryAt: new Date(clock),
    token: previous.active ? previous.token : randomUUID(), manualRequestId: previous.active ? previous.manualRequestId || null : null,
    attempts: previous.active ? previous.attempts || 0 : 0 };
}

async function processEmergencyRequest(db, requestId, { now = Date.now } = {}) {
  if (!db || !validId(requestId)) return;
  return db.runTransaction(async tx => {
    const requestRef = ref(db, 'watchEmergencyRequests', requestId);
    const request = (await tx.get(requestRef)).data();
    if (!request || request.status !== 'pending') return;
    const clock = now();
    const reject = reason => { tx.update(requestRef, { status: 'not_applied', reason, completedAt: new Date(clock) }); return { outcome: reason }; };
    const keys = ['imei', 'enabled', 'requestedBy', 'revision', 'consentAccepted', 'createdAt', 'expiresAt', 'status'];
    if (Object.keys(request).some(k => !keys.includes(k)) || !validImei(request.imei) ||
        !validId(request.requestedBy) || !validId(request.revision) || typeof request.enabled !== 'boolean' ||
        request.consentAccepted !== request.enabled || !Number.isFinite(ms(request.createdAt)) ||
        !Number.isFinite(ms(request.expiresAt)) || ms(request.createdAt) > clock + 5000 ||
        ms(request.expiresAt) > ms(request.createdAt) + 90_000) return reject('invalid_request');
    if (ms(request.expiresAt) <= clock || ms(request.createdAt) < clock - 90_000) return reject('expired');
    const imei = request.imei;
    const policy = (await tx.get(ref(db, 'watchEmergencyPolicies', imei))).data();
    const settingsRef = ref(db, 'watchEmergencySettings', imei);
    const settings = (await tx.get(settingsRef)).data() || {};
    const { calls, user, subscription } = await authority(tx, db, imei, policy);
    const jobRef = ref(db, 'watchEmergencyJobs', imei);
    const job = (await tx.get(jobRef)).data() || {};
    if (policy?.managerUid !== request.requestedBy || !user?.linkedImeis?.includes(imei)) return reject('not_authorized');
    if (policy.revision !== request.revision) return reject('settings_changed');
    if (ms(settings.latestRequestedAt) >= ms(request.createdAt)) return reject('superseded');
    if (request.enabled) {
      const reason = eligible(imei, policy, calls, user, subscription, clock);
      if (reason) return reject(reason);
    }
    let capture = job.active ? job.capture : calls?.capture;
    try { prepareCapturedAnswerTrial({ imei, mode: 'manual', capture }); }
    catch { return reject('manual_configuration_unavailable'); }
    tx.set(jobRef, manualJob(capture, clock, job));
    tx.set(ref(db, 'watchCallSettings', imei), { emergencyEnabled: request.enabled, emergencyRestorationPending: true }, { merge: true });
    tx.set(settingsRef, { enabled: request.enabled, ready: false, status: 'restoration_pending',
      reason: null, latestRequestedAt: request.createdAt, windowEndsAt: null, updatedAt: new Date(clock) }, { merge: true });
    tx.update(requestRef, { status: 'applied', completedAt: new Date(clock) });
    return { outcome: 'restoration_pending', imei };
  });
}

/** Only called directly from decoded TCP alarm ingress, never the alerts watcher.
 * Source time must be fresh even if the packet is received just now. Receipt
 * of a client-created alert or an old buffered alarm cannot enable Auto.
 */
async function admitWatchEmergency(db, event, receivedAt, { now = Date.now } = {}) {
  const clock = now(), received = ms(receivedAt), source = ms(event?.alarmRecordedAt);
  if (!db || !validImei(event?.imei) || event.type !== 'alarm' || !['sos', 'fall'].includes(event.alarmType) ||
      !['AL', 'AL_LTE'].includes(event.alarmCommand) || !Number.isFinite(source) ||
      !Number.isFinite(received) || received > clock + 5000 || received < clock - AUTO_START_MS ||
      source > received + 30_000 || source < received - 120_000) return { outcome: 'not_fresh_watch_alarm' };
  const imei = event.imei;
  const eventId = createHash('sha256').update(`${imei}|${event.alarmType}|${event.alarmCode}|${source}`).digest('hex');
  return db.runTransaction(async tx => {
    const settingsRef = ref(db, 'watchEmergencySettings', imei);
    const settings = (await tx.get(settingsRef)).data();
    if (!settings?.enabled || !settings.ready) return { outcome: 'not_armed' };
    const policy = (await tx.get(ref(db, 'watchEmergencyPolicies', imei))).data();
    const { calls, user, subscription } = await authority(tx, db, imei, policy);
    const jobRef = ref(db, 'watchEmergencyJobs', imei);
    const job = (await tx.get(jobRef)).data();
    const seenRef = ref(db, 'watchEmergencyEvents', eventId);
    const seen = await tx.get(seenRef);
    const device = (await tx.get(ref(db, 'devices', imei))).data();
    const reason = eligible(imei, policy, calls, user, subscription, clock);
    if (reason || calls?.protocolId !== event.protocolId || device?.protocolId !== event.protocolId) {
      tx.set(settingsRef, { reason: reason || 'identity_mismatch', updatedAt: new Date(clock) }, { merge: true });
      return { outcome: reason || 'identity_mismatch' };
    }
    if (seen.exists || job?.active || ms(job?.quietUntil) > clock || source <= ms(job?.lastSourceAt)) return { outcome: 'coalesced' };
    const endsAt = new Date(received + WINDOW_MS);
    // Durable Manual recovery and its exact capture exist BEFORE any Auto write.
    tx.set(jobRef, { active: true, token: randomUUID(), phase: 'pending_auto', cancel: false,
      type: event.alarmType, eventId, lastSourceAt: new Date(source), capture: calls.capture,
      callPolicyRevision: calls.revision, autoBy: new Date(received + AUTO_START_MS), endsAt,
      retryAt: new Date(clock), attempts: 0 });
    tx.set(seenRef, { imei, createdAt: new Date(clock), expiresAt: new Date(clock + 30 * 86400_000) });
    tx.set(settingsRef, { status: 'preparing', windowEndsAt: endsAt, reason: null,
      incidentType: event.alarmType, updatedAt: new Date(clock) }, { merge: true });
    return { outcome: 'admitted', imei };
  });
}

async function reconcileEmergencyCall(db, imei, { now = Date.now, send = sendWatchCallWithReplies } = {}) {
  if (!db || !validImei(imei)) return;
  const jobRef = ref(db, 'watchEmergencyJobs', imei), settingsRef = ref(db, 'watchEmergencySettings', imei);
  const callRef = ref(db, 'watchCallSettings', imei);
  const claim = await db.runTransaction(async tx => {
    const job = (await tx.get(jobRef)).data();
    if (!job?.active) return null;
    const settings = (await tx.get(settingsRef)).data() || {};
    const policy = (await tx.get(ref(db, 'watchEmergencyPolicies', imei))).data();
    const { calls, user, subscription } = await authority(tx, db, imei, policy);
    const state = (await tx.get(callRef)).data() || {};
    const phonebook = (await tx.get(ref(db, 'watchPhonebookSettings', imei))).data();
    const clock = now();
    if (ms(state.leaseUntil) > clock || ms(phonebook?.leaseUntil) > clock || ms(job.retryAt) > clock) return null;
    const reason = eligible(imei, policy, calls, user, subscription, clock);
    const restore = job.cancel || !settings.enabled || reason || ms(job.endsAt) <= clock ||
      !['pending_auto', 'active'].includes(job.phase) || ms(job.autoBy) <= clock && job.phase === 'pending_auto';
    if (!restore && job.phase === 'active') return null;
    const mode = restore ? 'manual' : 'auto';
    const token = randomUUID();
    const deadlineAt = Math.min(clock + LEASE_MS, mode === 'auto' ? ms(job.autoBy) : Infinity);
    tx.update(jobRef, { token, phase: mode === 'auto' ? 'sending_auto' : 'restoring', attempts: job.attempts + 1 });
    tx.set(callRef, { leaseUntil: new Date(deadlineAt), emergencyToken: token }, { merge: true });
    tx.set(settingsRef, { status: mode === 'auto' ? 'preparing' : 'restoration_pending',
      ...(reason ? { reason } : {}), updatedAt: new Date(clock) }, { merge: true });
    return { mode, token, capture: job.capture, deadlineAt };
  });
  if (!claim) return;
  const beforeWrite = async () => db.runTransaction(async tx => {
    const job = (await tx.get(jobRef)).data();
    const state = (await tx.get(callRef)).data();
    if (!job?.active || job.token !== claim.token || state?.emergencyToken !== claim.token || now() >= claim.deadlineAt) return false;
    if (claim.mode === 'manual') return true;
    const settings = (await tx.get(settingsRef)).data();
    const policy = (await tx.get(ref(db, 'watchEmergencyPolicies', imei))).data();
    const { calls, user, subscription } = await authority(tx, db, imei, policy);
    return !job.cancel && ms(job.endsAt) > now() && settings?.enabled === true &&
      !eligible(imei, policy, calls, user, subscription, now());
  });
  let result;
  try {
    result = now() >= claim.deadlineAt ? { outcome: 'not_sent' } :
      await send({ imei, mode: claim.mode, capture: claim.capture }, { deadlineAt: claim.deadlineAt, now, beforeWrite });
  } catch { result = { outcome: 'handoff_unknown' }; }
  const replied = result?.outcome === 'device_replied';
  await db.runTransaction(async tx => {
    const job = (await tx.get(jobRef)).data();
    const state = (await tx.get(callRef)).data();
    const settings = (await tx.get(settingsRef)).data() || {};
    if (job?.token !== claim.token || state?.emergencyToken !== claim.token) return;
    const clock = now(), done = claim.mode === 'manual' && replied;
    const active = claim.mode === 'auto' && replied && !job.cancel && ms(job.endsAt) > clock && settings.enabled;
    const retryMs = Math.min(60_000, 5000 * 2 ** Math.min(job.attempts - 1, 4));
    tx.update(jobRef, { active: !done, phase: done ? 'done' : active ? 'active' : 'restore_pending',
      retryAt: new Date(clock + (active || claim.mode === 'auto' ? 0 : retryMs)),
      ...(done ? { quietUntil: new Date(clock + (job.type ? 60_000 : 0)) } : {}) });
    tx.set(callRef, { leaseUntil: null, emergencyToken: null, emergencyRestorationPending: !done,
      ...(replied ? { lastHandoffMode: claim.mode, lastHandoffAt: new Date(clock) } : {}) }, { merge: true });
    tx.set(settingsRef, { ready: done ? settings.enabled === true : settings.ready === true,
      status: done ? (settings.enabled ? 'manual_replied' : 'disabled') : active ? 'auto_replied' : 'restoration_pending',
      deviceReplyObserved: replied, appliedStateVerified: false, automaticExpiry: false,
      ...(done ? { windowEndsAt: null } : {}), updatedAt: new Date(clock) }, { merge: true });
    if (done && validId(job.manualRequestId)) {
      tx.update(ref(db, 'watchCallRequests', job.manualRequestId), { status: 'device_replied', deviceReplyObserved: true,
        appliedStateVerified: false, completedAt: new Date(clock), expectedReplies: ['APPLOCK', 'ACALL'], receivedReplies: ['APPLOCK', 'ACALL'] });
    }
  });
  return { outcome: replied ? 'device_replied' : 'restoration_pending', mode: claim.mode };
}

let started = false;
function startEmergencyCalls(db) {
  if (!db || started) return;
  started = true;
  const reconcile = imei => reconcileEmergencyCall(db, imei).catch(() => console.error('[emergency-calls] restoration remains pending'));
  db.collection('watchEmergencyRequests').where('status', '==', 'pending').onSnapshot(snapshot => {
    for (const change of snapshot.docChanges()) {
      if (change.type !== 'removed') processEmergencyRequest(db, change.doc.id)
        .then(result => { if (result?.imei) return reconcile(result.imei); })
        .catch(() => console.error('[emergency-calls] preference request unavailable'));
    }
  }, () => console.error('[emergency-calls] preference watcher unavailable'));
  let sweeping = false;
  const sweep = async () => {
    if (sweeping) return;
    sweeping = true;
    try {
      const jobs = await db.collection('watchEmergencyJobs').where('active', '==', true).get();
      await Promise.all(jobs.docs.map(doc => reconcile(doc.id)));
    } catch { console.error('[emergency-calls] recovery scan unavailable'); }
    finally { sweeping = false; }
  };
  // Startup + periodic recovery also handles reconnects without tying recovery
  // to a location packet, alert watcher, process memory, or an open app screen.
  void sweep();
  setInterval(sweep, 10_000).unref();
}

module.exports = { configureEmergencyCalls, processEmergencyRequest, admitWatchEmergency,
  reconcileEmergencyCall, startEmergencyCalls, WINDOW_MS, eligible };
