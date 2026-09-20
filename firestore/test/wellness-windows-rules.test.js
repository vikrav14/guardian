'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { before, after, test } = require('node:test');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, setDoc, updateDoc, getDoc, getDocs, collection, query, where, orderBy } = require('firebase/firestore');
const { wellnessDayStart } = require('../../gateway/src/wellness-access');
const imei = '359633100123456';
const day = 86_400_000;
const hour = 3_600_000;
let env, today, tomorrow;
before(async () => {
  const now = new Date();
  today = wellnessDayStart(now);
  tomorrow = new Date(+today + day);
  env = await initializeTestEnvironment({ projectId: 'guardian-wellness-window-test',
    firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'rules.example'), 'utf8') } });
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    for (const plan of ['essential', 'family', 'care']) {
      await setDoc(doc(db, 'users', plan), { linkedImeis: [imei] });
      await setDoc(doc(db, 'serviceSubscriptions', plan), { version: 1, managedBy: 'guardian_admin', status: 'active', plan });
    }
    await setDoc(doc(db, 'users', 'unlinked'), { linkedImeis: [] });
    for (const [id, offset] of [['today', 0], ['yesterday', -1], ['oldestFamily', -6], ['tooOldFamily', -7], ['oldCare', -400], ['future', 1]]) {
      await setDoc(doc(db, 'devices', imei, 'activityDays', id), { displayable: true,
        reportedSteps: 100, lastObservedAt: new Date(+today + offset * day) });
    }
    // Rules use 25/169-hour envelopes around the app's calendar queries.
    // Yesterday and day -7 are inside those envelopes just after Mauritius
    // midnight, so use clock-relative fixtures to test the authorization limit.
    for (const [id, ageHours] of [
      ['insideEssentialEnvelope', 24], ['outsideEssentialEnvelope', 26],
      ['insideFamilyEnvelope', 168], ['outsideFamilyEnvelope', 170],
    ]) {
      await setDoc(doc(db, 'devices', imei, 'activityDays', id), { displayable: true,
        reportedSteps: 100, lastObservedAt: new Date(+now - ageHours * hour) });
    }
    await setDoc(doc(db, 'devices', imei, 'activityDays', 'shadow'), { displayable: false, lastObservedAt: today });
  });
});
after(async () => env?.cleanup());
const dbFor = user => env.authenticatedContext(user).firestore();
const record = (user, id) => getDoc(doc(dbFor(user), 'devices', imei, 'activityDays', id));
test('activity reads enforce legacy Essential and Family retention envelopes; Care retains history', async () => {
  await assertSucceeds(record('essential', 'today'));
  await assertSucceeds(record('essential', 'insideEssentialEnvelope'));
  await assertFails(record('essential', 'outsideEssentialEnvelope'));
  await assertSucceeds(record('family', 'oldestFamily'));
  await assertSucceeds(record('family', 'insideFamilyEnvelope'));
  await assertFails(record('family', 'outsideFamilyEnvelope'));
  await assertSucceeds(record('care', 'oldCare'));
  for (const plan of ['essential', 'family', 'care']) {
    await assertFails(record(plan, 'future'));
    await assertFails(record(plan, 'shadow'));
  }
  await assertFails(record('unlinked', 'today'));
});
test('bounded production queries succeed; unbounded history cannot bypass the plan', async () => {
  for (const [plan, offset] of [['essential', 0], ['family', -6], ['care', -400]]) {
    const base = collection(dbFor(plan), 'devices', imei, 'activityDays');
    await assertSucceeds(getDocs(query(base, where('displayable', '==', true),
      where('lastObservedAt', '>=', new Date(+today + offset * day)),
      where('lastObservedAt', '<', tomorrow), orderBy('lastObservedAt', 'desc'))));
    await assertFails(getDocs(query(base, where('displayable', '==', true))));
  }
});
test('downgrade and expiry remove historical read authority', async () => {
  await env.withSecurityRulesDisabled(async context => {
    await updateDoc(doc(context.firestore(), 'serviceSubscriptions', 'care'), { plan: 'essential' });
  });
  await assertFails(record('care', 'oldCare'));
  await assertSucceeds(record('care', 'today'));
  await env.withSecurityRulesDisabled(async context => {
    await updateDoc(doc(context.firestore(), 'serviceSubscriptions', 'care'), { status: 'cancelled', currentPeriodEnd: new Date(Date.now() - 1000) });
  });
  await assertFails(record('care', 'today'));
});
