'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, getDoc, getDocs, collection, query, where, orderBy, limit, setDoc, updateDoc, deleteDoc, serverTimestamp, Timestamp } = require('firebase/firestore');
const admin = require('../../gateway/node_modules/firebase-admin');
const { processWatchCallRequest } = require('../../gateway/src/watch-calls');
const { imei, phone, callPolicy, callRequest } = require('../../gateway/test-fixtures/watch-call-fixture');

let env, app, db, sequence = 0;
before(async () => {
  const projectId = 'guardian-watch-calls-test';
  env = await initializeTestEnvironment({ projectId, firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'rules.example'), 'utf8') } });
  app = admin.initializeApp({ projectId }, projectId); db = app.firestore();
  await db.doc(`watchCallPolicies/${imei}`).set(callPolicy());
  await db.doc(`watchCallSettings/${imei}`).set({ configured: true, autoAvailable: true, policyRevision: 'revision-1' });
  for (const uid of ['owner', 'care', 'inactive', 'legacy', 'member', 'forged-member']) {
    await db.doc(`users/${uid}`).set({ linkedImeis: [imei], ...(['member', 'forged-member'].includes(uid) ? { serviceOwnerUid: 'owner' } : {}) });
    await db.doc(`serviceSubscriptions/${uid}`).set({ version: 1, managedBy: 'guardian_admin', status: uid === 'inactive' ? 'expired' : 'active',
      plan: uid === 'legacy' ? 'essential' : uid === 'care' ? 'care' : 'family' });
  }
  await db.doc('users/owner').update({ memberUids: ['member'], familyMembers: [{ uid: 'forged-member' }] });
  await db.doc('users/unlinked').set({ linkedImeis: [] });
});
after(async () => { await app?.delete(); await env?.cleanup(); });

function input(uid = 'owner', mode = 'auto') {
  return { ...callRequest(mode), requestedBy: uid, createdAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 60000) };
}
function write(uid, value, id = `request${++sequence}`) {
  return setDoc(doc(env.authenticatedContext(uid).firestore(), 'watchCallRequests', id), value);
}

test('linked Family, Care and verified family members can explicitly request Auto', async () => {
  for (const uid of ['owner', 'care', 'member']) await assertSucceeds(write(uid, input(uid)));
  for (const uid of ['inactive', 'legacy', 'unlinked', 'forged-member']) await assertFails(write(uid, input(uid)));
  const anonymous = env.unauthenticatedContext().firestore();
  await assertFails(setDoc(doc(anonymous, 'watchCallRequests', 'anonymous'), input()));
});

test('requests cannot forge identity, inject commands, omit consent, linger offline or use old caller configuration', async () => {
  for (const patch of [
    { requestedBy: 'member' }, { imei: '861397000000001' }, { status: 'socket_handoff' },
    { phone }, { frameHex: 'abcd' }, { mode: 'sos' }, { mode: 'raw' }, { consentAccepted: false },
    { policyRevision: 'obsolete' }, { createdAt: Timestamp.fromMillis(Date.now() - 60000) },
    { expiresAt: Timestamp.fromMillis(Date.now() - 1) }, { expiresAt: Timestamp.fromMillis(Date.now() + 600000) },
  ]) await assertFails(write('owner', { ...input(), ...patch }));
  await assertFails(setDoc(doc(env.authenticatedContext('owner').firestore(), 'deviceCommands', 'answer-bypass'), {
    imei, type: 'set_watch_answer_mode', params: { mode: 'auto' }, createdBy: 'owner', status: 'pending', createdAt: serverTimestamp(),
  }));
});

test('policies are private and app users cannot forge status, request edits or delete audit evidence', async () => {
  const client = env.authenticatedContext('owner').firestore();
  await assertFails(getDoc(doc(client, 'watchCallPolicies', imei)));
  await assertFails(setDoc(doc(client, 'watchCallPolicies', imei), callPolicy()));
  await assertSucceeds(getDoc(doc(client, 'watchCallSettings', imei)));
  await assertFails(updateDoc(doc(client, 'watchCallSettings', imei), { lastHandoffMode: 'auto' }));
  await assertFails(getDoc(doc(env.authenticatedContext('unlinked').firestore(), 'watchCallSettings', imei)));
  const id = `request${++sequence}`;
  await assertSucceeds(write('owner', input(), id));
  await assertSucceeds(getDoc(doc(client, 'watchCallRequests', id)));
  await assertSucceeds(getDocs(query(collection(client, 'watchCallRequests'), where('imei', '==', imei), orderBy('createdAt', 'desc'), limit(1))));
  await assertFails(updateDoc(doc(client, 'watchCallRequests', id), { mode: 'manual' }));
  await assertFails(deleteDoc(doc(client, 'watchCallRequests', id)));
});

test('real transactions claim each request once and retain private frames only in policy', async () => {
  await db.doc(`watchCallSettings/${imei}`).set({ configured: true });
  const id = `request${++sequence}`;
  await assertSucceeds(write('owner', input(), id));
  let sends = 0;
  const send = () => { sends++; return { outcome: 'socket_handoff', frame: phone }; };
  await Promise.all([processWatchCallRequest(db, id, { send }), processWatchCallRequest(db, id, { send })]);
  assert.equal(sends, 1);
  const result = (await db.doc(`watchCallRequests/${id}`).get()).data();
  const state = (await db.doc(`watchCallSettings/${imei}`).get()).data();
  assert.equal(result.status, 'socket_handoff'); assert.equal(state.lastHandoffMode, 'auto');
  assert.equal(result.appliedStateVerified, false);
  assert.ok(!JSON.stringify([result, state]).includes(phone));
});

test('backend rejects expired and unlinked requests even when created through Admin SDK', async () => {
  for (const patch of [{ expiresAt: new Date(Date.now() - 1) }, { requestedBy: 'unlinked' }, { consentAccepted: false }]) {
    const id = `request${++sequence}`;
    await db.doc(`watchCallRequests/${id}`).set({ ...callRequest(), ...patch });
    await processWatchCallRequest(db, id, { send: () => assert.fail('must not send') });
    assert.equal((await db.doc(`watchCallRequests/${id}`).get()).data().status, 'not_sent');
  }
});

test('Manual restoration is authorized after plan expiry or Auto disablement', async () => {
  await db.doc(`watchCallPolicies/${imei}`).update({ autoEnabled: false });
  await assertFails(write('owner', input()));
  const id = `request${++sequence}`;
  await assertSucceeds(write('inactive', input('inactive', 'manual'), id));
  let sends = 0;
  await processWatchCallRequest(db, id, { send: request => {
    sends++; assert.equal(request.mode, 'manual'); return { outcome: 'socket_handoff' };
  } });
  assert.equal(sends, 1);
  assert.equal((await db.doc(`watchCallSettings/${imei}`).get()).data().lastHandoffMode, 'manual');
});
