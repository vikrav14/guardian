const { test, before, after } = require('node:test');
const { readFileSync } = require('node:fs');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, deleteDoc } = require('firebase/firestore');
let env;
const imei = '359633100123456';
before(async () => {
  env = await initializeTestEnvironment({ projectId: 'guardian-home-wifi-enrollment-rules',
    firestore: { rules: readFileSync('rules.example', 'utf8') } });
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users', 'owner'), { linkedImeis: [imei] });
    await setDoc(doc(db, 'devices', imei), { nickname: 'Watch', homeWifiPresence: null });
    await setDoc(doc(db, 'homeWifiEnrollments', imei), { ownerUid: 'owner', version: 1,
      enabled: true, name: 'Private home', routerHash: 'ab'.repeat(32), hashKey: 'cd'.repeat(32) });
  });
});
after(async () => env?.cleanup());
test('radio enrollment secrets and writes are denied even to a linked owner or admin client', async () => {
  for (const ctx of [env.authenticatedContext('owner'), env.authenticatedContext('stranger'),
    env.authenticatedContext('admin', { admin: true }), env.unauthenticatedContext()]) {
    const ref = doc(ctx.firestore(), 'homeWifiEnrollments', imei);
    await assertFails(getDoc(ref));
    await assertFails(setDoc(ref, { enabled: true, routerHash: 'forged' }));
    await assertFails(deleteDoc(ref));
  }
  await assertSucceeds(getDoc(doc(env.authenticatedContext('owner').firestore(), 'devices', imei)));
});
