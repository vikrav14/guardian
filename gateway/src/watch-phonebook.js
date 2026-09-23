'use strict';

const { randomUUID } = require('node:crypto');
const { normalizeCallingPhone, phonebookContactCommand } = require('./commands');
const { sendPhonebookWithReplies } = require('./watch-call-transport');
const { provisionPhonebookContact } = require('./phonebook-provisioning');
const ms = value => value?.toMillis?.() ?? (value instanceof Date ? value.getTime() : NaN);
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) && !/[\r\n]/.test(value);
const imeiValid = value => typeof value === 'string' && value.length === 15 && /^[0-9]{15}$/.test(value);
const keys = ['imei', 'name', 'phone', 'requestedBy', 'createdAt', 'expiresAt', 'status', 'policyRevision'];

function contact(value) {
  if (typeof value?.name !== 'string' || typeof value?.phone !== 'string') throw new Error('invalid_contact');
  const name = value.name.trim(), phone = normalizeCallingPhone(value.phone);
  // Limit code units too, matching the rules and Flutter editor.
  if (name.length > 20) throw new Error('invalid_contact');
  phonebookContactCommand({ slot: 1, name, phone });
  return { name, phone };
}

function validateInventory(input) {
  if (!imeiValid(input?.imei) || !id(input?.managerUid) || input?.inventoryConfirmed !== true ||
      !Array.isArray(input.emptySlots) || !Array.isArray(input.contacts) ||
      input.emptySlots.length + input.contacts.length > 15 || !input.emptySlots.length) throw new Error('invalid_inventory');
  const occupied = input.contacts.map(row => ({ ...contact(row), slot: row.slot, status: 'imported' }));
  const slots = [...input.emptySlots, ...occupied.map(row => row.slot)];
  if (slots.some(slot => !Number.isInteger(slot) || slot < 1 || slot > 15) || new Set(slots).size !== slots.length ||
      new Set(occupied.map(row => row.phone)).size !== occupied.length) throw new Error('invalid_inventory');
  return { ...input, contacts: occupied, emptySlots: [...input.emptySlots].sort((a, b) => a - b) };
}

/** One-time inventory after physically checking existing contacts and empty
 * slots. Unknown slots are never available. Import sends NO watch commands.
 * A managed watch cannot use the legacy admin writer or be reinitialized.
 */
async function configureWatchPhonebook(db, input) {
  const inventory = validateInventory(input), revision = randomUUID();
  const policyRef = db.collection('watchPhonebookPolicies').doc(input.imei);
  await db.runTransaction(async tx => {
    const policy = (await tx.get(policyRef)).data();
    const user = (await tx.get(db.collection('users').doc(input.managerUid))).data();
    const device = (await tx.get(db.collection('devices').doc(input.imei))).data();
    if (policy?.version === 1) throw new Error('already_configured');
    if (ms(policy?.legacyLeaseUntil) > Date.now()) throw new Error('change_in_progress');
    if (!user?.linkedImeis?.includes(input.imei) || !/^[0-9]{10}$/.test(device?.protocolId || '')) throw new Error('identity_or_manager_invalid');
    tx.set(policyRef, { version: 1, managedBy: 'guardian_admin', managerUid: input.managerUid,
      protocolId: device.protocolId, revision, emptySlots: inventory.emptySlots, configuredAt: new Date() });
    tx.set(db.collection('watchPhonebookSettings').doc(input.imei), { configured: true,
      managerUid: input.managerUid, policyRevision: revision, contacts: inventory.contacts,
      availableSlots: inventory.emptySlots.length, leaseUntil: null, updatedAt: new Date() });
  });
  return { configured: true, availableSlots: inventory.emptySlots.length, importedContacts: inventory.contacts.length, watchCommandSent: false };
}

function requestError(request, now) {
  if (!request || Object.keys(request).some(key => !keys.includes(key)) || !imeiValid(request.imei) ||
      !id(request.requestedBy) || !id(request.policyRevision)) return 'invalid_request';
  try { contact(request); } catch { return 'invalid_contact'; }
  const created = ms(request.createdAt), expires = ms(request.expiresAt);
  if (!Number.isFinite(created) || !Number.isFinite(expires) || created > now + 5000 || expires > created + 90000) return 'invalid_request';
  if (expires <= now || created < now - 90000) return 'expired';
  return null;
}

