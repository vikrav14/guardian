const fs = require('node:fs');
const path = require('node:path');
const { after, before, beforeEach, test } = require('node:test');

const {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} = require('@firebase/rules-unit-testing');
const {
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} = require('firebase/firestore');

const projectId = 'guardian-rules-test';
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
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'users', 'owner'), {
      serviceOwnerUid: 'owner',
      memberUids: ['member'],
      linkedImeis: ['861397052547492'],
      displayName: 'Owner',
    });
    await setDoc(doc(db, 'users', 'member'), {
      serviceOwnerUid: 'owner',
      linkedImeis: ['861397052547492'],
      displayName: 'Member',
    });
    await setDoc(doc(db, 'users', 'unverified'), {
      serviceOwnerUid: 'owner',
      linkedImeis: [],
    });
    await setDoc(doc(db, 'users', 'attacker'), {
      serviceOwnerUid: 'attacker',
      linkedImeis: [],
    });
    await setDoc(doc(db, 'serviceSubscriptions', 'owner'), {
      version: 1,
      managedBy: 'guardian_admin',
      plan: 'care',
      status: 'active',
    });
  });
});

after(async () => {
  await testEnv.cleanup();
});

function authedDb(uid) {
  return testEnv.authenticatedContext(uid).firestore();
}

test('service owner can read their authoritative subscription', async () => {
  const ref = doc(authedDb('owner'), 'serviceSubscriptions', 'owner');
  await assertSucceeds(getDoc(ref));
});

test('backend-verified family member inherits the owner subscription read', async () => {
  const ref = doc(authedDb('member'), 'serviceSubscriptions', 'owner');
  await assertSucceeds(getDoc(ref));
});

test('unverified or unrelated users cannot read another family plan', async () => {
  await assertFails(
    getDoc(doc(authedDb('unverified'), 'serviceSubscriptions', 'owner')),
  );
  await assertFails(
    getDoc(doc(authedDb('attacker'), 'serviceSubscriptions', 'owner')),
  );
});

test('signed-out clients cannot read a subscription', async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, 'serviceSubscriptions', 'owner')));
});

test('clients cannot create, change or delete subscription authority', async () => {
  const ownerDb = authedDb('owner');
  await assertFails(
    setDoc(doc(ownerDb, 'serviceSubscriptions', 'new-owner'), {
      version: 1,
      managedBy: 'guardian_admin',
      plan: 'care',
      status: 'active',
    }),
  );
  await assertFails(
    updateDoc(doc(ownerDb, 'serviceSubscriptions', 'owner'), {
      plan: 'essential',
    }),
  );
  await assertFails(
    deleteDoc(doc(ownerDb, 'serviceSubscriptions', 'owner')),
  );
});

test('clients cannot grant themselves an owner or mutate membership authority', async () => {
  const ownerDb = authedDb('owner');
  await assertFails(
    updateDoc(doc(ownerDb, 'users', 'owner'), {
      serviceOwnerUid: 'attacker',
    }),
  );
  await assertFails(
    updateDoc(doc(ownerDb, 'users', 'owner'), {
      memberUids: ['member', 'attacker'],
    }),
  );
  await assertFails(
    updateDoc(doc(ownerDb, 'users', 'owner'), {
      subscription: { tier: 'premium', status: 'active' },
    }),
  );
  await assertFails(
    updateDoc(doc(ownerDb, 'users', 'owner'), {
      familyMembers: [{ uid: 'attacker', displayName: 'Forged' }],
    }),
  );
});

test('ordinary owner profile updates remain allowed', async () => {
  const ownerDb = authedDb('owner');
  await assertSucceeds(
    updateDoc(doc(ownerDb, 'users', 'owner'), {
      avatarUrl: 'https://example.test/avatar.png',
      updatedAt: new Date('2026-08-14T00:00:00Z'),
    }),
  );
});

test('new client profiles cannot seed trusted authority fields', async () => {
  const plainDb = authedDb('plain');
  await assertSucceeds(
    setDoc(doc(plainDb, 'users', 'plain'), {
      displayName: 'Plain user',
      linkedImeis: [],
      familyMembers: [],
    }),
  );

  const forgedDb = authedDb('forged');
  await assertFails(
    setDoc(doc(forgedDb, 'users', 'forged'), {
      displayName: 'Forged user',
      serviceOwnerUid: 'owner',
    }),
  );
});

test('only the creator can read an invite and clients cannot accept it directly', async () => {
  const ownerDb = authedDb('owner');
  const inviteRef = doc(ownerDb, 'invites', 'ABC234');
  await assertSucceeds(
    setDoc(inviteRef, {
      code: 'ABC234',
      createdBy: 'owner',
      createdByName: 'Owner',
      status: 'pending',
      createdAt: serverTimestamp(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    }),
  );
  await assertSucceeds(getDoc(inviteRef));
  await assertFails(getDoc(doc(authedDb('member'), 'invites', 'ABC234')));
  await assertFails(updateDoc(inviteRef, { status: 'accepted' }));
});

test('a joiner can enqueue only their own minimal pending request', async () => {
  const memberDb = authedDb('member');
  await assertSucceeds(
    setDoc(doc(memberDb, 'familyJoinRequests', 'request-ok'), {
      inviteCode: 'ABC234',
      requestedBy: 'member',
      status: 'pending',
      createdAt: serverTimestamp(),
    }),
  );
  await assertFails(
    setDoc(doc(memberDb, 'familyJoinRequests', 'request-forged'), {
      inviteCode: 'ABC234',
      requestedBy: 'attacker',
      status: 'accepted',
      ownerUid: 'owner',
      createdAt: serverTimestamp(),
    }),
  );
  await assertFails(
    updateDoc(doc(memberDb, 'familyJoinRequests', 'request-ok'), {
      status: 'accepted',
    }),
  );
});
