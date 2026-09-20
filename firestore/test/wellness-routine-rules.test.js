'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { before, after, test } = require('node:test');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { collection, doc, setDoc, getDoc, getDocs, deleteDoc, serverTimestamp, setLogLevel } = require('firebase/firestore');
const imei = '359633100123456';
const defaults = { manual: [], gentle: ['09:00', '18:00'], balanced: ['09:00', '14:00', '19:00'] };
let env;
before(async () => {
  setLogLevel('silent');
  env = await initializeTestEnvironment({ projectId: 'guardian-wellness-routine-test',
    firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'rules.example'), 'utf8') } });
});
after(async () => env?.cleanup());

async function seed(plan = 'care', {
  consent = 'granted', linked = true, status = 'active',
  consentPatch = {}, subscriptionPatch = {},
} = {}) {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async c => {
    const db = c.firestore(), now = new Date();
    for (const uid of ['pilot', 'other']) {
      await setDoc(doc(db, 'users', uid), {
        linkedImeis: uid === 'pilot' && linked ? [imei] : [],
      });
      await setDoc(doc(db, 'serviceSubscriptions', uid), { version: 1, managedBy: 'guardian_admin', plan, status, ...subscriptionPatch });
    }
    await setDoc(doc(db, 'wellbeingConsents', imei), { version: 1, managedBy: 'guardian_admin',
      status: consent, wearerAcknowledgedAt: now, ...consentPatch });
    await setDoc(doc(db, 'devices', imei, 'wellnessRoutine', 'current'), {
      version: 2, phase: 'blocked', routine: 'gentle', times: defaults.gentle,
      timeZone: 'Indian/Mauritius', nextCheckAt: null, lastAttempt: null,
    });
    await setDoc(doc(db, 'devices', imei, 'wellnessRoutine', 'private'), { phase: 'blocked' });
    await setDoc(doc(db, 'devices', imei, 'wellnessScheduleDays', '2026-09-17'), { attemptCount: 1 });
    await setDoc(doc(db, 'devices', imei, 'wellnessScheduleSlots', '2026-09-17-0900'), { status: 'claimed' });
  });
}
function db(uid = 'pilot') {
  return uid === null ? env.unauthenticatedContext().firestore() : env.authenticatedContext(uid).firestore();
}
function payload(uid = 'pilot', patch = {}) {
  const routine = patch.routine ?? 'balanced';
  return { version: 2, routine, times: defaults[routine] ?? defaults.balanced,
    timeZone: 'Indian/Mauritius', requestedBy: uid, updatedAt: serverTimestamp(), ...patch };
}
function write(uid = 'pilot', patch = {}) {
  return setDoc(doc(db(uid), 'wellnessRoutineRequests', imei), payload(uid, patch));
}
function legacy(routine = 'manual', patch = {}) {
  return setDoc(doc(db(), 'wellnessRoutineRequests', imei), {
    version: 1, routine, requestedBy: 'pilot', updatedAt: serverTimestamp(), ...patch,
  });
}

test('only a linked Family or Care customer may create and edit daily schedules', async () => {
  await seed('care');
  for (const routine of ['manual', 'gentle', 'balanced']) await assertSucceeds(write('pilot', { routine }));
  await assertSucceeds(write('pilot', { routine: 'gentle', times: ['07:30', '21:15'] }));
  await assertSucceeds(getDoc(doc(db(), 'wellnessRoutineRequests', imei)));
  await assertFails(write('other'));
  await assertFails(write(null));
  await seed('family');
  await assertSucceeds(write('pilot', { routine: 'gentle' }));
  for (const plan of ['essential']) {
    await seed(plan);
    await assertFails(write('pilot', { routine: 'gentle' }));
  }
});

test('five-minute boundary is accepted, including across an hour and midnight', async () => {
  await seed();
  for (const times of [['09:00', '09:05'], ['09:58', '10:03'], ['00:00', '23:55'], ['00:04', '23:59']]) {
    await assertSucceeds(write('pilot', { routine: 'gentle', times }));
  }
  for (const times of [['00:00', '00:05', '23:55'], ['00:04', '12:00', '23:59'], ['09:58', '10:03', '10:08']]) {
    await assertSucceeds(write('pilot', { routine: 'balanced', times }));
  }
});

test('each routine requires exactly zero, two, or three times', async () => {
  await seed();
  for (const [routine, times] of [
    ['manual', ['09:00']], ['manual', defaults.gentle], ['gentle', []], ['gentle', ['09:00']],
    ['gentle', defaults.balanced], ['balanced', []], ['balanced', defaults.gentle],
    ['balanced', ['06:00', '09:00', '14:00', '19:00']],
  ]) await assertFails(write('pilot', { routine, times }));
  for (const times of [null, '09:00,18:00', { 0: '09:00', 1: '18:00' }, 2]) {
    await assertFails(write('pilot', { routine: 'gentle', times }));
  }
});

test('times must be sorted, unique, and at least five minutes apart through midnight', async () => {
  await seed();
  for (const times of [
    ['18:00', '09:00'], ['09:00', '09:00'], ['09:00', '09:04'], ['09:59', '10:03'],
    ['00:00', '23:56'], ['00:02', '23:59'],
  ]) await assertFails(write('pilot', { routine: 'gentle', times }));
  for (const times of [
    ['09:00', '08:00', '19:00'], ['09:00', '19:00', '14:00'], ['09:00', '14:00', '14:00'],
    ['09:00', '09:04', '19:00'], ['09:00', '14:00', '14:04'], ['00:00', '12:00', '23:56'],
  ]) await assertFails(write('pilot', { routine: 'balanced', times }));
});