async function processWatchPhonebookRequest(db, requestId, { now = Date.now, send = sendPhonebookWithReplies } = {}) {
  if (!db || !id(requestId)) return { outcome: 'invalid_request' };
  const ref = db.collection('watchPhonebookRequests').doc(requestId);
  const claim = await db.runTransaction(async tx => {
    const request = (await tx.get(ref)).data();
    if (!request || request.status !== 'pending') return null;
    const clock = now();
    const reject = reason => { tx.update(ref, { status: 'not_sent', reason, completedAt: new Date(clock) }); return { rejected: reason }; };
    const invalid = requestError(request, clock);
    if (invalid) return reject(invalid);
    const policyRef = db.collection('watchPhonebookPolicies').doc(request.imei);
    const stateRef = db.collection('watchPhonebookSettings').doc(request.imei);
    const policy = (await tx.get(policyRef)).data();
    const state = (await tx.get(stateRef)).data() || {};
    const user = (await tx.get(db.collection('users').doc(request.requestedBy))).data();
    const device = (await tx.get(db.collection('devices').doc(request.imei))).data();
    const calls = (await tx.get(db.collection('watchCallSettings').doc(request.imei))).data();
    if (policy?.version !== 1 || policy.managedBy !== 'guardian_admin' || !state.configured) return reject('not_configured');
    if (policy.managerUid !== request.requestedBy || !user?.linkedImeis?.includes(request.imei)) return reject('not_authorized');
    if (policy.revision !== request.policyRevision) return reject('settings_changed');
    if (device?.protocolId !== policy.protocolId) return reject('device_identity_changed');
    if (ms(state.leaseUntil) > clock || ms(calls?.leaseUntil) > clock) return reject('change_in_progress');
    const wanted = contact(request), rows = state.contacts || [];
    const existing = rows.find(row => row.phone === wanted.phone);
    // Only a provable pre-write failure can retry. Receipt uncertainty and a
    // crashed 'sending' claim keep their slot reserved, without replay.
    if (existing && existing.status !== 'not_sent') return reject('already_reserved');
    if (existing && existing.name !== wanted.name) return reject('replacement_unavailable');
    const slot = existing?.slot ?? policy.emptySlots?.[0];
    if (!slot) return reject('no_verified_empty_slot');
    const leaseUntil = Math.min(clock + 30000, ms(request.expiresAt));
    const row = { ...wanted, slot, requestId, status: 'sending', leaseUntil: new Date(leaseUntil), appliedStateVerified: false };
    const contacts = [...rows.filter(old => old.slot !== slot), row].sort((a, b) => a.slot - b.slot);
    const emptySlots = policy.emptySlots.filter(value => value !== slot);
    tx.update(policyRef, { emptySlots });
    tx.set(stateRef, { ...state, contacts, availableSlots: emptySlots.length, requestId,
      leaseUntil: new Date(leaseUntil), updatedAt: new Date(clock) });
    tx.update(ref, { status: 'sending', slot, leaseUntil: new Date(leaseUntil), startedAt: new Date(clock) });
    return { request, stateRef, row, protocolId: policy.protocolId, leaseUntil };
  });
  if (!claim || claim.rejected) return { outcome: claim?.rejected || 'already_processed' };
  let result;
  if (now() >= claim.leaseUntil) result = { outcome: 'not_sent', reason: 'expired_before_handoff' };
  else {
    try { result = await send({ imei: claim.request.imei, protocolId: claim.protocolId,
      slot: claim.row.slot, name: claim.row.name, phone: claim.row.phone }, { now, deadlineAt: claim.leaseUntil }); }
    catch { result = { outcome: 'handoff_unknown', reason: 'write_uncertain' }; }
  }
  const status = ['not_sent', 'device_replied', 'handoff_unknown'].includes(result?.outcome) ? result.outcome : 'handoff_unknown';
  const reason = ['expired_before_handoff', 'no_fresh_identified_session', 'capture_device_mismatch',
    'connection_unconfirmed', 'connection_changed', 'transport_busy', 'watch_reply_missing', 'write_uncertain'].includes(result?.reason) ? result.reason : null;
  const completion = { status, reason, completedAt: new Date(now()), appliedStateVerified: false,
    deviceReplyObserved: status === 'device_replied' };
  try {
    await db.runTransaction(async tx => {
      const state = (await tx.get(claim.stateRef)).data();
      tx.update(ref, completion);
      // Complete only this reservation; never overwrite a later request.
      const contacts = state.contacts.map(row => row.requestId === requestId ? { ...row, ...completion } : row);
      tx.update(claim.stateRef, { contacts, updatedAt: completion.completedAt,
        ...(state.requestId === requestId ? { leaseUntil: null } : {}) });
    });
  } catch {
    console.error('[watch-contacts] result unavailable; reservation retained, no replay');
    return { outcome: 'handoff_unknown' };
  }
  console.log(`[watch-contacts] request=${requestId} outcome=${status}`);
  return { outcome: status, reason };
}

/** Interlock the legacy admin writer with inventory setup. Full IMEI is now
 * required so a protocol-ID alias cannot bypass the managed-watch lock. */
async function provisionUnmanagedPhonebook(db, payload, { send = provisionPhonebookContact } = {}) {
  if (!db || !imeiValid(payload?.imei)) throw new Error('full_imei_and_database_required');
  const ref = db.collection('watchPhonebookPolicies').doc(payload.imei), token = randomUUID();
  const deadline = Date.now() + 30000;
  await db.runTransaction(async tx => {
    const policy = (await tx.get(ref)).data();
    if (policy?.version === 1) throw new Error('use_watch_contacts');
    if (ms(policy?.legacyLeaseUntil) > Date.now()) throw new Error('change_in_progress');
    tx.set(ref, { legacyToken: token, legacyLeaseUntil: new Date(deadline) });
  });
  try {
    if (Date.now() >= deadline) throw new Error('expired_before_handoff');
    return send(payload);
  }
  finally {
    try {
      await db.runTransaction(async tx => {
        const policy = (await tx.get(ref)).data();
        if (policy?.legacyToken === token) tx.update(ref, { legacyLeaseUntil: null });
      });
    } catch { console.error('[watch-contacts] admin lease release unavailable; do not retry blindly'); }
  }
}

let unsubscribe;
function startWatchPhonebookWatcher(db) {
  if (!db || unsubscribe) return;
  unsubscribe = db.collection('watchPhonebookRequests').where('status', '==', 'pending').onSnapshot(snapshot => {
    for (const change of snapshot.docChanges()) {
      if (change.type !== 'removed' && change.doc.data().status === 'pending') {
        processWatchPhonebookRequest(db, change.doc.id).catch(() => console.error('[watch-contacts] request unavailable'));
      }
    }
  }, () => console.error('[watch-contacts] watcher unavailable'));
  console.log('[watch-contacts] watching short-lived contact additions');
}

module.exports = { contact, validateInventory, configureWatchPhonebook, processWatchPhonebookRequest,
  startWatchPhonebookWatcher, provisionUnmanagedPhonebook };
