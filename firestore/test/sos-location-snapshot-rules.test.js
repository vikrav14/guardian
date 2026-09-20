'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { before, after, test } = require('node:test');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, setDoc, updateDoc, serverTimestamp } = require('firebase/firestore');

const projectId = 'guardian-sos-rules-test';
const imei = '999999999999999';
let env;
const snapshot = {
  version: 1, policy: 'map_retained_satellite_v1',
  capturedAt: new Date('2026-09-01T12:00:00Z'),
  state: 'last_known', retainedSatellite: true,
  location: { lat: -20.1, lng: 57.1, source: 'gps' },
};

before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'rules.example'), 'utf8') },
  });
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'users', 'linked'), { linkedImeis: [imei] });
    await setDoc(doc(context.firestore(), 'alerts', 'backend-sos'), {
      imei, type: 'sos', severity: 'critical', resolved: false,
      notifyStatus: 'pending', sosLocationSnapshot: snapshot,
    });
  });
});

after(async () => { await env.cleanup(); });

function appSos() {
  return { imei, type: 'sos', severity: 'critical', message: 'Help requested',
    resolved: false, notifyStatus: 'pending', payload: { source: 'app' },
    createdAt: serverTimestamp() };
}

test('linked app SOS creation remains allowed without a forged backend snapshot', async () => {
  const db = env.authenticatedContext('linked').firestore();
  await assertSucceeds(setDoc(doc(db, 'alerts', 'app-sos'), appSos()));
});

test('clients cannot manufacture backend-owned SOS location evidence', async () => {
  const db = env.authenticatedContext('linked').firestore();
  await assertFails(setDoc(doc(db, 'alerts', 'forged-sos'), {
    ...appSos(), sosLocationSnapshot: snapshot,
  }));
});

test('clients can resolve an SOS but cannot change or remove its frozen location', async () => {
  const db = env.authenticatedContext('linked').firestore();
  const ref = doc(db, 'alerts', 'backend-sos');
  await assertFails(updateDoc(ref, { 'sosLocationSnapshot.location.lat': -21 }));
  await assertFails(updateDoc(ref, { sosLocationSnapshot: null }));
  await assertSucceeds(updateDoc(ref, { resolved: true, resolvedAt: serverTimestamp() }));
});

test('unrelated clients cannot read the frozen location', async () => {
  const { getDoc } = require('firebase/firestore');
  const db = env.authenticatedContext('unrelated').firestore();
  await assertFails(getDoc(doc(db, 'alerts', 'backend-sos')));
});
