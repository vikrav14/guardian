'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { before, after, test } = require('node:test');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, setDoc, updateDoc, getDoc, deleteField } = require('firebase/firestore');

const imei = '359633100123456';
let env;
const homeWifiPresence = require('../../docs/testing/wifi-home-display.json')[0].device.homeWifiPresence;
before(async () => {
  env = await initializeTestEnvironment({ projectId: 'guardian-home-wifi-rules-test',
    firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'rules.example'), 'utf8') } });
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'users', 'linked'), { linkedImeis: [imei] });
    await setDoc(doc(db, 'devices', imei), { imei, nickname: 'Test wearer', homeWifiPresence });
  });
});
after(async () => { await env.cleanup(); });

test('only linked authenticated caregivers can read Home evidence', async () => {
  await assertSucceeds(getDoc(doc(env.authenticatedContext('linked').firestore(), 'devices', imei)));
  await assertFails(getDoc(doc(env.authenticatedContext('unrelated').firestore(), 'devices', imei)));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'devices', imei)));
});

test('clients cannot forge, replace or erase backend Home evidence while profile edits still work', async () => {
  const db = env.authenticatedContext('linked').firestore();
  const ref = doc(db, 'devices', imei);
  await assertFails(updateDoc(ref, { homeWifiPresence: { ...homeWifiPresence, expiresAt: '2099-01-01T00:00:00Z' } }));
  await assertFails(updateDoc(ref, { 'homeWifiPresence.anchor.lat': -21 }));
  await assertFails(updateDoc(ref, { homeWifiPresence: deleteField() }));
  await assertFails(setDoc(doc(db, 'devices', 'another-watch'), { homeWifiPresence }));
  await assertSucceeds(updateDoc(ref, { nickname: 'Test name' }));
});
