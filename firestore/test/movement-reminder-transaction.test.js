'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const { initializeTestEnvironment, assertFails } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc } = require('firebase/firestore');
const admin = require('../../gateway/node_modules/firebase-admin');
const { createMovementStore } = require('../../gateway/src/movement-reminder-store');

const projectId = 'guardian-movement-transaction-test', imei = '999999999999999';
let env, app, db;
before(async () => {
  env = await initializeTestEnvironment({ projectId,
    firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'rules.example'), 'utf8') } });
  app = admin.initializeApp({ projectId }, projectId); db = app.firestore();
});
after(async () => { await app.delete(); await env.cleanup(); });

const settings = { enabled: true, intervalMinutes: 20, start: '08:00', end: '20:00', timezone: 'Indian/Mauritius' };
const input = { uid: 'pilot', ownerUid: 'pilot', imei, requestId: 'first', expectedVersion: 0, settings, action: 'switch' };

test('concurrent requests claim exactly once, survive restart and preserve audit', async () => {
  const result = await Promise.all([createMovementStore(db).claim(input), createMovementStore(db).claim(input)]);
  assert.deepEqual(result.map(r => r.replay).sort(), [false, true]);
  await assert.rejects(createMovementStore(db).claim({ ...input, settings: { ...settings, enabled: false } }), /request_id_conflict/);
  await assert.rejects(createMovementStore(db).claim({ ...input, action: 'hours' }), /request_id_conflict/);
  await assert.rejects(createMovementStore(db).claim({ ...input, requestId: 'second' }), /settings_changed/);
  await assert.rejects(createMovementStore(db).claim({ ...input, requestId: 'second', expectedVersion: 1 }), /change_in_progress/);
  await createMovementStore(db).update({ imei, requestId: 'first', patch: { status: 'replies_observed', evidence: [{ replyObserved: true }] } });
  const state = await createMovementStore(db).read(imei);
  assert.equal(state.version, 1);
  assert.equal(state.status, 'replies_observed');
  assert.equal(state.appliedStateVerified, false);
  assert.equal((await createMovementStore(db).claim(input)).replay, true);
});

test('crash lease expiry never replays enable; only a fresh explicit Off can recover', async () => {
  const store = createMovementStore(db);
  await store.claim({ ...input, requestId: 'crash', expectedVersion: 1, nowMs: 1 });
  assert.equal((await store.read(imei)).status, 'unconfirmed');
  assert.equal((await store.claim({ ...input, requestId: 'crash', expectedVersion: 1 })).replay, true);
  await assert.rejects(store.claim({ ...input, requestId: 'unsafe', expectedVersion: 2 }), /turn_off_before_retry/);
  await assert.rejects(store.update({ imei, requestId: 'crash', patch: { nextCommand: 'SEDENTARY,1,20' } }), /dispatch_window_expired/);
  await store.claim({ ...input, requestId: 'cleanup', expectedVersion: 2, settings: { ...settings, enabled: false } });
  await assert.rejects(store.update({ imei, requestId: 'crash', patch: { status: 'replies_observed' } }), /operation_superseded/);
  assert.equal((await store.read(imei)).desired.enabled, false);
});

test('clients cannot read or forge movement settings/audit, including linked subscribers', async () => {
  await db.doc('users/pilot').set({ linkedImeis: [imei] });
  await db.doc('serviceSubscriptions/pilot').set({ version: 1, managedBy: 'guardian_admin', plan: 'care', status: 'active' });
  for (const user of [env.authenticatedContext('pilot'), env.authenticatedContext('stranger'), env.unauthenticatedContext()]) {
    for (const target of [`movementReminderSettings/${imei}`, 'movementReminderRequests/first']) {
      await assertFails(getDoc(doc(user.firestore(), target)));
      await assertFails(setDoc(doc(user.firestore(), target), { status: 'replies_observed', appliedStateVerified: true }));
    }
  }
});
