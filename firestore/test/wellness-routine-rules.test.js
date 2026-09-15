'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { before, after, test } = require('node:test');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, setDoc, getDoc, serverTimestamp } = require('firebase/firestore');
const imei = '359633100123456';
let env;
before(async () => {
  env = await initializeTestEnvironment({ projectId: 'guardian-wellness-routine-test',
    firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'rules.example'), 'utf8') } });
});
after(async () => env?.cleanup());
async function seed(plan = 'essential', { consent = 'granted', grant = true, linked = true, status = 'active' } = {}) {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async c => {
    const db = c.firestore(), now = new Date();
    for (const uid of ['pilot', 'other']) {
      await setDoc(doc(db, 'users', uid), { linkedImeis: linked ? [imei] : [] });
      await setDoc(doc(db, 'serviceSubscriptions', uid), { version: 1, managedBy: 'guardian_admin', plan, status });
    }
    await setDoc(doc(db, 'wellnessPilots', imei), { version: 1, managedBy: 'guardian_admin',
      viewerUid: 'pilot', enabled: grant, createdAt: now, expiresAt: new Date(+now + 3600_000) });
    await setDoc(doc(db, 'wellbeingConsents', imei), { version: 1, managedBy: 'guardian_admin',
      status: consent, wearerAcknowledgedAt: now });
    await setDoc(doc(db, 'devices', imei, 'wellnessRoutine', 'current'), { phase: 'blocked' });
  });
}
function write(uid = 'pilot', patch = {}) {
  return setDoc(doc(env.authenticatedContext(uid).firestore(), 'wellnessRoutineRequests', imei),
    { version: 1, routine: 'balanced', requestedBy: uid, updatedAt: serverTimestamp(), ...patch });
}
test('each edition can select only the three routines with explicit pilot permission', async () => {
  for (const plan of ['essential', 'family', 'care']) {
    await seed(plan);
    for (const routine of ['manual', 'gentle', 'balanced']) await assertSucceeds(write('pilot', { routine }));
    await assertFails(write('other'));
    await assertSucceeds(getDoc(doc(env.authenticatedContext('pilot').firestore(), 'devices', imei, 'wellnessRoutine', 'current')));
    await assertFails(setDoc(doc(env.authenticatedContext('pilot').firestore(), 'devices', imei, 'wellnessRoutine', 'current'), { phase: 'accepted' }));
  }
});
test('clients cannot inject commands, cadence, fake wearing or backdated timestamps', async () => {
  await seed();
  for (const patch of [{ routine: 'hourly' }, { routine: 'balanced,1' }, { intervalHours: 1 },
    { command: 'bodytemp2' }, { wearing: 'worn' }, { requestedBy: 'other' },
    { updatedAt: new Date('2020-01-01') }, { version: 2 }]) await assertFails(write('pilot', patch));
});
test('revocation blocks starts; Manual can still request stop with current linked pilot access', async () => {
  await seed('family', { consent: 'revoked' });
  await assertFails(write()); await assertSucceeds(write('pilot', { routine: 'manual' }));
  for (const values of [{ grant: false }, { linked: false }, { status: 'expired' }]) {
    await seed('family', values); await assertFails(write()); await assertFails(write('pilot', { routine: 'manual' }));
  }
});