test('only canonical 24-hour HH:mm strings in Indian/Mauritius are accepted', async () => {
  await seed();
  for (const time of ['9:00', '09:0', '24:00', '23:60', '09:00:00', ' 09:00', '09:00 ',
    '09:00\n', '09:00,1', '-1:00', '９:００', '', null, 900, { hour: 9 }]) {
    await assertFails(write('pilot', { routine: 'gentle', times: [time, '18:00'] }));
  }
  // Validate the second and third slots too, not only the first string.
  await assertFails(write('pilot', { routine: 'gentle', times: ['09:00', '24:00'] }));
  await assertFails(write('pilot', { times: ['09:00', '14:00', '19:60'] }));
  for (const timeZone of ['UTC', 'Indian/Reunion', '+04:00', 'indian/mauritius', '', null, 4]) {
    await assertFails(write('pilot', { timeZone }));
  }
});

test('clients cannot forge schedule authority, runtime results, cadence, or commands', async () => {
  await seed();
  await assertSucceeds(write());
  for (const patch of [
    { routine: 'hourly' }, { routine: 'balanced,1' }, { routine: null }, { intervalHours: 1 },
    { command: 'bodytemp2' }, { params: { times: defaults.gentle } }, { wearing: 'worn' },
    { requestedBy: 'other' }, { updatedAt: new Date('2020-01-01') }, { updatedAt: new Date('2099-01-01') },
    { version: 3 }, { version: '2' }, { version: 2.5 }, { nextCheckAt: new Date() },
    { lastAttempt: { status: 'accepted' } }, { displayable: true }, { accepted: true },
  ]) await assertFails(write('pilot', patch));
  for (const field of ['version', 'routine', 'times', 'timeZone', 'requestedBy', 'updatedAt']) {
    const data = payload();
    delete data[field];
    await assertFails(setDoc(doc(db(), 'wellnessRoutineRequests', imei), data));
  }
});

test('v1 compatibility accepts only a minimal manual stop and never starts an interval routine', async () => {
  await seed();
  await assertFails(legacy('gentle'));
  await assertFails(legacy('balanced'));
  await assertSucceeds(write());
  await assertSucceeds(legacy());
  await assertFails(legacy('manual', { times: [] }));
  await assertFails(legacy('manual', { intervalHours: 1 }));
  await assertFails(legacy('manual', { requestedBy: 'other' }));
  await assertFails(legacy('manual', { updatedAt: new Date('2020-01-01') }));
});

test('missing, revoked, expired, or untrusted consent blocks starts but permits manual stop', async () => {
  for (const options of [
    { consent: 'revoked' }, { consent: 'pending' },
    { consentPatch: { expiresAt: new Date('2020-01-01') } },
    { consentPatch: { revokedAt: new Date() } },
    { consentPatch: { managedBy: 'client' } },
    { consentPatch: { wearerAcknowledgedAt: new Date('2099-01-01') } },
  ]) {
    await seed('care', options);
    await assertFails(write('pilot', { routine: 'gentle' }));
    await assertFails(write());
    await assertSucceeds(write('pilot', { routine: 'manual' }));
    await assertSucceeds(legacy());
    await assertSucceeds(getDoc(doc(db(), 'devices', imei, 'wellnessRoutine', 'current')));
  }
  await seed();
  await env.withSecurityRulesDisabled(c => deleteDoc(doc(c.firestore(), 'wellbeingConsents', imei)));
  await assertFails(write());
  await assertSucceeds(write('pilot', { routine: 'manual' }));
});

test('link and active Family or Care entitlement remain mandatory even for stop', async () => {
  for (const options of [
    { linked: false }, { status: 'expired' },
    { subscriptionPatch: { managedBy: 'client' } },
    { subscriptionPatch: { currentPeriodEnd: new Date('2020-01-01') } },
  ]) {
    await seed('family', options);
    await assertFails(write());
    await assertFails(write('pilot', { routine: 'manual' }));
    await assertFails(legacy());
    await assertFails(getDoc(doc(db(), 'wellnessRoutineRequests', imei)));
    await assertFails(getDoc(doc(db(), 'devices', imei, 'wellnessRoutine', 'current')));
  }
});

test('only current routine status is readable by the linked Family or Care customer; scheduler ledgers remain private', async () => {
  await seed('family');
  await assertSucceeds(write());
  for (const uid of ['pilot', 'other', null]) {
    const client = db(uid), current = doc(client, 'devices', imei, 'wellnessRoutine', 'current');
    await (uid === 'pilot' ? assertSucceeds(getDoc(current)) : assertFails(getDoc(current)));
    await assertFails(setDoc(current, { phase: 'accepted' }));
    await assertFails(deleteDoc(current));
    await assertFails(getDoc(doc(client, 'devices', imei, 'wellnessRoutine', 'private')));
    await assertFails(getDocs(collection(client, 'devices', imei, 'wellnessRoutine')));
    await assertFails(getDocs(collection(client, 'wellnessRoutineRequests')));
    await assertFails(deleteDoc(doc(client, 'wellnessRoutineRequests', imei)));
    for (const [name, id] of [['wellnessScheduleDays', '2026-09-17'], ['wellnessScheduleSlots', '2026-09-17-0900']]) {
      const ref = doc(client, 'devices', imei, name, id);
      await assertFails(getDoc(ref));
      await assertFails(getDocs(collection(client, 'devices', imei, name)));
      await assertFails(setDoc(ref, { attemptCount: 0 }));
      await assertFails(setDoc(doc(client, 'devices', imei, name, 'new'), { status: 'claimed' }));
      await assertFails(deleteDoc(ref));
    }
  }
});
