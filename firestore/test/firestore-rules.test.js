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
      linkedImeis: ['000000000000001'],
      displayName: 'Owner',
    });
    await setDoc(doc(db, 'users', 'member'), {
      serviceOwnerUid: 'owner',
      linkedImeis: ['000000000000001'],
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
    await setDoc(doc(db, 'devices', '000000000000001'), {
      online: true,
      careProfile: 'senior',
      carePriorities: [],
    });
    await setDoc(
      doc(db, 'devices', '000000000000001', 'locations', 'recent'),
      {
        lat: -20,
        lng: 57,
        recordedAt: new Date(now - 2 * 24 * 60 * 60 * 1000),
      },
    );
    await setDoc(
      doc(db, 'devices', '000000000000001', 'locations', 'old'),
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
        '000000000000001',
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
        '000000000000001',
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
        '000000000000001',
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
      imei: '000000000000001',
      text: 'Tablets',
      createdBy: 'owner',
    });
    await setDoc(doc(db, 'wellbeingConsents', '000000000000001'), {
      version: 1,
      status: 'granted',
      managedBy: 'guardian_admin',
      wearerAcknowledgedAt: new Date(now - 24 * 60 * 60 * 1000),
    });
    await setDoc(
      doc(db, 'devices', '000000000000001', 'wellbeingReadings', 'accepted'),
      {
        schemaVersion: 1,
        imei: '000000000000001',
        metricSet: 'spo2',
        values: { spo2Percent: 98 },
        displayable: true,
        observedAt: new Date(now - 60 * 1000),
      },
    );
    await setDoc(
      doc(db, 'devices', '000000000000001', 'wellbeingReadings', 'shadow'),
      {
        schemaVersion: 1,
        imei: '000000000000001',
        metricSet: 'spo2',
        values: { spo2Percent: 97 },
        displayable: false,
        observedAt: new Date(now - 2 * 60 * 1000),
      },
    );
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
    getDoc(doc(db, 'devices', '000000000000001', 'locations', 'recent')),
  );
  await assertFails(
    getDoc(doc(db, 'devices', '000000000000001', 'locations', 'old')),
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
        '000000000000001',
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
      '000000000000001',
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
    '000000000000001',
    'journeys',
    'journey-1',
    'presentations',
    'google_v1',
  );
  const expired = doc(
    db,
    'devices',
    '000000000000001',
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
        '000000000000001',
        'journeys',
        'journey-1',
        'presentations',
        'google_v1',
      ),
    ),
  );
  await assertFails(updateDoc(active, { attribution: 'forged' }));
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
      imei: '000000000000001',
      text: 'Tablets',
      createdBy: 'owner',
    }),
  );
  await assertFails(
    setDoc(doc(familyDb, 'deviceCommands', 'med-command-family'), {
      imei: '000000000000001',
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

test('only linked Care users can read displayable wellbeing readings', async () => {
  const acceptedPath = [
    'devices', '000000000000001', 'wellbeingReadings', 'accepted',
  ];
  await assertSucceeds(getDoc(doc(authedDb('owner'), ...acceptedPath)));
  await assertSucceeds(getDoc(doc(authedDb('member'), ...acceptedPath)));
  await assertFails(getDoc(doc(authedDb('attacker'), ...acceptedPath)));

  await testEnv.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), 'serviceSubscriptions', 'owner'), {
      plan: 'family',
    });
  });
  await assertFails(getDoc(doc(authedDb('owner'), ...acceptedPath)));
});

test('unverified wellbeing evidence and consent records remain backend-only', async () => {
  const ownerDb = authedDb('owner');
  const shadow = doc(
    ownerDb, 'devices', '000000000000001', 'wellbeingReadings', 'shadow',
  );
  const consentRef = doc(ownerDb, 'wellbeingConsents', '000000000000001');
  await assertFails(getDoc(shadow));
  await assertFails(getDoc(consentRef));
  await assertFails(updateDoc(consentRef, { status: 'granted' }));
  await assertFails(setDoc(
    doc(ownerDb, 'devices', '000000000000001', 'wellbeingReadings', 'forged'),
    { displayable: true, metricSet: 'spo2', values: { spo2Percent: 99 } },
  ));

  await testEnv.withSecurityRulesDisabled(async (context) => {
    await updateDoc(
      doc(context.firestore(), 'wellbeingConsents', '000000000000001'),
      { status: 'revoked', revokedAt: new Date() },
    );
  });
  await assertFails(getDoc(doc(
    authedDb('owner'),
    'devices', '000000000000001', 'wellbeingReadings', 'accepted',
  )));
});

test('Care clients can query only readings constrained to displayable evidence', async () => {
  const readings = collection(
    authedDb('owner'), 'devices', '000000000000001', 'wellbeingReadings',
  );
  await assertSucceeds(getDocs(query(
    readings,
    where('displayable', '==', true),
    orderBy('observedAt', 'desc'),
  )));
  await assertFails(getDocs(query(readings, orderBy('observedAt', 'desc'))));
});

test('Care profile writes require Guardian Care', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), 'serviceSubscriptions', 'owner'), {
      plan: 'family',
    });
  });
  const deviceRef = doc(authedDb('owner'), 'devices', '000000000000001');
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
