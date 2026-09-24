'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { configureWatchCalls, processWatchCallRequest } = require('../src/watch-calls');
const { imei, protocolId, phone, capturedFrames, callRequest, callPolicy } = require('../test-fixtures/watch-call-fixture');

const clock = Date.parse('2026-09-23T18:00:00Z');
class MemoryDb {
  constructor() { this.rows = new Map(); this.tail = Promise.resolve(); this.transactions = 0; this.failTransaction = null; }
  collection(name) { return { doc: id => ({ path: `${name}/${id}` }) }; }
  seed(path, data) { this.rows.set(path, structuredClone(data)); return this; }
  get(path) { return structuredClone(this.rows.get(path)); }
  runTransaction(body) {
    const work = this.tail.then(async () => {
      this.transactions++;
      if (this.transactions === this.failTransaction) throw new Error('synthetic database failure');
      const writes = [];
      const result = await body({
        get: async ref => ({ exists: this.rows.has(ref.path), data: () => this.get(ref.path) }),
        set: (ref, data, options) => writes.push({ ref, data, merge: options?.merge }),
        update: (ref, data) => writes.push({ ref, data, merge: true }),
      });
      for (const { ref, data, merge } of writes) this.seed(ref.path, merge ? { ...this.get(ref.path), ...data } : data);
      return result;
    });
    this.tail = work.catch(() => {});
    return work;
  }
}
function fixture(mode = 'auto') {
  return new MemoryDb()
    .seed(`devices/${imei}`, { protocolId })
    .seed(`watchCallPolicies/${imei}`, callPolicy())
    .seed('users/owner', { linkedImeis: [imei] })
    .seed('serviceSubscriptions/owner', { version: 1, managedBy: 'guardian_admin', status: 'active', plan: 'family' })
    .seed('watchCallRequests/request1', callRequest(mode, clock));
}
const neverSend = () => assert.fail('watch must receive nothing');

test('operator setup binds to known device, hides capture from projection, and changes no mode', async () => {
  const db = fixture();
  const result = await configureWatchCalls(db, { imei, capture: capturedFrames() });
  assert.equal(result.watchCommandSent, false);
  const state = db.get(`watchCallSettings/${imei}`);
  assert.equal(state.configured, true);
  assert.equal(state.lastHandoffMode, undefined);
  assert.ok(!JSON.stringify(state).includes(phone));
  assert.equal(state.capture, undefined);
  assert.notEqual(state.policyRevision, 'revision-1');
  db.seed(`devices/${imei}`, { protocolId: '9700000001' });
  await assert.rejects(configureWatchCalls(db, { imei, capture: capturedFrames() }), /device_identity_mismatch/);
});

test('linked Family guardian sends captured Auto once and persists redacted request evidence', async () => {
  const db = fixture(); let sends = 0;
  const send = input => {
    sends++; assert.equal(input.mode, 'auto'); assert.deepEqual(input.capture, capturedFrames());
    return { outcome: 'socket_handoff', frame: phone, extra: phone };
  };
  await Promise.all([1, 2].map(() => processWatchCallRequest(db, 'request1', { now: () => clock, send })));
  assert.equal(sends, 1);
  const request = db.get('watchCallRequests/request1'), state = db.get(`watchCallSettings/${imei}`);
  assert.equal(request.status, 'socket_handoff'); assert.equal(request.appliedStateVerified, false);
  assert.equal(state.lastHandoffMode, 'auto'); assert.equal(state.leaseUntil, null);
  assert.ok(!JSON.stringify([request, state]).includes(phone));
});

test('untrusted request content, revoked links, stale intent and changed policy write nothing', async () => {
  for (const change of [
    db => db.seed('watchCallRequests/request1', { ...callRequest('auto', clock), consentAccepted: false }),
    db => db.seed('watchCallRequests/request1', { ...callRequest('auto', clock), frame: phone }),
    db => db.seed('watchCallRequests/request1', { ...callRequest('auto', clock), expiresAt: new Date(clock - 1) }),
    db => db.seed('watchCallRequests/request1', { ...callRequest('auto', clock), expiresAt: new Date(clock + 1000000) }),
    db => db.seed('users/owner', { linkedImeis: [] }),
    db => db.seed('serviceSubscriptions/owner', { version: 1, managedBy: 'client', status: 'active', plan: 'care' }),
    db => db.seed('users/owner', { linkedImeis: [imei], serviceOwnerUid: 'someone-else' }),
    db => db.seed(`watchCallPolicies/${imei}`, { ...callPolicy(), autoEnabled: false }),
    db => db.seed(`watchCallPolicies/${imei}`, { ...callPolicy(), revision: 'revision-2' }),
    db => db.seed(`watchCallPolicies/${imei}`, { ...callPolicy(), protocolId: '9700000001' }),
    db => db.seed(`watchCallSettings/${imei}`, { leaseUntil: new Date(clock + 5000) }),
    db => db.seed(`watchCallSettings/${imei}`, { latestRequestedAt: new Date(clock) }),
  ]) {
    const db = fixture(); change(db);
    await processWatchCallRequest(db, 'request1', { now: () => clock, send: neverSend });
    assert.equal(db.get('watchCallRequests/request1').status, 'not_sent');
  }
});

