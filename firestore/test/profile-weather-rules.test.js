'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { before, after, test } = require('node:test');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, setDoc, updateDoc, deleteDoc, getDoc } = require('firebase/firestore');

const imei = '359633100123456';
let env;
before(async () => {
  env = await initializeTestEnvironment({ projectId: 'guardian-profile-weather-rules-test',
    firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'rules.example'), 'utf8') } });
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'users', 'owner'), { linkedImeis: [imei], serviceOwnerUid: 'owner' });
    await setDoc(doc(db, 'users', 'linked'), { linkedImeis: [imei], serviceOwnerUid: 'owner' });
    await setDoc(doc(db, 'users', 'unrelated'), { linkedImeis: [], serviceOwnerUid: 'unrelated' });
    await setDoc(doc(db, 'devices', imei), { imei });
    await setDoc(doc(db, 'devices', imei, 'weather', 'current'), {
      schemaVersion: 1, state: 'available', condition: 'rain', temperatureC: 24,
    });
  });
});
after(async () => { await env?.cleanup(); });

test('profile weather is readable only by linked authenticated guardians', async () => {
  for (const uid of ['owner', 'linked']) {
    await assertSucceeds(getDoc(doc(env.authenticatedContext(uid).firestore(), 'devices', imei, 'weather', 'current')));
  }
  await assertFails(getDoc(doc(env.authenticatedContext('unrelated').firestore(), 'devices', imei, 'weather', 'current')));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'devices', imei, 'weather', 'current')));
  await assertFails(getDoc(doc(env.authenticatedContext('linked').firestore(), 'devices', imei, 'weather', 'history')));
});

test('even a linked owner cannot create, replace, change or remove weather evidence', async () => {
  const db = env.authenticatedContext('owner').firestore();
  const ref = doc(db, 'devices', imei, 'weather', 'current');
  await assertFails(setDoc(ref, { state: 'available', temperatureC: 30 }));
  await assertFails(updateDoc(ref, { expiresAt: '2099-01-01T00:00:00Z' }));
  await assertFails(deleteDoc(ref));
  await assertFails(setDoc(doc(db, 'devices', imei, 'weather', 'forged'), { state: 'available' }));
  await assertFails(setDoc(doc(db, 'devices', 'another-watch', 'weather', 'current'), { state: 'available' }));
});
