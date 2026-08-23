const fs = require('node:fs');
const path = require('node:path');
const { after, before, beforeEach, test } = require('node:test');

const {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} = require('@firebase/rules-unit-testing');
const { doc, getDoc, serverTimestamp, setDoc } = require('firebase/firestore');

const projectId = 'guardian-care-reminder-rules-test';
const imei = '999999999999999';
let testEnv;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: fs.readFileSync(path.join(__dirname, '..', 'rules.example'), 'utf8'),
    },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'users', 'care-owner'), {
      linkedImeis: [imei],
      memberUids: ['care-member'],
    });
    await setDoc(doc(db, 'users', 'care-member'), {
      serviceOwnerUid: 'care-owner',
      linkedImeis: [imei],
    });
    await setDoc(doc(db, 'users', 'family-owner'), {
      linkedImeis: [imei],
      memberUids: [],
    });
    await setDoc(doc(db, 'users', 'unlinked-care'), {
      linkedImeis: [],
      memberUids: [],
    });
    await setDoc(doc(db, 'serviceSubscriptions', 'care-owner'), {
      version: 1,
      managedBy: 'guardian_admin',
      plan: 'care',
      status: 'active',
    });
    await setDoc(doc(db, 'serviceSubscriptions', 'family-owner'), {
      version: 1,
      managedBy: 'guardian_admin',
      plan: 'family',
      status: 'active',
    });
    await setDoc(doc(db, 'serviceSubscriptions', 'unlinked-care'), {
      version: 1,
      managedBy: 'guardian_admin',
      plan: 'care',
      status: 'active',
    });
    await setDoc(doc(db, 'careReminderSchedules', 'schedule-1'), {
      scheduleId: 'schedule-1',
      imei,
      serviceOwnerUid: 'care-owner',
      kind: 'routine',
      label: 'Morning routine',
      localTime: '08:00',
      weekdays: [1, 2, 3, 4, 5],
      enabled: true,
      syncState: 'blocked_unverified',
      acknowledgementState: 'unavailable',
    });
    await setDoc(doc(db, 'careReminderAudit', 'audit-1'), {
      requestId: 'audit-1',
      imei,
      serviceOwnerUid: 'care-owner',
      requestedBy: 'care-owner',
      outcome: 'accepted_backend_only',
      deviceCommandSent: false,
    });
  });
});

after(async () => {
  await testEnv.cleanup();
});

function requestPayload(requestedBy = 'care-owner') {
  return {
    action: 'upsert',
    imei,
    requestedBy,
    status: 'pending',
    createdAt: serverTimestamp(),
    scheduleId: 'schedule-2',
    schedule: {
      kind: 'routine',
      label: 'Evening routine',
      localTime: '19:30',
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      enabled: true,
      quietHours: { start: '22:00', end: '06:00' },
    },
  };
}

test('Care owner may enqueue own linked reminder request', async () => {
  const db = testEnv.authenticatedContext('care-owner').firestore();
  await assertSucceeds(setDoc(doc(db, 'careReminderRequests', 'req-owner'), requestPayload()));
});

test('verified Care family member may enqueue own linked reminder request', async () => {
  const db = testEnv.authenticatedContext('care-member').firestore();
  await assertSucceeds(
    setDoc(doc(db, 'careReminderRequests', 'req-member'), requestPayload('care-member')),
  );
});

test('Family plan cannot enqueue Care reminder request', async () => {
  const db = testEnv.authenticatedContext('family-owner').firestore();
  await assertFails(
    setDoc(doc(db, 'careReminderRequests', 'req-family'), requestPayload('family-owner')),
  );
});

test('unlinked Care user cannot enqueue reminder request', async () => {
  const db = testEnv.authenticatedContext('unlinked-care').firestore();
  await assertFails(
    setDoc(doc(db, 'careReminderRequests', 'req-unlinked'), requestPayload('unlinked-care')),
  );
});

test('requester identity cannot be spoofed', async () => {
  const db = testEnv.authenticatedContext('care-owner').firestore();
  await assertFails(
    setDoc(doc(db, 'careReminderRequests', 'req-spoof'), requestPayload('care-member')),
  );
});

test('linked Care user can read canonical schedule and own request', async () => {
  const db = testEnv.authenticatedContext('care-owner').firestore();
  await assertSucceeds(getDoc(doc(db, 'careReminderSchedules', 'schedule-1')));
  await assertSucceeds(setDoc(doc(db, 'careReminderRequests', 'req-read'), requestPayload()));
  await assertSucceeds(getDoc(doc(db, 'careReminderRequests', 'req-read')));
});

test('clients cannot write canonical schedules or audit evidence', async () => {
  const db = testEnv.authenticatedContext('care-owner').firestore();
  await assertFails(setDoc(doc(db, 'careReminderSchedules', 'client-write'), {
    imei,
    serviceOwnerUid: 'care-owner',
  }));
  await assertFails(setDoc(doc(db, 'careReminderAudit', 'client-write'), {
    imei,
    serviceOwnerUid: 'care-owner',
    deviceCommandSent: false,
  }));
});

test('Care user may read backend audit for a linked device', async () => {
  const db = testEnv.authenticatedContext('care-owner').firestore();
  await assertSucceeds(getDoc(doc(db, 'careReminderAudit', 'audit-1')));
});
