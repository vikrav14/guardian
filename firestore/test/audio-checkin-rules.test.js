const fs = require('node:fs');
const path = require('node:path');
const { after, before, test } = require('node:test');

const {
  assertFails,
  initializeTestEnvironment,
} = require('@firebase/rules-unit-testing');
const { doc, setDoc } = require('firebase/firestore');

const projectId = 'guardian-audio-checkin-rules-test';
const testImei = '999999999999999';
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
    await setDoc(doc(context.firestore(), 'users', 'linked-guardian'), {
      serviceOwnerUid: 'linked-guardian',
      linkedImeis: [testImei],
    });
  });
});

after(async () => {
  await testEnv.cleanup();
});

test('linked clients cannot create privacy-sensitive voice monitor commands', async () => {
  const db = testEnv.authenticatedContext('linked-guardian').firestore();
  await assertFails(
    setDoc(doc(db, 'deviceCommands', 'monitor-attempt'), {
      imei: testImei,
      type: 'voice_monitor',
      params: { phone: '+99912345678' },
      status: 'pending',
      createdBy: 'linked-guardian',
    }),
  );
});
