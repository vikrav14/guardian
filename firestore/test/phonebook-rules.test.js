const fs = require('node:fs');
const path = require('node:path');
const { after, before, test } = require('node:test');

const {
  assertFails,
  initializeTestEnvironment,
} = require('@firebase/rules-unit-testing');
const { doc, setDoc } = require('firebase/firestore');

const projectId = 'guardian-phonebook-rules-test';
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
    await setDoc(doc(context.firestore(), 'users', 'linked-user'), {
      serviceOwnerUid: 'linked-user',
      linkedImeis: [testImei],
    });
  });
});

after(async () => {
  await testEnv.cleanup();
});

test('linked clients cannot create administrator-only phonebook commands', async () => {
  const db = testEnv.authenticatedContext('linked-user').firestore();
  await assertFails(
    setDoc(doc(db, 'deviceCommands', 'phonebook-attempt'), {
      imei: testImei,
      type: 'set_phonebook_contact',
      params: {
        slot: 1,
        name: 'Primary guardian',
        phone: '+99912345678',
      },
      status: 'pending',
      createdBy: 'linked-user',
    }),
  );
});
