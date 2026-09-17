'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { before, after, test } = require('node:test');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, setDoc, updateDoc, getDoc, getDocs, collection, query, where, orderBy } = require('firebase/firestore');
const { wellnessDayStart } = require('../../gateway/src/wellness-access');

const imei = '359633100123456';
let env, today;

before(async () => {
  const created = new Date();
  today = wellnessDayStart(created);
  env = await initializeTestEnvironment({ projectId: 'guardian-wellness-customer-test',
    firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'rules.example'), 'utf8') } });
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    for (const [uid, plan] of [['care', 'care'], ['family', 'family'], ['essential', 'essential'], ['other', 'care']]) {
      await setDoc(doc(db, 'users', uid), { linkedImeis: [imei] });
      await setDoc(doc(db, 'serviceSubscriptions', uid), {
        version: 1, managedBy: 'guardian_admin', status: 'active', plan,
      });
    }
    await setDoc(doc(db, 'wellbeingConsents', imei), {
      version: 1, managedBy: 'guardian_admin', status: 'granted',
      wearerAcknowledgedAt: today,
    });
    await setDoc(doc(db, 'devices', imei, 'wellbeingReadings', 'estimate'), {
      metricSet: 'spo2', values: { spo2Percent: 98 },
      displayable: false, quality: 'transport_valid_unverified', observedAt: today,
    });
    await setDoc(doc(db, 'devices', imei, 'activityDays', 'today'), {
      schemaVersion: 2, aggregation: 'observed_delta', localDate: today.toISOString().slice(0, 10),
      recordedSteps: 120, displayable: false, lastObservedAt: today,
    });
  });
});

after(async () => env?.cleanup());

const read = (uid, kind, id) => getDoc(doc(
  env.authenticatedContext(uid).firestore(), 'devices', imei, kind, id,
));

test('Care access is permanent and requires only the linked active plan plus consent', async () => {
  await assertSucceeds(read('care', 'wellbeingReadings', 'estimate'));
  await assertSucceeds(read('care', 'activityDays', 'today'));
  await assertFails(read('family', 'wellbeingReadings', 'estimate'));
  await assertFails(read('essential', 'wellbeingReadings', 'estimate'));
  await assertSucceeds(read('family', 'activityDays', 'today'));
  await assertSucceeds(read('essential', 'activityDays', 'today'));
  await assertSucceeds(read('other', 'wellbeingReadings', 'estimate'));
});

test('wellbeing queries remain bounded by the Care calendar window', async () => {
  const base = collection(env.authenticatedContext('care').firestore(),
    'devices', imei, 'wellbeingReadings');
  await assertSucceeds(getDocs(query(
    base,
    where('observedAt', '>=', today),
    where('observedAt', '<', new Date(+today + 86400_000)),
    orderBy('observedAt', 'desc'),
  )));
  await assertFails(getDocs(base));
});

test('consent, membership and subscription access still block wellbeing', async () => {
  await env.withSecurityRulesDisabled(c => updateDoc(
    doc(c.firestore(), 'wellbeingConsents', imei), { status: 'revoked' },
  ));
  await assertFails(read('care', 'wellbeingReadings', 'estimate'));
  await assertSucceeds(read('care', 'activityDays', 'today'));
  await env.withSecurityRulesDisabled(async c => {
    await updateDoc(doc(c.firestore(), 'wellbeingConsents', imei), { status: 'granted' });
    await updateDoc(doc(c.firestore(), 'users', 'care'), { linkedImeis: [] });
  });
  await assertFails(read('care', 'wellbeingReadings', 'estimate'));
  await assertFails(read('care', 'activityDays', 'today'));
});

test('customers cannot write readings or activity evidence', async () => {
  await assertFails(setDoc(doc(env.authenticatedContext('care').firestore(),
    'devices', imei, 'wellbeingReadings', 'forged'), { displayable: true }));
  await assertFails(updateDoc(doc(env.authenticatedContext('care').firestore(),
    'devices', imei, 'activityDays', 'today'), { displayable: true }));
});