test('verified family membership grants Auto, but display-only family membership does not', async () => {
  for (const verified of [false, true]) {
    const db = fixture(); let sends = 0;
    db.seed('users/member', { linkedImeis: [imei], serviceOwnerUid: 'owner' });
    db.seed('users/owner', { linkedImeis: [imei], familyMembers: [{ uid: 'member' }], memberUids: verified ? ['member'] : [] });
    db.seed('watchCallRequests/request1', { ...callRequest('auto', clock), requestedBy: 'member' });
    await processWatchCallRequest(db, 'request1', { now: () => clock, send: () => { sends++; return { outcome: 'socket_handoff' }; } });
    assert.equal(sends, verified ? 1 : 0);
  }
});

test('Manual remains available after service expiry and Auto disablement', async () => {
  const db = fixture('manual');
  db.seed('serviceSubscriptions/owner', { version: 1, managedBy: 'guardian_admin', status: 'expired', plan: 'family' });
  db.seed(`watchCallPolicies/${imei}`, { ...callPolicy(), autoEnabled: false });
  let sends = 0;
  await processWatchCallRequest(db, 'request1', { now: () => clock, send: input => {
    sends++; assert.equal(input.mode, 'manual'); return { outcome: 'socket_handoff' };
  } });
  assert.equal(sends, 1); assert.equal(db.get(`watchCallSettings/${imei}`).lastHandoffMode, 'manual');
});

test('expired lease after a slow claim cannot hand off commands', async () => {
  const db = fixture(); let calls = 0;
  await processWatchCallRequest(db, 'request1', { now: () => clock + (calls++ === 0 ? 0 : 31000), send: neverSend });
  assert.equal(db.get('watchCallRequests/request1').reason, 'expired_before_handoff');
});

test('socket uncertainty is recorded without private errors, retry or a false mode confirmation', async () => {
  const db = fixture(); let sends = 0;
  const options = { now: () => clock, send: () => { sends++; throw new Error(phone); } };
  await processWatchCallRequest(db, 'request1', options);
  await processWatchCallRequest(db, 'request1', options);
  assert.equal(sends, 1);
  assert.equal(db.get('watchCallRequests/request1').status, 'handoff_unknown');
  assert.equal(db.get(`watchCallSettings/${imei}`).lastHandoffMode, undefined);
  assert.ok(!JSON.stringify(db.get('watchCallRequests/request1')).includes(phone));
});

test('lost result after handoff is not replayed, while a later explicit Manual can restore', async () => {
  const db = fixture(); db.failTransaction = 2; let sends = 0;
  const send = () => { sends++; return { outcome: 'socket_handoff' }; };
  assert.equal((await processWatchCallRequest(db, 'request1', { now: () => clock, send })).outcome, 'handoff_unknown');
  assert.equal(db.get('watchCallRequests/request1').status, 'sending');
  await processWatchCallRequest(db, 'request1', { now: () => clock + 31000, send });
  assert.equal(sends, 1);
  db.seed('watchCallRequests/request2', callRequest('manual', clock + 31000));
  await processWatchCallRequest(db, 'request2', { now: () => clock + 31000, send });
  assert.equal(sends, 2); assert.equal(db.get(`watchCallSettings/${imei}`).lastHandoffMode, 'manual');
});

test('app request holds its lease while awaiting transport replies and stores only bounded evidence', async () => {
  const db = fixture('manual');
  let complete, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const run = processWatchCallRequest(db, 'request1', { now: () => clock, send: async (input, options) => {
    assert.equal(input.mode, 'manual'); assert.equal(options.deadlineAt, clock + 30000);
    entered(); return new Promise(resolve => { complete = resolve; });
  } });
  await started;
  assert.equal(db.get('watchCallRequests/request1').status, 'sending');
  assert.equal(db.get(`watchCallSettings/${imei}`).leaseUntil.getTime(), clock + 30000);
  complete({ outcome: 'device_replied', receivedReplies: ['APPLOCK', phone, 'ACALL', 'ACALL'], frame: phone });
  await run;
  const request = db.get('watchCallRequests/request1');
  assert.equal(request.status, 'device_replied'); assert.equal(request.appliedStateVerified, false);
  assert.deepEqual(request.receivedReplies, ['APPLOCK', 'ACALL']); assert.equal(request.deviceReplyObserved, true);
  assert.equal(db.get(`watchCallSettings/${imei}`).lastHandoffMode, 'manual');
  assert.ok(!JSON.stringify(request).includes(phone));
});

test('missing watch reply cannot become a confirmed reply or replace last handed-off mode', async () => {
  const db = fixture('manual'); db.seed(`watchCallSettings/${imei}`, { lastHandoffMode: 'auto' });
  await processWatchCallRequest(db, 'request1', { now: () => clock, send: async () => ({
    outcome: 'handoff_unknown', reason: 'watch_reply_missing', receivedReplies: ['APPLOCK'],
  }) });
  const request = db.get('watchCallRequests/request1');
  assert.equal(request.status, 'handoff_unknown'); assert.equal(request.deviceReplyObserved, false);
  assert.deepEqual(request.expectedReplies, ['APPLOCK', 'ACALL']);
  assert.equal(db.get(`watchCallSettings/${imei}`).lastHandoffMode, 'auto');
});
