const fs = require('node:fs');
const path = require('node:path');
const { after, before, test } = require('node:test');

const {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, serverTimestamp } = require('firebase/firestore');

const projectId = 'guardian-safety-snapshot-rules-test';
const imei = '999999999999999';
let testEnv;

async function seedUserAndPlan(context, uid, plan, linked = true) {
  const db = context.firestore();
  await setDoc(doc(db, 'users', uid), {
    serviceOwnerUid: uid,
    linkedImeis: linked ? [imei] : [],
    memberUids: [],
  });
  await setDoc(doc(db, 'serviceSubscriptions', uid), {
    version: 1,
    managedBy: 'guardian_admin',
    plan,
    status: 'active',
  });
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: fs.readFileSync(path.join(__dirname, '..', 'rules.example'), 'utf8'),
    },
  });

  await testEnv.withSecurityRulesDisabled(async (context) => {
    await seedUserAndPlan(context, 'family-user', 'family');
    await seedUserAndPlan(context, 'care-user', 'care');
    await seedUserAndPlan(context, 'essential-user', 'essential');
    await seedUserAndPlan(context, 'unlinked-family', 'family', false);

    const db = context.firestore();
    await setDoc(doc(db, 'safetySnapshotAuthorizations', 'auth-1'), {
      requestId: 'auth-1',
      imei,
      requestedBy: 'family-user',
      serviceOwnerUid: 'family-user',
      status: 'authorized_backend_only',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      publicUrl: null,
    });
    await setDoc(doc(db, 'safetySnapshotAudit', 'auth-1'), {
      requestId: 'auth-1',
      imei,
      requestedBy: 'family-user',
      serviceOwnerUid: 'family-user',
      outcome: 'authorized_backend_only',
      deviceCommandSent: false,
    });
  });
});

after(async () => {
  await testEnv.cleanup();
});

function validRequest(requestedBy) {
  return {
    imei,
    requestedBy,
    status: 'pending',
    purposeConfirmed: true,
    consentConfirmed: true,
    purpose: 'Check the immediate surroundings after a safety concern',
    createdAt: serverTimestamp(),
  };
}

test('linked Family and Care users may enqueue a consent-bound snapshot request', async () => {
  for (const uid of ['family-user', 'care-user']) {
    const db = testEnv.authenticatedContext(uid).firestore();
    await assertSucceeds(
      setDoc(doc(db, 'safetySnapshotRequests', `request-${uid}`), validRequest(uid)),
    );
  }
});

test('Essential and unlinked users cannot enqueue snapshot requests', async () => {
  for (const uid of ['essential-user', 'unlinked-family']) {
    const db = testEnv.authenticatedContext(uid).firestore();
    await assertFails(
      setDoc(doc(db, 'safetySnapshotRequests', `request-${uid}`), validRequest(uid)),
    );
  }
});

test('requester identity and explicit consent cannot be spoofed or omitted', async () => {
  const db = testEnv.authenticatedContext('family-user').firestore();
  await assertFails(
    setDoc(doc(db, 'safetySnapshotRequests', 'spoofed'), validRequest('care-user')),
  );
  await assertFails(
    setDoc(doc(db, 'safetySnapshotRequests', 'no-consent'), {
      ...validRequest('family-user'),
      consentConfirmed: false,
    }),
  );
});

test('eligible linked Family user may read backend-owned authorization and audit', async () => {
  const db = testEnv.authenticatedContext('family-user').firestore();
  await assertSucceeds(getDoc(doc(db, 'safetySnapshotAuthorizations', 'auth-1')));
  await assertSucceeds(getDoc(doc(db, 'safetySnapshotAudit', 'auth-1')));
});

test('clients cannot write authorization or audit records', async () => {
  const db = testEnv.authenticatedContext('family-user').firestore();
  await assertFails(
    setDoc(doc(db, 'safetySnapshotAuthorizations', 'client-write'), {
      imei,
      serviceOwnerUid: 'family-user',
      status: 'authorized_backend_only',
    }),
  );
  await assertFails(
    setDoc(doc(db, 'safetySnapshotAudit', 'client-write'), {
      imei,
      serviceOwnerUid: 'family-user',
      deviceCommandSent: false,
    }),
  );
});
