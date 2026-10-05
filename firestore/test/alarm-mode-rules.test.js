const fs = require('node:fs');
const path = require('node:path');
const { after, before, test } = require('node:test');

const {
  assertFails,
  initializeTestEnvironment,
} = require('@firebase/rules-unit-testing');
const { doc, serverTimestamp, setDoc, getDoc, deleteDoc } = require('firebase/firestore');

const projectId = 'guardian-alarm-mode-rules-test';
const imei = '999999999999999';
let testEnv;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: fs.readFileSync(
        path.join(__dirname, '..', 'rules.example'),
        'utf8',
      ),
    },
  });

  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'users', 'linked-user'), {
      serviceOwnerUid: 'linked-user',
      linkedImeis: [imei],
    });
  });
});

after(async () => {
  await testEnv.cleanup();
});

test('linked clients cannot change the physical V52 SOS alarm mode', async () => {
  const db = testEnv.authenticatedContext('linked-user').firestore();
  await assertFails(
    setDoc(doc(db, 'deviceCommands', 'alarm-mode-attempt'), {
      imei,
      type: 'set_alarm_mode',
      params: { mode: 0 },
      status: 'pending',
      createdBy: 'linked-user',
      createdAt: serverTimestamp(),
    }),
  );
});

test('clients cannot impersonate the operator or read/reset newest-command watermarks', async () => {
  for (const uid of ['linked-user', 'operator:queue-v52-alarm-mode']) {
    const db = testEnv.authenticatedContext(uid).firestore();
    await assertFails(setDoc(doc(db, 'deviceCommands', 'spoof-operator'), {
      imei, type: 'set_alarm_mode', params: { mode: 0 }, status: 'pending',
      createdBy: 'operator:queue-v52-alarm-mode', createdAt: serverTimestamp(),
    }));
    const ref = doc(db, 'deviceCommandIntents', 'test-key');
    await assertFails(getDoc(ref));
    await assertFails(setDoc(ref, { commandId: 'old', createdAtMs: 0 }));
    await assertFails(deleteDoc(ref));
  }
});
