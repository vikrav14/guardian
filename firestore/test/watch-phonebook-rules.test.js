'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, setDoc, getDoc, getDocs, collection, query, where, orderBy, limit, updateDoc, deleteDoc, serverTimestamp, Timestamp } = require('firebase/firestore');
const admin = require('../../gateway/node_modules/firebase-admin');
const { configureWatchPhonebook, processWatchPhonebookRequest } = require('../../gateway/src/watch-phonebook');
const { processWatchCallRequest } = require('../../gateway/src/watch-calls');
const { callPolicy, callRequest } = require('../../gateway/test-fixtures/watch-call-fixture');
const { imei, protocolId, inventory, request } = require('../../gateway/test-fixtures/watch-phonebook-fixture');
let env, db, app, seq = 0;
before(async () => {
  const projectId = 'guardian-phonebook-management-test';
  env = await initializeTestEnvironment({ projectId, firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'rules.example'), 'utf8') } });
  app = admin.initializeApp({ projectId }, projectId); db = app.firestore();
  await db.doc(`devices/${imei}`).set({ protocolId });
  await db.doc('users/owner').set({ linkedImeis: [imei] });
  await db.doc('users/viewer').set({ linkedImeis: [imei] });
  await db.doc('users/outsider').set({ linkedImeis: [] });
  await configureWatchPhonebook(db, inventory());
  await db.doc(`watchPhonebookPolicies/${imei}`).update({ revision: 'revision-1' });
});
after(async () => { await app?.delete(); await env?.cleanup(); });
const input = (uid = 'owner') => ({ ...request(), requestedBy: uid,
  createdAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 60000) });
const client = uid => env.authenticatedContext(uid).firestore();
const write = (uid, data, id = `request${++seq}`) => setDoc(doc(client(uid), 'watchPhonebookRequests', id), data);

test('only designated linked manager can request additions; generic command path remains closed', async () => {
  await assertSucceeds(write('owner', input()));
  for (const uid of ['viewer', 'outsider']) await assertFails(write(uid, input(uid)));
  await assertFails(setDoc(doc(env.unauthenticatedContext().firestore(), 'watchPhonebookRequests', 'anonymous'), input()));
  for (const patch of [{ slot: 1 }, { command: 'PHBX' }, { name: '' }, { name: 'x'.repeat(21) }, { phone: '123' },
    { requestedBy: 'viewer' }, { policyRevision: 'old' }, { status: 'device_replied' },
    { createdAt: Timestamp.fromMillis(Date.now() - 1000) }, { expiresAt: Timestamp.fromMillis(Date.now() - 1) },
    { expiresAt: Timestamp.fromMillis(Date.now() + 600000) }]) await assertFails(write('owner', { ...input(), ...patch }));
  await assertFails(setDoc(doc(client('owner'), 'deviceCommands', 'phonebook-bypass'), {
    imei, type: 'set_phonebook_contact', params: { slot: 1 }, createdBy: 'owner', status: 'pending', createdAt: serverTimestamp(),
  }));
});

test('inventory and receipts cannot be forged; only linked users can view contact status', async () => {
  for (const collectionName of ['watchPhonebookPolicies', 'watchPhonebookSettings']) {
    await assertFails(setDoc(doc(client('owner'), collectionName, imei), { managerUid: 'owner' }));
  }
  await assertFails(getDoc(doc(client('owner'), 'watchPhonebookPolicies', imei)));
  await assertSucceeds(getDoc(doc(client('viewer'), 'watchPhonebookSettings', imei)));
  await assertFails(getDoc(doc(client('outsider'), 'watchPhonebookSettings', imei)));
  const id = `request${++seq}`; await assertSucceeds(write('owner', input(), id));
  await assertSucceeds(getDocs(query(collection(client('owner'), 'watchPhonebookRequests'), where('imei', '==', imei), orderBy('createdAt', 'desc'), limit(1))));
  await assertFails(updateDoc(doc(client('owner'), 'watchPhonebookRequests', id), { phone: '+23050000002' }));
  await assertFails(deleteDoc(doc(client('owner'), 'watchPhonebookRequests', id)));
});

test('real transactions allocate once and reject another change while holding the device lease', async () => {
  const id = `request${++seq}`; await assertSucceeds(write('owner', input(), id));
  let entered, finish, sends = 0;
  const ready = new Promise(resolve => { entered = resolve; });
  const send = async value => { sends++; assert.equal(value.slot, 2); entered(); return new Promise(resolve => { finish = resolve; }); };
  const first = processWatchPhonebookRequest(db, id, { send }); await ready;
  await processWatchPhonebookRequest(db, id, { send: () => assert.fail('no duplicate write') });
  const id2 = `request${++seq}`; await assertSucceeds(write('owner', { ...input(), phone: '+23050000002' }, id2));
  assert.equal((await processWatchPhonebookRequest(db, id2, { send: () => assert.fail('no concurrent write') })).outcome, 'change_in_progress');
  await db.doc(`watchCallPolicies/${imei}`).set(callPolicy());
  await db.doc('watchCallRequests/manual').set(callRequest('manual'));
  assert.equal((await processWatchCallRequest(db, 'manual', { send: () => assert.fail('no overlapping Calls write') })).outcome, 'change_in_progress');
  finish({ outcome: 'device_replied' }); await first;
  assert.equal(sends, 1);
  const state = (await db.doc(`watchPhonebookSettings/${imei}`).get()).data();
  assert.equal(state.contacts.length, 2); assert.equal(state.contacts[1].status, 'device_replied');
  assert.equal(state.contacts[1].appliedStateVerified, false);
});

test('a combined profile/contact-request save is atomic and cannot turn directory fields into watch authority', async () => {
  const { writeBatch } = require('firebase/firestore');
  const viewer = client('viewer');
  const batch = writeBatch(viewer);
  batch.update(doc(viewer, 'users', 'viewer'), {
    contactDirectory: [{ name: 'Friend', phone: '+23050000003', allowCalls: true }],
    emergencyContacts: [{ name: 'Friend', phone: '+23050000003' }],
  });
  batch.set(doc(viewer, 'watchPhonebookRequests', 'combined-forged'), input('viewer'));
  await assertFails(batch.commit());
  assert.equal((await db.doc('users/viewer').get()).data().contactDirectory, undefined);
  await assertSucceeds(updateDoc(doc(viewer, 'users', 'viewer'), {
    contactDirectory: [{ name: 'Friend', phone: '+23050000003' }],
  }));
  assert.equal((await db.doc('watchPhonebookRequests/combined-forged').get()).exists, false);
  await assertFails(updateDoc(doc(client('outsider'), 'users', 'viewer'), { contactDirectory: [] }));
});
