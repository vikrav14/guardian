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
      state: 'waiting_for_device_acceptance',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      publicUrl: null,
    });
    await setDoc(doc(db, 'safetySnapshotAudit', 'auth-1'), {
      requestId: 'auth-1',
      imei,
      requestedBy: 'family-user',
      serviceOwnerUid: 'family-user',
      outcome: 'accepted_backend_only',
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
    safetyPurposeConfirmed: true,
    consentConfirmed: true,
    purpose: 'Check the immediate surroundings after a safety concern',
    createdAt: serverTimestamp(),
  };
}

test('incident photos, AI and enrollment remain server-only even for a linked Family user', async () => {
  const db = testEnv.authenticatedContext('family-user').firestore();
  await testEnv.withSecurityRulesDisabled(async context => {
    const adminDb = context.firestore();
    for (const collection of ['incidentPhotos', 'incidentPhotoSettings', 'incidentPhotoDelivery']) {
      await setDoc(doc(adminDb, collection, 'private-incident'), { imei, ownerUid: 'family-user' });
    }
    await setDoc(doc(adminDb, 'safetySnapshotAuthorizations', 'incident-photo'), {
      imei, serviceOwnerUid: 'family-user', incidentId: 'private-incident', state: 'available',
      analysis: { status: 'ready', visibleDetails: ['Synthetic scene'] },
    });
  });
  for (const collection of ['incidentPhotos', 'incidentPhotoSettings', 'incidentPhotoDelivery']) {
    await assertFails(getDoc(doc(db, collection, 'private-incident')));
    await assertFails(setDoc(doc(db, collection, 'forged'), { imei, ownerUid: 'family-user', enabled: true }));
  }
  await assertFails(getDoc(doc(db, 'safetySnapshotAuthorizations', 'incident-photo')));
  await assertFails(setDoc(doc(db, 'alerts', 'forged-photo-alarm'), {
    imei, type: 'sos', severity: 'critical', message: 'App SOS', resolved: false,
    notifyStatus: 'pending', createdAt: serverTimestamp(), incidentPhotoEligible: true, incidentPhotoPending: true,
  }));
});

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
  await assertFails(
    setDoc(doc(db, 'safetySnapshotRequests', 'no-purpose-confirmation'), {
      ...validRequest('family-user'),
      safetyPurposeConfirmed: false,
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
      state: 'waiting_for_device_acceptance',
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
