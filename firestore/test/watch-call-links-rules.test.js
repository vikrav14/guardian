'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { before, after, test } = require('node:test');
const { initializeTestEnvironment, assertFails } = require('@firebase/rules-unit-testing');
const { doc, getDoc, getDocs, collection, setDoc, updateDoc, deleteDoc } = require('firebase/firestore');
let env;
before(async () => {
  env = await initializeTestEnvironment({ projectId: 'guardian-call-links-test',
    firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'rules.example'), 'utf8') } });
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'users', 'owner'), { linkedImeis: ['861397000000000'] });
    await setDoc(doc(db, 'watchCallLinks', 'hash'), { imei: '861397000000000', guardianUid: 'owner' });
  });
});
after(async () => env?.cleanup());
test('even a linked owner cannot read, enumerate, mint or edit call links directly', async () => {
  for (const db of [env.authenticatedContext('owner').firestore(), env.unauthenticatedContext().firestore()]) {
    const ref = doc(db, 'watchCallLinks', 'hash');
    await assertFails(getDoc(ref));
    await assertFails(getDocs(collection(db, 'watchCallLinks')));
    await assertFails(setDoc(ref, { guardianUid: 'owner' }));
    await assertFails(updateDoc(ref, { simHash: 'forged' }));
    await assertFails(deleteDoc(ref));
  }
});
