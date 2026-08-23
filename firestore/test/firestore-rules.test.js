const fs = require('node:fs');
const path = require('node:path');
const { after, before, beforeEach, test } = require('node:test');

const {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} = require('@firebase/rules-unit-testing');
const {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
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
    const now = Date.now();
    await setDoc(doc(db, 'users', 'owner'), {
      serviceOwnerUid: 'owner',
      memberUids: ['member'],
      linkedImeis: ['123456789012345'],
      displayName: 'Owner',
    });
    await setDoc(doc(db, 'users', 'member'), {
      serviceOwnerUid: 'owner',
      linkedImeis: ['123456789012345'],
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
    await setDoc(doc(db, 'devices', '123456789012345'), {
      online: true,
      careProfile: 'senior',
      carePriorities: [],
    });
    await setDoc(
      doc(db, 'devices', '123456789012345', 'locations', 'recent'),
      {
        lat: -20,
        lng: 57,
        recordedAt: new Date(now - 2 * 24 * 60 * 60 * 1000),
      },
    );
    await setDoc(
      doc(db, 'devices', '123456789012345', 'locations', 'old'),
      {
        lat: -20,
        lng: 57,
        recordedAt: new Date(now - 30 * 24 * 60 * 60 * 1000),
      },
    );
    await setDoc(
      doc(
        db,
        'devices',
        '123456789012345',
        'journeys',
        'journey-1',
      ),
      {
        startAt: new Date(now - 60 * 60 * 1000),
        endAt: new Date(now - 30 * 60 * 1000),
      },
    );
    await setDoc(
      doc(
        db,
        'devices',
        '123456789012345',
        'journeys',
        'journey-1',
        'presentations',
        'google_v1',
      ),
      {
        version: 1,
        journeyStartAt: new Date(now - 60 * 60 * 1000),
        expiresAt: new Date(now + 24 * 60 * 60 * 1000),
        segments: [],
      },
    );
    await setDoc(
      doc(
        db,
        'devices',
        '123456789012345',
        'journeys',
        'journey-expired',
        'presentations',
        'google_v1',
      ),
      {
        version: 1,
        journeyStartAt: new Date(now - 60 * 60 * 1000),
        expiresAt: new Date(now - 60 * 1000),
        segments: [],
      },
    );
    await setDoc(doc(db, 'medicationReminders', 'med-1'), {
      imei: '123456789012345',
      text: 'Tablets',
      createdBy: 'owner',
    });
    await setDoc(doc(db, 'sosVoiceMessages', 'voice-active'), {
      imei: '123456789012345',
      alertId: 'sos-1',
      status: 'available',
      durationMs: 2000,
      expiresAt: new Date(now + 60 * 60 * 1000),
    });
    await setDoc(doc(db, 'sosVoiceMessages', 'voice-expired'), {
      imei: '123456789012345',
      alertId: 'sos-1',
      status: 'available',
      durationMs: 2000,
      expiresAt: new Date(now - 60 * 1000),
    });
    await setDoc(doc(db, 'sosVoiceDeliveries', 'opaque-token-hash'), {
      clipId: 'voice-active',
      expiresAt: new Date(now + 60 * 60 * 1000),
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

test('Essential can read recent history but not history older than seven days', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), 'serviceSubscriptions', 'owner'), {
      plan: 'essential',
    });
  });
  const db = authedDb('owner');
  await assertSucceeds(
    getDoc(doc(db, 'devices', '123456789012345', 'locations', 'recent')),
  );
  await assertFails(
    getDoc(doc(db, 'devices', '123456789012345', 'locations', 'old')),
  );
});

test('Family and Care can read retained history without the Essential window', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), 'serviceSubscriptions', 'owner'), {
      plan: 'family',
    });
  });
  await assertSucceeds(
    getDoc(
      doc(
        authedDb('member'),
        'devices',
        '123456789012345',
        'locations',
        'old',
      ),
    ),
  );
});

test('linked Family users can query journeys for a bounded day', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), 'serviceSubscriptions', 'owner'), {
      plan: 'family',
    });
  });
  const now = Date.now();
  const journeys = query(
    collection(
      authedDb('member'),
      'devices',
      '123456789012345',
      'journeys',
    ),
    where('startAt', '>=', new Date(now - 24 * 60 * 60 * 1000)),
    where('startAt', '<', new Date(now + 24 * 60 * 60 * 1000)),
    orderBy('startAt'),
  );

  await assertSucceeds(getDocs(journeys));
});

