'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, getDoc, runTransaction, serverTimestamp, writeBatch } = require('firebase/firestore');

let env;
const watchA = '999999999999999';
const watchB = '999999999999998';
const snapshot = {
  version: 1, policy: 'map_retained_satellite_v1', state: 'last_known',
  capturedAt: new Date('2026-09-01T12:00:00Z'),
  location: { lat: -20.25, lng: 57.5, source: 'gps' },
};

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'guardian-bulk-alerts-rules',
    firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'rules.example'), 'utf8') },
  });
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    const batch = writeBatch(db);
    batch.set(doc(db, 'users', 'linked'), { linkedImeis: [watchA, watchB] });
    for (let i = 0; i < 100; i++) {
      batch.set(doc(db, 'alerts', `recent-${i}`), {
        imei: i % 2 ? watchA : watchB, type: 'sos', resolved: false,
        notifyStatus: 'sent', sosLocationSnapshot: snapshot,
      });
    }
    for (const [id, imei] of [['allowed', watchA], ['unrelated', '999999999999997'], ['tamper', watchB]]) {
      batch.set(doc(db, 'alerts', id), { imei, type: 'sos', resolved: false, sosLocationSnapshot: snapshot });
    }
    await batch.commit();
  });
});

after(async () => { await env.cleanup(); });

test('existing rules permit the full 100-alert transaction and retain SOS evidence', async () => {
  const db = env.authenticatedContext('linked').firestore();
  const refs = Array.from({ length: 100 }, (_, i) => doc(db, 'alerts', `recent-${i}`));
  const before = (await getDoc(refs[0])).data();
  // Same wire operations as AlertService.resolveMany: linked profile, all
  // selected reads, then only resolved/resolvedAt writes in one transaction.
  await assertSucceeds(runTransaction(db, async transaction => {
    await transaction.get(doc(db, 'users', 'linked'));
    const records = await Promise.all(refs.map(ref => transaction.get(ref)));
    for (const record of records) {
      if (!record.data().resolved) {
        transaction.update(record.ref, { resolved: true, resolvedAt: serverTimestamp() });
      }
    }
  }));
  const records = await Promise.all(refs.map(ref => getDoc(ref)));
  assert.ok(records.every(record => record.data().resolved === true && record.data().resolvedAt));
  assert.deepEqual(records[0].data().sosLocationSnapshot, before.sosLocationSnapshot);
  assert.equal(records[0].data().notifyStatus, 'sent');
});

test('an unauthorized target rejects the whole group without clearing the allowed record', async () => {
  const db = env.authenticatedContext('linked').firestore();
  const allowed = doc(db, 'alerts', 'allowed');
  const unrelated = doc(db, 'alerts', 'unrelated');
  await assertFails(runTransaction(db, async transaction => {
    const records = await Promise.all([transaction.get(allowed), transaction.get(unrelated)]);
    for (const record of records) {
      transaction.update(record.ref, { resolved: true, resolvedAt: serverTimestamp() });
    }
  }));
  assert.equal((await getDoc(allowed)).data().resolved, false);
});

test('bulk writes cannot change an SOS snapshot or partially clear other alerts', async () => {
  const db = env.authenticatedContext('linked').firestore();
  const allowed = doc(db, 'alerts', 'allowed');
  const batch = writeBatch(db);
  batch.update(allowed, { resolved: true, resolvedAt: serverTimestamp() });
  batch.update(doc(db, 'alerts', 'tamper'), { resolved: true, sosLocationSnapshot: null });
  await assertFails(batch.commit());
  assert.equal((await getDoc(allowed)).data().resolved, false);
});
