'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { configureWatchPhonebook, processWatchPhonebookRequest, provisionUnmanagedPhonebook, validateInventory } = require('../src/watch-phonebook');
const { MemoryDb, imei, protocolId, phone, inventory, request } = require('../test-fixtures/watch-phonebook-fixture');
const clock = Date.parse('2026-09-23T19:00:00Z');
const statePath = `watchPhonebookSettings/${imei}`, policyPath = `watchPhonebookPolicies/${imei}`;
async function fixture() {
  const db = new MemoryDb().seed(`devices/${imei}`, { protocolId }).seed('users/owner', { linkedImeis: [imei] });
  await configureWatchPhonebook(db, inventory());
  db.seed(policyPath, { ...db.get(policyPath), revision: 'revision-1' });
  return db.seed('watchPhonebookRequests/one', request(clock));
}
const never = () => assert.fail('must not write to watch');
const run = (db, send = never, requestId = 'one', now = clock) => processWatchPhonebookRequest(db, requestId, { now: () => now, send });

test('one-time setup imports occupied slots and exposes only confirmed free space; cannot reset reservations', async () => {
  const db = await fixture();
  assert.deepEqual(db.get(policyPath).emptySlots, [2, 3]);
  assert.equal(db.get(statePath).contacts[0].status, 'imported');
  await assert.rejects(configureWatchPhonebook(db, inventory()), /already_configured/);
  for (const patch of [{ inventoryConfirmed: false }, { emptySlots: [1] }, { emptySlots: [2, 2] },
    { emptySlots: [16] }, { emptySlots: [0] }, { managerUid: '../other' },
    { contacts: [{ slot: 1, name: 'Bad', phone: 'local-number' }] }]) {
    assert.throws(() => validateInventory({ ...inventory(), ...patch }));
  }
});

test('concurrent delivery of same request sends once, preserves existing entries and records reply without false physical proof', async () => {
  const db = await fixture(); let sends = 0;
  const send = (value, options) => {
    sends++; assert.equal(value.slot, 2); assert.equal(value.phone, phone); assert.equal(value.protocolId, protocolId);
    assert.equal(options.deadlineAt, clock + 30000);
    return { outcome: 'device_replied', frameHex: 'PRIVATE', appliedStateVerified: true };
  };
  await Promise.all([run(db, send), run(db, send)]);
  assert.equal(sends, 1);
  const state = db.get(statePath), result = db.get('watchPhonebookRequests/one');
  assert.equal(state.contacts.length, 2); assert.equal(state.contacts[0].name, 'Existing');
  assert.equal(state.contacts[1].status, 'device_replied'); assert.equal(state.contacts[1].appliedStateVerified, false);
  assert.equal(result.appliedStateVerified, false); assert.equal(result.frameHex, undefined);
  assert.deepEqual(db.get(policyPath).emptySlots, [3]);
});

test('unlinked users, linked nonmanagers, changed identity/policy, expired requests and command injection cannot send', async () => {
  for (const change of [
    db => db.seed('users/owner', { linkedImeis: [] }),
    db => db.seed(policyPath, { ...db.get(policyPath), managerUid: 'someone-else' }),
    db => db.seed(policyPath, { ...db.get(policyPath), managedBy: 'client' }),
    db => db.seed(`devices/${imei}`, { protocolId: '9700000001' }),
    ...[{ policyRevision: 'old' }, { slot: 1 }, { command: 'RESET' }, { name: 'bad\nname' },
      { phone: `${phone},0` }, { expiresAt: new Date(clock - 1) }, { expiresAt: new Date(clock + 600000) }]
      .map(patch => db => db.seed('watchPhonebookRequests/one', { ...request(clock), ...patch })),
  ]) {
    const db = await fixture(); change(db); await run(db);
    assert.equal(db.get('watchPhonebookRequests/one').status, 'not_sent');
    assert.equal(db.get(statePath).contacts.length, 1);
  }
});

test('different requests cannot contend for a slot while send awaits reply; duplicate number cannot consume a second slot', async () => {
  const db = await fixture(); let enter, finish;
  const entered = new Promise(resolve => { enter = resolve; });
  const first = run(db, () => { enter(); return new Promise(resolve => { finish = resolve; }); });
  await entered;
  db.seed('watchPhonebookRequests/two', { ...request(clock), phone: '+23050000002' });
  assert.equal((await run(db, never, 'two')).outcome, 'change_in_progress');
  finish({ outcome: 'device_replied' }); await first;
  db.seed('watchPhonebookRequests/three', { ...request(clock), phone: '+230 5000 0000' });
  assert.equal((await run(db, never, 'three')).outcome, 'already_reserved');
  assert.deepEqual(db.get(policyPath).emptySlots, [3]);
});

test('uncertain writes and lost results quarantine slot and number permanently until operator review; no crash replay', async () => {
  for (const lostResult of [false, true]) {
    const db = await fixture(); let sends = 0;
    if (lostResult) db.failTransaction = db.transactions + 2;
    await run(db, () => { sends++; return { outcome: 'handoff_unknown', reason: 'watch_reply_missing' }; });
    await run(db, never, 'one', clock + 31000);
    db.seed('watchPhonebookRequests/two', request(clock + 31000));
    assert.equal((await run(db, never, 'two', clock + 31000)).outcome, 'already_reserved');
    assert.equal(sends, 1); assert.deepEqual(db.get(policyPath).emptySlots, [3]);
    assert.equal(db.get(statePath).contacts[1].slot, 2);
  }
});

test('pre-write failures alone allow explicit retry of exactly the same contact in its reserved slot', async () => {
  const db = await fixture();
  await run(db, () => ({ outcome: 'not_sent', reason: 'no_fresh_identified_session' }));
  db.seed('watchPhonebookRequests/two', { ...request(clock), name: 'Changed' });
  assert.equal((await run(db, never, 'two')).outcome, 'replacement_unavailable');
  db.seed('watchPhonebookRequests/three', request(clock));
  await run(db, value => { assert.equal(value.slot, 2); return { outcome: 'device_replied' }; }, 'three');
  assert.deepEqual(db.get(policyPath).emptySlots, [3]);
});

test('a current Calls lease and a post-claim deadline prevent contact writes', async () => {
  const db = await fixture(); db.seed(`watchCallSettings/${imei}`, { leaseUntil: new Date(clock + 1000) });
  assert.equal((await run(db)).outcome, 'change_in_progress');
  const other = await fixture(); let reads = 0;
  await processWatchPhonebookRequest(other, 'one', { now: () => clock + (reads++ ? 31000 : 0), send: never });
  assert.equal(other.get('watchPhonebookRequests/one').reason, 'expired_before_handoff');
});

test('legacy admin path and protocol-ID aliases cannot bypass managed inventory', async () => {
  const db = await fixture();
  await assert.rejects(provisionUnmanagedPhonebook(db, { imei }, { send: never }), /use_watch_contacts/);
  await assert.rejects(provisionUnmanagedPhonebook(db, { imei: protocolId }, { send: never }), /full_imei/);
  const unmanaged = new MemoryDb(); let sends = 0;
  const result = await provisionUnmanagedPhonebook(unmanaged, { imei }, { send: () => { sends++; return { ok: true }; } });
  assert.equal(result.ok, true); assert.equal(sends, 1);
});