test('linked users can read only unexpired journey presentations', async () => {
  const db = authedDb('member');
  const active = doc(
    db,
    'devices',
    '123456789012345',
    'journeys',
    'journey-1',
    'presentations',
    'google_v1',
  );
  const expired = doc(
    db,
    'devices',
    '123456789012345',
    'journeys',
    'journey-expired',
    'presentations',
    'google_v1',
  );

  await assertSucceeds(getDoc(active));
  await assertFails(getDoc(expired));
  await assertFails(
    getDoc(
      doc(
        authedDb('attacker'),
        'devices',
        '123456789012345',
        'journeys',
        'journey-1',
        'presentations',
        'google_v1',
      ),
    ),
  );
  await assertFails(updateDoc(active, { attribution: 'forged' }));
});

test('only linked Family or Care members can read unexpired SOS voice metadata', async () => {
  const careMember = authedDb('member');
  await assertSucceeds(
    getDoc(doc(careMember, 'sosVoiceMessages', 'voice-active')),
  );
  await assertFails(
    getDoc(doc(careMember, 'sosVoiceMessages', 'voice-expired')),
  );
  await assertFails(
    getDoc(doc(authedDb('attacker'), 'sosVoiceMessages', 'voice-active')),
  );

  await testEnv.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), 'serviceSubscriptions', 'owner'), {
      plan: 'essential',
    });
  });
  await assertFails(
    getDoc(doc(authedDb('owner'), 'sosVoiceMessages', 'voice-active')),
  );
});

test('clients cannot alter SOS voice metadata or inspect recipient delivery tokens', async () => {
  const db = authedDb('owner');
  await assertFails(
    updateDoc(doc(db, 'sosVoiceMessages', 'voice-active'), {
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    }),
  );
  await assertFails(
    getDoc(doc(db, 'sosVoiceDeliveries', 'opaque-token-hash')),
  );
});

test('medication data and commands require Guardian Care', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), 'serviceSubscriptions', 'owner'), {
      plan: 'family',
    });
  });
  const familyDb = authedDb('owner');
  await assertFails(getDoc(doc(familyDb, 'medicationReminders', 'med-1')));
  await assertFails(
    setDoc(doc(familyDb, 'medicationReminders', 'med-family'), {
      imei: '123456789012345',
      text: 'Tablets',
      createdBy: 'owner',
    }),
  );
  await assertFails(
    setDoc(doc(familyDb, 'deviceCommands', 'med-command-family'), {
      imei: '123456789012345',
      type: 'set_medication_reminder',
      params: {},
      status: 'pending',
      createdBy: 'owner',
    }),
  );

  await testEnv.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), 'serviceSubscriptions', 'owner'), {
      plan: 'care',
    });
  });
  const careDb = authedDb('member');
  await assertSucceeds(getDoc(doc(careDb, 'medicationReminders', 'med-1')));
});

test('Care profile writes require Guardian Care', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), 'serviceSubscriptions', 'owner'), {
      plan: 'family',
    });
  });
  const deviceRef = doc(authedDb('owner'), 'devices', '123456789012345');
  await assertFails(updateDoc(deviceRef, { careProfile: 'adult' }));

  await testEnv.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), 'serviceSubscriptions', 'owner'), {
      plan: 'care',
    });
  });
  await assertSucceeds(updateDoc(deviceRef, { careProfile: 'adult' }));
});

test('only the plan owner below caregiver capacity can create invites', async () => {
  const memberDb = authedDb('member');
  await assertFails(
    setDoc(doc(memberDb, 'invites', 'MEM234'), {
      code: 'MEM234',
      createdBy: 'member',
      createdByName: 'Member',
      status: 'pending',
      createdAt: serverTimestamp(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    }),
  );

  await testEnv.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), 'serviceSubscriptions', 'owner'), {
      plan: 'essential',
    });
  });
  const ownerDb = authedDb('owner');
  await assertFails(
    setDoc(doc(ownerDb, 'invites', 'FULL24'), {
      code: 'FULL24',
      createdBy: 'owner',
      createdByName: 'Owner',
      status: 'pending',
      createdAt: serverTimestamp(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    }),
  );
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
