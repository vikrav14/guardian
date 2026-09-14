'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const { initializeTestEnvironment, assertFails } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc } = require('firebase/firestore');
const admin = require('../../gateway/node_modules/firebase-admin');
const { ActivityStepsStore } = require('../../gateway/src/activity-steps');

const projectId = 'guardian-activity-counter-test', imei = '999999999999999';
let env, app, db;
before(async () => {
  env = await initializeTestEnvironment({ projectId,
    firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'rules.example'), 'utf8') } });
  app = admin.initializeApp({ projectId }, projectId); db = app.firestore();
  await db.doc('users/linked').set({ linkedImeis: [imei] });
  await db.doc('serviceSubscriptions/linked').set({ version: 1, managedBy: 'guardian_admin', plan: 'care', status: 'active' });
});
after(async () => { await app.delete(); await env.cleanup(); });

test('Firestore contention, restart and midnight preserve one daily increase and private accounting', async () => {
  const store = () => new ActivityStepsStore(db, { enabled: true });
  const ingest = (raw, at) => store().ingest({ imei, stepsRaw: raw }, new Date(at));
  await ingest(20000, '2026-09-14T19:59:00Z');
  await ingest(20000, '2026-09-14T20:01:00Z');
  const results = await Promise.all([ingest(20098, '2026-09-14T20:06:00Z'), ingest(20098, '2026-09-14T20:06:00Z')]);
  assert.deepEqual(results.map(result => result.status).sort(), ['ignored_stale', 'stored']);
  const prefix = `devices/${imei}`;
  const today = (await db.doc(`${prefix}/activityDays/2026-09-15`).get()).data();
  assert.equal(today.recordedSteps, 98); assert.equal(today.reportedSteps, null);
  assert.equal((await db.doc(`${prefix}/activityDays/2026-09-14`).get()).data().recordedSteps, 0);
  assert.equal((await db.doc(`${prefix}/activityState/counter`).get()).data().lastRaw, 20098);
  const intervals = await db.collection(`${prefix}/activityIntervals`).get();
  assert.equal(intervals.size, 3);
  const linked = env.authenticatedContext('linked').firestore();
  for (const target of [`${prefix}/activityState/counter`, intervals.docs[0].ref.path,
    `${prefix}/activityDays/2026-09-15`]) {
    await assertFails(getDoc(doc(linked, target)));
    await assertFails(setDoc(doc(linked, target), { recordedSteps: 99999 }));
  }
  assert.equal((await db.doc(prefix).get()).exists, false);
  assert.equal((await db.collection(`${prefix}/journeys`).get()).size, 0);
});
