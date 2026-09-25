'use strict';
const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const admin = require('../../gateway/node_modules/firebase-admin');
const { createSnapshotController } = require('../../gateway/src/safety-snapshot-live');
const jpeg = require('../../gateway/test/fixtures/photo-synthetic');
const projectId = 'guardian-snapshot-live-transaction-test';
let app, db;
before(async () => {
  assert(process.env.FIRESTORE_EMULATOR_HOST, 'This test must run only against the emulator');
  app = admin.initializeApp({ projectId }, projectId); db = app.firestore();
  await db.doc('users/owner').set({ linkedImeis: ['861397052547492'], memberUids: ['member'] });
  await db.doc('users/member').set({ linkedImeis: ['861397052547492'], serviceOwnerUid: 'owner' });
  await db.doc('serviceSubscriptions/owner').set({ version: 1, managedBy: 'guardian_admin', plan: 'family', status: 'active' });
});
after(async () => { if (app) await app.delete(); });

test('real Firestore transactions allow only one incident command across workers and duplicate alarms', async () => {
  const { createIncidentPhotos } = require('../../gateway/src/incident-photos');
  const { CONSENT_VERSION } = require('../../gateway/src/incident-photo-policy');
  const imei = '999999999999999';
  await db.doc('users/owner').update({ linkedImeis: admin.firestore.FieldValue.arrayUnion(imei) });
  await db.doc(`safetySnapshotDeviceLocks/${imei}`).delete();
  await db.doc(`incidentPhotoSettings/${imei}`).set({ ownerUid: 'owner', enabled: true,
    consentConfirmed: true, aiConsentConfirmed: false, consentVersion: CONSENT_VERSION });
  const date = new Date();
  for (const id of ['firstIncident', 'duplicateIncident']) await db.doc(`alerts/${id}`).set({
    imei, type: 'sos', eventAt: date, incidentPhotoPending: true, incidentPhotoEligible: true,
  });
  const writes = [];
  const socket = { write: (bytes, callback) => { writes.push(bytes.toString()); callback?.(); return true; } };
  const args = { db, bucket: {}, findSessions: () => [{ socket, session: { imei, protocolId: '9999999999' } }],
    runtime: { deviceDispatchAllowed: true, acceptedImeis: [imei], manualTestEnabled: false }, now: () => date };
  const one = createIncidentPhotos({ db, snapshots: createSnapshotController(args), enabled: true, trialOnly: false, now: () => date });
  const two = createIncidentPhotos({ db, snapshots: createSnapshotController(args), enabled: true, trialOnly: false, now: () => date });
  await Promise.all([one.enqueue('firstIncident'), two.enqueue('firstIncident')]);
  await two.enqueue('duplicateIncident');
  await Promise.all([one.tick('firstIncident'), two.tick('firstIncident')]);
  assert.deepEqual(writes, ['[3G*9999999999*0008*rcapture]']);
  const incident = (await db.doc('incidentPhotos/firstIncident').get()).data();
  assert.equal(incident.requestIds.length, 1);
  assert.equal((await db.doc('alerts/duplicateIncident').get()).data().photoIncidentId, 'firstIncident');
  await db.doc(`safetySnapshotDeviceLocks/${imei}`).delete();
});

test('real Firestore transactions serialize capture, store a private image and recover deletion', async () => {
  // Use the observed wire ID independently of the production conversion.
  const imei = '861397052547492', protocolId = '9705254749';
  const sent = [], objects = new Map();
  const socket = { write(bytes, callback) { sent.push(bytes.toString()); callback?.(); return true; } };
  const session = { imei, protocolId };
  const args = { db, runtime: { deviceDispatchAllowed: true, acceptedImeis: [imei] },
    findSessions: () => [{ socket, session }],
    bucket: { file: path => ({
      save: async bytes => { objects.set(path, bytes); },
      download: async () => [objects.get(path)],
      delete: async () => { objects.delete(path); },
    }) },
  };
  const one = createSnapshotController(args), two = createSnapshotController(args);
  const input = { imei, purpose: 'Check immediate surroundings', consentConfirmed: true, safetyPurposeConfirmed: true };
  const results = await Promise.allSettled([one.request('owner', input), two.request('member', input)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.deepEqual(sent, ['[3G*9705254749*0008*rcapture]']);
  const winner = results[0].status === 'fulfilled' ? one : two;
  const id = results.find(result => result.status === 'fulfilled').value;
  const escapes = new Map([[0x7d, 1], [0x5b, 2], [0x5d, 3], [0x2c, 4], [0x2a, 5]]);
  const media = Buffer.from([...Buffer.concat([jpeg, Buffer.alloc(1)])].flatMap(byte => escapes.has(byte) ? [0x7d, escapes.get(byte)] : [byte]));
  const payload = Buffer.concat([Buffer.from('img,5,260925002653,'), media]);
  const frame = Buffer.concat([Buffer.from(`[3G*${protocolId}*${payload.length.toString(16).padStart(4, '0')}*`), payload, Buffer.from(']')]);
  winner.observe(frame, socket, session);
  let record;
  for (let attempt = 0; attempt < 100; attempt++) {
    record = (await db.doc(`safetySnapshotAuthorizations/${id}`).get()).data();
    if (record.state === 'available') break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(record.state, 'available');
  assert.deepEqual(await winner.image('owner', id), jpeg);
  assert.equal((await winner.list('member', imei)).snapshots.length, 1);
  await winner.remove('member', id);
  assert.equal(objects.size, 0);
  await assert.rejects(winner.image('owner', id), /photo_unavailable/);
});
