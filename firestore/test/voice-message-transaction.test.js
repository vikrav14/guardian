'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const {
  initializeTestEnvironment,
  assertFails,
} = require('@firebase/rules-unit-testing');
const {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  collection,
  getDocs,
} = require('firebase/firestore');
const admin = require('../../gateway/node_modules/firebase-admin');
const { createVoiceStore } = require('../../gateway/src/voice-message-store');
const projectId = 'guardian-voice-message-test',
  imei = '999999999999999',
  uid = 'owner';
let env, app, db;
before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: fs.readFileSync(
        path.join(__dirname, '..', 'rules.example'),
        'utf8',
      ),
    },
  });
  app = admin.initializeApp({ projectId }, projectId);
  db = app.firestore();
  await db.doc(`users/${uid}`).set({ linkedImeis: [imei] });
});
after(async () => {
  await app.delete();
  await env.cleanup();
});
const access = { uid, imei, ownerUid: uid };
const input = {
  access,
  id: randomUUID(),
  direction: 'outgoing',
  audio: Buffer.from('synthetic'),
  pcm: Buffer.alloc(16000),
  durationMs: 1000,
};

test('concurrent Firestore transactions produce one durable dispatch claim and private asset', async () => {
  const store = createVoiceStore(db);
  const claims = await Promise.all([store.put(input), store.put(input)]);
  assert.deepEqual(claims.map((c) => c.replay).sort(), [false, true]);
  assert((await db.doc(`voiceMessagePrivate/${input.id}`).get()).exists);
  await assert.rejects(
    store.put({ ...input, id: randomUUID() }),
    /delivery_unconfirmed/,
  );
  await store.update(claims[0].row, 'unconfirmed');
  await store.remove(access, input.id);
  assert.equal(
    (await db.doc(`voiceMessagePrivate/${input.id}`).get()).exists,
    false,
  );
  // Deleting private audio does not silently release an uncertain command.
  await assert.rejects(
    createVoiceStore(db).put({ ...input, id: randomUUID() }),
    /delivery_unconfirmed/,
  );
});

test('private audio, receipts and delivery locks deny all direct client access including linked owners', async () => {
  for (const who of [
    env.authenticatedContext(uid),
    env.authenticatedContext('stranger'),
    env.unauthenticatedContext(),
  ]) {
    for (const name of [
      'voiceMessages',
      'voiceMessagePrivate',
      'voiceMessageDevices',
    ]) {
      const target = doc(who.firestore(), `${name}/${input.id}`);
      await assertFails(getDoc(target));
      await assertFails(getDocs(collection(who.firestore(), name)));
      await assertFails(
        setDoc(target, {
          imei,
          uid,
          status: 'reply_observed',
          pcm: 'synthetic',
        }),
      );
      await assertFails(deleteDoc(target));
    }
  }
});

test('AI costs and selections deny direct client reads, enumeration and budget forgery', async () => {
  for (const who of [env.authenticatedContext(uid), env.authenticatedContext('stranger'), env.unauthenticatedContext()]) {
    for (const name of ['aiBudgetMonths', 'aiBudgetDays', 'aiAttempts', 'aiSelections']) {
      const ref = doc(who.firestore(), name, 'test-budget');
      await assertFails(getDoc(ref));
      await assertFails(getDocs(collection(who.firestore(), name)));
      await assertFails(setDoc(ref, { charged: 0, plan: 'care', state: 'complete' }));
      await assertFails(deleteDoc(ref));
    }
  }
});

test('real Firestore transactions reserve the AI ceiling once across competing callers', async () => {
  const { createLedger } = require('../../gateway/src/intelligence-core/ledger');
  const { policy } = require('../../gateway/src/intelligence-core/policy');
  const ledger = createLedger(db, { limits: { ...policy({}), family: 1000, fleet: 10000, routineShare: 1 } });
  const request = { serviceKey: randomUUID(), plan: 'family', attempt: 1, feature: 'question',
    model: 'claude-haiku-4-5-20251001', inputTokens: 100, maxTokens: 100 };
  const result = await Promise.allSettled(Array.from({ length: 4 }, (_, i) => ledger.reserve({ ...request, jobId: 'job-' + i })));
  assert.equal(result.filter(r => r.status === 'fulfilled').length, 1);
  assert(result.filter(r => r.status === 'rejected').every(r => r.reason.code === 'ai_budget_reached'));
  const claim = result.find(r => r.status === 'fulfilled').value;
  await ledger.settle(claim, { input_tokens: 100, output_tokens: 10 });
  await ledger.settle(claim, { input_tokens: 0, output_tokens: 0 });
  assert.equal((await claim.service.get()).data().charged, 150);
});

test('real query, per-user playback and expired media cleanup do not depend on client rules', async () => {
  let now = Date.now();
  const store = createVoiceStore(db, () => now);
  const received = { ...input, id: 'in_synthetic', direction: 'incoming' };
  await store.put(received);
  const inbox = await store.list(access);
  assert.equal(inbox.messages.length, 1);
  assert.equal(inbox.messages[0].played, false);
  await store.markPlayed(access, received.id);
  assert.equal((await store.list(access)).messages[0].played, true);
  await assert.rejects(
    store.audio({ ...access, uid: 'stranger' }, received.id),
    /message_unavailable/,
  );
  now += 86400001;
  await assert.rejects(store.audio(access, received.id), /message_unavailable/);
  await store.cleanup();
  assert.equal(
    (await db.doc(`voiceMessagePrivate/${received.id}`).get()).exists,
    false,
  );
});
