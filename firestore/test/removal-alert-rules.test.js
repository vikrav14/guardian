'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { after, before, test } = require('node:test');
const {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc } = require('firebase/firestore');

const projectId = 'guardian-removal-alert-rules-test';
const testImei = '999999999999999';
let testEnv;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: fs.readFileSync(path.join(__dirname, '..', 'rules.example'), 'utf8'),
    },
  });
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    for (const [uid, plan] of [['family-user', 'family'], ['essential-user', 'essential']]) {
      await setDoc(doc(db, 'users', uid), {
        serviceOwnerUid: uid,
        linkedImeis: [testImei],
      });
      await setDoc(doc(db, 'serviceSubscriptions', uid), {
        version: 1,
        managedBy: 'guardian_admin',
        plan,
        status: 'active',
      });
    }
    await setDoc(doc(db, 'users', 'unlinked-user'), {
      serviceOwnerUid: 'unlinked-user',
      linkedImeis: [],
    });
    await setDoc(doc(db, 'serviceSubscriptions', 'unlinked-user'), {
      version: 1,
      managedBy: 'guardian_admin',
      plan: 'family',
      status: 'active',
    });
    await setDoc(doc(db, 'devices', testImei, 'safetyStates', 'watchRemoval'), {
      imei: testImei,
      state: 'removed',
      mode: 'accepted',
      displayable: true,
    });
    await setDoc(doc(db, 'removalAlertAudit', 'event-1'), {
      imei: testImei,
      eventType: 'watch_removed',
    });
  });
});

after(async () => testEnv.cleanup());

test('Family may read backend-owned removal state and audit', async () => {
  const db = testEnv.authenticatedContext('family-user').firestore();
  await assertSucceeds(getDoc(doc(db, 'devices', testImei, 'safetyStates', 'watchRemoval')));
  await assertSucceeds(getDoc(doc(db, 'removalAlertAudit', 'event-1')));
});

test('Essential and unlinked users cannot read removal evidence', async () => {
  for (const uid of ['essential-user', 'unlinked-user']) {
    const db = testEnv.authenticatedContext(uid).firestore();
    await assertFails(getDoc(doc(db, 'devices', testImei, 'safetyStates', 'watchRemoval')));
    await assertFails(getDoc(doc(db, 'removalAlertAudit', 'event-1')));
  }
});

test('linked Family client cannot forge removal state or audit', async () => {
  const db = testEnv.authenticatedContext('family-user').firestore();
  await assertFails(setDoc(
    doc(db, 'devices', testImei, 'safetyStates', 'watchRemoval'),
    { state: 'worn' },
  ));
  await assertFails(setDoc(
    doc(db, 'removalAlertAudit', 'forged'),
    { imei: testImei, eventType: 'watch_removed' },
  ));
});
