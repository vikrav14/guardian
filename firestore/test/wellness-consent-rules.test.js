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
  today = wellnessDayStart();
  env = await initializeTestEnvironment({ projectId: 'guardian-wellness-consent-test',
    firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'rules.example'), 'utf8') } });
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    for (const plan of ['essential', 'family', 'care']) {
      await setDoc(doc(db, 'users', plan), { linkedImeis: [imei] });
      await setDoc(doc(db, 'serviceSubscriptions', plan), { version: 1, managedBy: 'guardian_admin', status: 'active', plan });
    }
    await setDoc(doc(db, 'wellbeingConsents', imei), { version: 1, managedBy: 'guardian_admin', status: 'granted', wearerAcknowledgedAt: new Date(+today - 86_400_000) });
    for (const [id, offset] of [['today', 0], ['yesterday', -1], ['seventh', -6], ['eighth', -7], ['old', -400]]) {
      await setDoc(doc(db, 'devices', imei, 'wellbeingReadings', id), { displayable: true, observedAt: new Date(+today + offset * 86_400_000) });
    }
    await setDoc(doc(db, 'devices', imei, 'wellbeingReadings', 'shadow'), { displayable: false, observedAt: today });
  });
});
after(async () => env?.cleanup());
const read = (plan, id) => getDoc(doc(env.authenticatedContext(plan).firestore(), 'devices', imei, 'wellbeingReadings', id));
test('Care can read consented history; lower editions cannot read wellbeing', async () => {
  await assertSucceeds(read('care', 'today'));
  await assertFails(read('care', 'shadow'));
  await assertFails(read('essential', 'today'));
  await assertFails(read('family', 'today'));
  await assertFails(read('essential', 'yesterday'));
  await assertFails(read('family', 'seventh'));
  await assertFails(read('family', 'eighth'));
  await assertSucceeds(read('care', 'old'));
  await assertFails(read('unlinked', 'today'));
});
test('Care date-bounded queries work and lower editions remain blocked', async () => {
  const base = collection(env.authenticatedContext('care').firestore(), 'devices', imei, 'wellbeingReadings');
  await assertSucceeds(getDocs(query(base, where('displayable', '==', true),
      where('observedAt', '>=', new Date(+today - 400 * 86_400_000)),
      where('observedAt', '<', new Date(+today + 86_400_000)), orderBy('observedAt', 'desc'))));
  await assertFails(getDocs(query(base, where('displayable', '==', true))));
  for (const plan of ['essential', 'family']) {
    const lowerDb = collection(env.authenticatedContext(plan).firestore(), 'devices', imei, 'wellbeingReadings');
    await assertFails(getDocs(query(lowerDb, where('displayable', '==', true),
      where('observedAt', '>=', today), where('observedAt', '<', new Date(+today + 86_400_000)),
      orderBy('observedAt', 'desc'))));
  }
});
test('consent revocation closes every edition and clients cannot restore it', async () => {
  await env.withSecurityRulesDisabled(async context => updateDoc(doc(context.firestore(), 'wellbeingConsents', imei), { status: 'revoked', revokedAt: new Date() }));
  for (const plan of ['essential', 'family', 'care']) {
    await assertFails(read(plan, 'today'));
    await assertFails(updateDoc(doc(env.authenticatedContext(plan).firestore(), 'wellbeingConsents', imei), { status: 'granted' }));
  }
});
