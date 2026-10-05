'use strict';

// Keep the incident-photo rollout compatible with PR #115's independently
// deployed calling rules without importing or activating its gateway workers.
const fs = require('node:fs');
const path = require('node:path');
const { before, after, test } = require('node:test');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, setDoc, getDoc, updateDoc, deleteDoc, serverTimestamp, Timestamp } = require('firebase/firestore');

const imei = '999999999999999';
let env;
let sequence = 0;
const client = uid => env.authenticatedContext(uid).firestore();
const base = (uid = 'owner') => ({ imei, requestedBy: uid, status: 'pending',
  createdAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 60000) });
const write = (collection, uid, value) => setDoc(doc(client(uid), collection, `request${++sequence}`), value);

before(async () => {
  env = await initializeTestEnvironment({ projectId: 'guardian-incident-calling-compat-test',
    firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'rules.example'), 'utf8') } });
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    for (const uid of ['owner', 'member', 'expired', 'outsider']) {
      await setDoc(doc(db, 'users', uid), { linkedImeis: uid === 'outsider' ? [] : [imei],
        ...(uid === 'member' ? { serviceOwnerUid: 'owner' } : {}), memberUids: uid === 'owner' ? ['member'] : [] });
      await setDoc(doc(db, 'serviceSubscriptions', uid), {
        version: 1, managedBy: 'guardian_admin', plan: 'family', status: uid === 'expired' ? 'expired' : 'active' });
    }
    await setDoc(doc(db, 'watchPhonebookPolicies', imei), {
      version: 1, managedBy: 'guardian_admin', managerUid: 'owner', revision: 'revision-1' });
    await setDoc(doc(db, 'watchCallPolicies', imei), {
      version: 1, managedBy: 'guardian_admin', autoEnabled: true, revision: 'revision-1' });
    await setDoc(doc(db, 'watchEmergencyPolicies', imei), { managerUid: 'owner', revision: 'revision-1' });
    for (const collection of ['watchPhonebookSettings', 'watchCallSettings', 'watchEmergencySettings']) {
      await setDoc(doc(db, collection, imei), { configured: true });
    }
    await setDoc(doc(db, 'watchCallLinks', 'private-link'), { imei, guardianUid: 'owner' });
  });
});
after(async () => env?.cleanup());

test('incident rollout retains phonebook manager authority and linked status access', async () => {
  const input = uid => ({ ...base(uid), name: 'Test contact', phone: '+23050000000', policyRevision: 'revision-1' });
  await assertSucceeds(write('watchPhonebookRequests', 'owner', input('owner')));
  for (const uid of ['member', 'outsider']) await assertFails(write('watchPhonebookRequests', uid, input(uid)));
  for (const patch of [{ slot: 1 }, { phone: '123' }, { policyRevision: 'old' }, { requestedBy: 'member' }]) {
    await assertFails(write('watchPhonebookRequests', 'owner', { ...input('owner'), ...patch }));
  }
  await assertSucceeds(getDoc(doc(client('member'), 'watchPhonebookSettings', imei)));
  await assertFails(getDoc(doc(client('outsider'), 'watchPhonebookSettings', imei)));
  await assertFails(updateDoc(doc(client('owner'), 'watchPhonebookSettings', imei), { configured: false }));
});

test('incident rollout retains consent-bound answer requests and Manual after service expiry', async () => {
  const input = (uid, mode = 'auto') => ({ ...base(uid), mode,
    consentAccepted: mode === 'auto', policyRevision: 'revision-1' });
  for (const uid of ['owner', 'member']) await assertSucceeds(write('watchCallRequests', uid, input(uid)));
  for (const uid of ['expired', 'outsider']) await assertFails(write('watchCallRequests', uid, input(uid)));
  await assertSucceeds(write('watchCallRequests', 'expired', input('expired', 'manual')));
  for (const patch of [{ consentAccepted: false }, { policyRevision: 'old' }, { frameHex: 'abcd' },
    { expiresAt: Timestamp.fromMillis(Date.now() - 1000) },
    { expiresAt: Timestamp.fromMillis(Date.now() + 600000) }]) {
    await assertFails(write('watchCallRequests', 'owner', { ...input('owner'), ...patch }));
  }
  await assertSucceeds(getDoc(doc(client('member'), 'watchCallSettings', imei)));
  await assertFails(getDoc(doc(client('outsider'), 'watchCallSettings', imei)));
});

test('incident rollout retains owner-only emergency enrollment and off after service expiry', async () => {
  const input = (uid, enabled = true) => ({ ...base(uid), enabled, consentAccepted: enabled, revision: 'revision-1' });
  await assertSucceeds(write('watchEmergencyRequests', 'owner', input('owner')));
  for (const uid of ['member', 'outsider']) await assertFails(write('watchEmergencyRequests', uid, input(uid)));
  for (const patch of [{ consentAccepted: false }, { revision: 'old' }, { phone: '+23050000001' },
    { expiresAt: Timestamp.fromMillis(Date.now() - 1000) }]) {
    await assertFails(write('watchEmergencyRequests', 'owner', { ...input('owner'), ...patch }));
  }
  await env.withSecurityRulesDisabled(context => updateDoc(doc(context.firestore(), 'watchEmergencyPolicies', imei), { managerUid: 'expired' }));
  await assertFails(write('watchEmergencyRequests', 'expired', input('expired')));
  await assertSucceeds(write('watchEmergencyRequests', 'expired', input('expired', false)));
  await assertSucceeds(getDoc(doc(client('member'), 'watchEmergencySettings', imei)));
});

test('private call links, policies and incident authority stay inaccessible to linked owners', async () => {
  for (const db of [client('owner'), env.unauthenticatedContext().firestore()]) {
    for (const collection of ['watchPhonebookPolicies', 'watchCallPolicies', 'watchEmergencyPolicies',
      'watchEmergencyJobs', 'watchEmergencyEvents', 'watchCallLinks', 'incidentPhotos', 'incidentPhotoSettings']) {
      const ref = doc(db, collection, collection === 'watchCallLinks' ? 'private-link' : imei);
      await assertFails(getDoc(ref));
      await assertFails(setDoc(ref, { imei, enabled: true }));
      await assertFails(deleteDoc(ref));
    }
  }
});

test('the generic command queue cannot bypass phonebook, alarm or answer authorization', async () => {
  for (const type of ['set_phonebook_contact', 'set_alarm_mode', 'set_watch_answer_mode']) {
    await assertFails(setDoc(doc(client('owner'), 'deviceCommands', type), {
      imei, type, params: { mode: 'auto' }, createdBy: 'owner', status: 'pending', createdAt: serverTimestamp() }));
  }
});
