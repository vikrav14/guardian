'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, getDoc, getDocs, collection, query, where, orderBy, limit, setDoc, updateDoc, deleteDoc, serverTimestamp, Timestamp } = require('firebase/firestore');
const admin = require('../../gateway/node_modules/firebase-admin');
const { configureEmergencyCalls, processEmergencyRequest, admitWatchEmergency, reconcileEmergencyCall } = require('../../gateway/src/watch-emergency-calls');
const { imei, protocolId, callPolicy } = require('../../gateway/test-fixtures/watch-call-fixture');
let env, app, db, revision, sequence = 0;
before(async () => {
  const projectId = 'guardian-emergency-calls-test';
  env = await initializeTestEnvironment({ projectId, firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'rules.example'), 'utf8') } });
  app = admin.initializeApp({ projectId }, projectId); db = app.firestore();
  await db.doc(`devices/${imei}`).set({ protocolId });
  await db.doc(`watchCallPolicies/${imei}`).set(callPolicy());
  await db.doc('users/owner').set({ linkedImeis: [imei], emergencyContacts: [{ phone: '+23050000000', isPrimary: true }], memberUids: ['member'] });
  await db.doc('users/member').set({ linkedImeis: [imei], serviceOwnerUid: 'owner' });
  await db.doc('users/stranger').set({ linkedImeis: [] });
  await db.doc('serviceSubscriptions/owner').set({ version: 1, managedBy: 'guardian_admin', plan: 'family', status: 'active' });
  await configureEmergencyCalls(db, { imei }); // unique primary service owner is resolved privately
  revision = (await db.doc(`watchEmergencySettings/${imei}`).get()).data().revision;
});
after(async () => { await app?.delete(); await env?.cleanup(); });
const client = uid => env.authenticatedContext(uid).firestore();
const input = (enabled = true) => ({ imei, requestedBy: 'owner', revision, enabled, consentAccepted: enabled,
  createdAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 60000), status: 'pending' });
const write = (uid, data = input(), id = `pref${++sequence}`) => setDoc(doc(client(uid), 'watchEmergencyRequests', id), data);

test('only the configured service owner can opt in, with exact consent, revision and a short deadline', async () => {
  await assertSucceeds(write('owner'));
  await assertFails(write('member', { ...input(), requestedBy: 'member' }));
  await assertFails(write('stranger'));
  for (const patch of [{ phone: '+23050000001' }, { frame: 'ACALL' }, { enabled: 'true' }, { consentAccepted: false },
    { revision: 'obsolete' }, { status: 'applied' }, { requestedBy: 'member' }, { expiresAt: Timestamp.fromMillis(Date.now() - 1) },
    { expiresAt: Timestamp.fromMillis(Date.now() + 1000000) }, { createdAt: Timestamp.fromMillis(Date.now() - 60000) }]) {
    await assertFails(write('owner', { ...input(), ...patch }));
  }
  await assertFails(setDoc(doc(env.unauthenticatedContext().firestore(), 'watchEmergencyRequests', 'anonymous'), input()));
});

test('linked guardians can read status, but cannot alter jobs, captures, dedupe records or accepted requests', async () => {
  for (const name of ['watchEmergencyPolicies', 'watchEmergencyJobs', 'watchEmergencyEvents']) {
    await assertFails(setDoc(doc(client('owner'), name, imei), { active: true, enabled: true }));
    await assertFails(getDoc(doc(client('owner'), name, imei)));
  }
  await assertSucceeds(getDoc(doc(client('member'), 'watchEmergencySettings', imei)));
  await assertFails(getDoc(doc(client('stranger'), 'watchEmergencySettings', imei)));
  await assertFails(updateDoc(doc(client('owner'), 'watchEmergencySettings', imei), { ready: true, enabled: true }));
  const id = `pref${++sequence}`; await assertSucceeds(write('owner', input(), id));
  await assertFails(updateDoc(doc(client('owner'), 'watchEmergencyRequests', id), { enabled: false }));
  await assertFails(deleteDoc(doc(client('owner'), 'watchEmergencyRequests', id)));
  await assertSucceeds(getDocs(query(collection(client('owner'), 'watchEmergencyRequests'), where('imei', '==', imei), orderBy('createdAt', 'desc'), limit(1))));
});

test('real Firestore transactions establish Manual, claim one incident and restore from private durable state', async () => {
  const id = `pref${++sequence}`; await assertSucceeds(write('owner', input(), id));
  await processEmergencyRequest(db, id);
  await reconcileEmergencyCall(db, imei, { send: async (_, options) => { assert.equal(await options.beforeWrite(), true); return { outcome: 'device_replied' }; } });
  const now = Date.now();
  const event = { type: 'alarm', imei, protocolId, alarmType: 'sos', alarmCommand: 'AL_LTE', alarmCode: '00010000', alarmRecordedAt: new Date(now) };
  const admissions = await Promise.all([1, 2].map(() => admitWatchEmergency(db, event, new Date(now))));
  assert.equal(admissions.filter(r => r.outcome === 'admitted').length, 1);
  let count = 0;
  await Promise.all([1, 2].map(() => reconcileEmergencyCall(db, imei, { send: async (input, options) => {
    assert.equal(input.mode, 'auto'); assert.equal(await options.beforeWrite(), true); count++; return { outcome: 'device_replied' };
  } })));
  assert.equal(count, 1);
  await reconcileEmergencyCall(db, imei, { now: () => now + 301000, send: input => {
    assert.equal(input.mode, 'manual'); return { outcome: 'device_replied' };
  } });
  assert.equal((await db.doc(`watchEmergencyJobs/${imei}`).get()).data().active, false);
});

test('turning emergency answering off remains allowed after service expiry', async () => {
  await db.doc('serviceSubscriptions/owner').update({ status: 'expired' });
  await assertFails(write('owner'));
  await assertSucceeds(write('owner', input(false)));
});
