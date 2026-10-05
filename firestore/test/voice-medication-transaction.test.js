'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, updateDoc, deleteDoc } = require('firebase/firestore');
const admin = require('../../gateway/node_modules/firebase-admin');
const { createMedicationStore } = require('../../gateway/src/medication-settings-store');
const projectId = 'guardian-voice-medication-test', imei = '999999999999999', uid = 'owner';
let env, app, db;
before(async () => {
  env = await initializeTestEnvironment({ projectId, firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'rules.example'), 'utf8') } });
  app = admin.initializeApp({ projectId }, projectId); db = app.firestore();
  await db.doc(`users/${uid}`).set({ linkedImeis: [imei] });
  await db.doc(`serviceSubscriptions/${uid}`).set({ version: 1, managedBy: 'guardian_admin', plan: 'family', status: 'active' });
});
after(async () => { await app.delete(); await env.cleanup(); });
const access = { uid, imei, ownerUid: uid };
const request = { requestId: randomUUID(), id: 'voice-one', version: 0, action: 'save',
  settings: { time: '18:30', frequency: 1, enabled: true, text: 'Synthetic fixture', mode: 'voice' } };

test('two real transactions claim one slot and one idempotent operation', async () => {
  const input = { access, request, pcm: Buffer.alloc(8000), encoded: { audio: Buffer.from('synthetic'), durationMs: 500 } };
  const claims = await Promise.all([createMedicationStore(db).claim(input), createMedicationStore(db).claim(input)]);
  assert.deepEqual(claims.map(c => c.replay).sort(), [false, true]);
  const active = claims.find(c => !c.replay);
  await assert.rejects(createMedicationStore(db).claim({ ...input, request: { ...request, id: 'second', requestId: randomUUID() } }), /change_in_progress/);
  await createMedicationStore(db).update(active.value, 'reply_observed');
  const reminders = await createMedicationStore(db).list(imei);
  assert.equal(reminders.length, 1); assert.equal(reminders[0].status, 'reply_observed');
});

test('linked user can read public result but cannot author slot/audio/evidence or legacy overwrite', async () => {
  const client = env.authenticatedContext(uid).firestore();
  await assertSucceeds(getDoc(doc(client, 'medicationReminders/voice-one')));
  await assertFails(updateDoc(doc(client, 'medicationReminders/voice-one'), { enabled: false }));
  await assertFails(deleteDoc(doc(client, 'medicationReminders/voice-one')));
  await assertFails(setDoc(doc(client, 'medicationReminders/forged'), { imei, createdBy: uid, managed: 'voice-v1', slot: 1 }));
  await assertFails(setDoc(doc(client, 'deviceCommands/overwrite'), { imei, createdBy: uid, status: 'pending', type: 'set_medication_reminder', params: {} }));
  for (const who of [env.authenticatedContext(uid), env.authenticatedContext('stranger'), env.unauthenticatedContext()]) {
    for (const target of [`medicationVoicePrivate/voice-one`, `medicationVoiceDevices/${imei}`, `medicationVoiceRequests/${request.requestId}`]) {
      await assertFails(getDoc(doc(who.firestore(), target)));
      await assertFails(setDoc(doc(who.firestore(), target), { pcm: 'forged', status: 'reply_observed' }));
    }
  }
  await assertFails(getDoc(doc(env.authenticatedContext('stranger').firestore(), 'medicationReminders/voice-one')));
});

test('legacy records cannot be converted into managed records by clients', async () => {
  const otherImei = '888888888888888';
  await db.doc(`users/${uid}`).update({ linkedImeis: [imei, otherImei] });
  const client = env.authenticatedContext(uid).firestore();
  await assertSucceeds(setDoc(doc(client, 'medicationReminders/legacy'), { imei: otherImei, createdBy: uid, time: '08:00', frequency: 2, enabled: true }));
  await assertFails(updateDoc(doc(client, 'medicationReminders/legacy'), { managed: 'voice-v1' }));
  await assertFails(updateDoc(doc(client, 'medicationReminders/legacy'), { imei }));
});
