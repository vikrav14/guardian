'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc } = require('firebase/firestore');
const admin = require('../../gateway/node_modules/firebase-admin');
const { recoverGpsHistory, saveRecoveredJourney } = require('../../gateway/src/journey-history-recovery');

const imei = '123456789012345', projectId = 'guardian-journey-recovery-test';
let env, app, db;
before(async () => {
  env = await initializeTestEnvironment({ projectId,
    firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'rules.example'), 'utf8') } });
  app = admin.initializeApp({ projectId }, projectId); db = app.firestore();
  await db.doc('users/linked').set({ linkedImeis: [imei] });
  await db.doc('serviceSubscriptions/linked').set({ version: 1, managedBy: 'guardian_admin', plan: 'care', status: 'active' });
  await db.doc(`devices/${imei}`).set({ imei, nickname: 'Synthetic wearer' });
});
after(async () => { await app.delete(); await env.cleanup(); });

test('actual Firestore transaction stores a readable, timestamped journey once and keeps recovery locks private', async () => {
  const base = Date.parse('2026-09-01T10:00:00Z');
  const points = [0, 1, 2, 1, 0].map((offset, i) => ({ lat: -20.25 + offset * 0.002, lng: 57.5,
    source: 'gps', gpsValid: true, recordedAt: new Date(base + i * 60000) }));
  const candidate = recoverGpsHistory(points).journeys[0];
  assert.equal((await saveRecoveredJourney(db, imei, candidate)).outcome, 'preview');
  const [one, two] = await Promise.all([
    saveRecoveredJourney(db, imei, candidate, { apply: true }),
    saveRecoveredJourney(db, imei, candidate, { apply: true }),
  ]);
  assert.deepEqual([one.outcome, two.outcome].sort(), ['already_recorded', 'recovered']);
  const journeys = await db.collection(`devices/${imei}/journeys`).get();
  assert.equal(journeys.size, 1);
  assert.equal(journeys.docs[0].data().startAt.toMillis(), base);
  assert.equal(journeys.docs[0].data().pointCount, 5);
  const linked = env.authenticatedContext('linked').firestore();
  await assertSucceeds(getDoc(doc(linked, `devices/${imei}/journeys/${journeys.docs[0].id}`)));
  await assertFails(setDoc(doc(linked, `devices/${imei}/journeys/fake`), candidate));
  const locks = await db.collection('journeyRecoveryLocks').get();
  assert.equal(locks.size, 1);
  await assertFails(getDoc(doc(linked, locks.docs[0].ref.path)));
  await assertFails(setDoc(doc(linked, locks.docs[0].ref.path), { revision: 100 }));
  assert.equal((await db.collection(`devices/${imei}/alerts`).get()).size, 0);
  assert.equal((await db.doc(`devices/${imei}`).get()).data().location, undefined);
});
