'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { before, after, test } = require('node:test');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, setDoc, getDoc, getDocs, collection, deleteDoc, serverTimestamp } = require('firebase/firestore');
const imei = '359633100123456';
let env;
before(async () => {
  env = await initializeTestEnvironment({ projectId: 'guardian-wear-check-test',
    firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'rules.example'), 'utf8') } });
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    for (const uid of ['essential', 'family', 'care', 'inactive', 'unlinked']) {
      await setDoc(doc(db, 'users', uid), { linkedImeis: uid === 'unlinked' ? [] : [imei] });
      await setDoc(doc(db, 'serviceSubscriptions', uid), { version: 1, managedBy: 'guardian_admin',
        status: uid === 'inactive' ? 'expired' : 'active', plan: ['family', 'care'].includes(uid) ? uid : 'essential' });
    }
  });
});
after(async () => env?.cleanup());
const db = uid => uid ? env.authenticatedContext(uid).firestore() : env.unauthenticatedContext().firestore();
const ref = (uid, id = 'current') => doc(db(uid), 'devices', imei, 'wearChecks', id);
const check = (uid, override = {}) => ({ version: 1, state: 'worn', observedAt: new Date(),
  recordedAt: serverTimestamp(), recordedBy: uid, ...override });

test('every active edition can save and read a dated family check, with an authentic recorder', async () => {
  for (const uid of ['essential', 'family', 'care']) {
    await assertSucceeds(setDoc(ref(uid), check(uid)));
    await assertSucceeds(getDoc(ref(uid)));
  }
});

test('unlinked, inactive and unauthenticated clients cannot read or write checks', async () => {
  for (const uid of ['unlinked', 'inactive', null]) {
    await assertFails(getDoc(ref(uid)));
    await assertFails(setDoc(ref(uid), check(uid)));
  }
});

test('manual checks reject stale queues, bad timestamps, forged identity and eligibility fields', async () => {
  for (const change of [
    { observedAt: new Date(Date.now() - 120_000) },
    { observedAt: new Date(Date.now() + 120_000) },
    { observedAt: 'today' }, { recordedAt: new Date(0) },
    { recordedBy: 'another-family-member' }, { state: 'confirmed_worn' },
    { eligible: true }, { deviceAccepted: true }, { version: 2 },
  ]) await assertFails(setDoc(ref('family'), check('family', change)));
  await assertFails(setDoc(ref('family', 'other'), check('family')));
  await assertFails(deleteDoc(ref('family')));
  await assertFails(getDocs(collection(db('family'), 'devices', imei, 'wearChecks')));
  // A manual check cannot write the sensor summary or inspect raw diagnostics.
  await assertFails(setDoc(doc(db('family'), 'devices', imei, 'wearStatus', 'current'),
    { version: 1, state: 'worn', deviceAccepted: true }));
  await assertFails(getDoc(doc(db('family'), 'devices', imei, 'wearDiagnostics', 'current')));
});

test('an earlier observation cannot replace a later family check', async () => {
  const observedAt = new Date();
  await assertSucceeds(setDoc(ref('family'), check('family', { observedAt, state: 'removed' })));
  await assertFails(setDoc(ref('family'), check('family', { observedAt: new Date(+observedAt - 1_000) })));
});
