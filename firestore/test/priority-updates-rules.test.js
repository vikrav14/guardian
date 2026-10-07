'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { before, after, test } = require('node:test');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, setDoc, getDoc, updateDoc, deleteDoc } = require('firebase/firestore');
const imei = '359633100123456';
let env;
before(async () => {
  env = await initializeTestEnvironment({ projectId: 'guardian-priority-updates-test',
    firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'rules.example'), 'utf8') } });
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    const members = {
      owner: { status: 'active' }, viewer: { status: 'active', permissions: { location: true } },
      alerts: { status: 'active', permissions: { alerts: true } },
      revoked: { status: 'revoked', permissions: { location: true } },
      expired: { status: 'active', permissions: { location: true }, untilMs: 1 },
    };
    for (const uid of Object.keys(members)) await setDoc(doc(db, 'users', uid), { linkedImeis: [imei] });
    await setDoc(doc(db, 'familyServices', imei), { ownerUid: 'owner', members,
      subscription: { version: 1, managedBy: 'guardian_admin', plan: 'family', status: 'active' } });
    await setDoc(doc(db, 'devices', imei, 'localUpdates', 'current'), { schemaVersion: 1, items: [] });
    await setDoc(doc(db, 'devices', 'another-watch', 'localUpdates', 'current'), { schemaVersion: 1, items: [] });
    await setDoc(doc(db, 'familyServices', 'inactive-watch'), { ownerUid: 'owner', members,
      subscription: { version: 1, managedBy: 'guardian_admin', plan: 'family', status: 'expired' } });
    await setDoc(doc(db, 'devices', 'inactive-watch', 'localUpdates', 'current'), { schemaVersion: 1, items: [] });
  });
});
after(async () => { await env?.cleanup(); });
const ref = (db, id = imei, key = 'current') => doc(db, 'devices', id, 'localUpdates', key);
test('current local updates require active Family membership and location permission', async () => {
  for (const uid of ['owner', 'viewer']) await assertSucceeds(getDoc(ref(env.authenticatedContext(uid).firestore())));
  for (const uid of ['alerts', 'revoked', 'expired', 'unrelated']) await assertFails(getDoc(ref(env.authenticatedContext(uid).firestore())));
  await assertFails(getDoc(ref(env.unauthenticatedContext().firestore())));
  const db = env.authenticatedContext('owner').firestore();
  await assertFails(getDoc(ref(db, 'another-watch')));
  await assertFails(getDoc(ref(db, 'inactive-watch')));
  await assertFails(getDoc(ref(db, imei, 'history')));
});
test('even owners cannot invent, refresh or delete safety reports', async () => {
  const db = env.authenticatedContext('owner').firestore();
  await assertFails(setDoc(ref(db), { schemaVersion: 1, items: [] }));
  await assertFails(updateDoc(ref(db), { expiresAt: '2099-01-01T00:00:00Z' }));
  await assertFails(deleteDoc(ref(db)));
  await assertFails(setDoc(ref(db, imei, 'forged'), { items: [] }));
});
