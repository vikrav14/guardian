'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { MemoryDb } = require('../test-fixtures/watch-phonebook-fixture');
const { imei, protocolId, phone, callPolicy, callRequest } = require('../test-fixtures/watch-call-fixture');
const { configureEmergencyCalls, processEmergencyRequest, admitWatchEmergency, reconcileEmergencyCall, WINDOW_MS } = require('../src/watch-emergency-calls');
const { processWatchCallRequest } = require('../src/watch-calls');
const start = Date.parse('2026-09-23T21:00:00Z');
const statePath = `watchEmergencySettings/${imei}`, jobPath = `watchEmergencyJobs/${imei}`;
const user = () => ({ linkedImeis: [imei], emergencyContacts: [{ phone: '+23050000000', isPrimary: true }] });
function fixture() {
  return new MemoryDb().seed(`devices/${imei}`, { protocolId })
    .seed(`watchCallPolicies/${imei}`, callPolicy()).seed('users/owner', user())
    .seed('serviceSubscriptions/owner', { version: 1, managedBy: 'guardian_admin', status: 'active', plan: 'family' });
}
const alarm = (at = start, type = 'sos') => ({ imei, protocolId, type: 'alarm', alarmType: type,
  alarmCommand: 'AL_LTE', alarmCode: type === 'sos' ? '00010000' : '00400000', alarmRecordedAt: new Date(at) });
const replied = () => ({ outcome: 'device_replied' });
const never = () => assert.fail('must not send');
async function configure(db) { await configureEmergencyCalls(db, { imei, managerUid: 'owner' }, { now: () => start }); }
function request(db, enabled, clock = start, id = 'pref') {
  db.seed(`watchEmergencyRequests/${id}`, { imei, requestedBy: 'owner', revision: db.get(statePath).revision,
    enabled, consentAccepted: enabled, createdAt: new Date(clock), expiresAt: new Date(clock + 60000), status: 'pending' });
  return processEmergencyRequest(db, id, { now: () => clock });
}
async function armed(db) {
  await configure(db); await request(db, true);
  await reconcileEmergencyCall(db, imei, { now: () => start, send: input => { assert.equal(input.mode, 'manual'); return replied(); } });
  assert.equal(db.get(statePath).ready, true);
}

test('setup is disabled; enabling establishes Manual before any incident can Auto-answer', async () => {
  const db = fixture(); await configure(db);
  assert.equal(db.get(statePath).enabled, false); assert.equal(db.get(jobPath), undefined);
  await request(db, true);
  assert.equal((await admitWatchEmergency(db, alarm(), new Date(start), { now: () => start })).outcome, 'not_armed');
  await reconcileEmergencyCall(db, imei, { now: () => start, send: input => { assert.equal(input.mode, 'manual'); return replied(); } });
  assert.equal(db.get(statePath).status, 'manual_replied');
  assert.ok(!JSON.stringify(db.get(statePath)).includes(phone));
});

for (const kind of ['sos', 'fall']) test(`${kind}: one durable window, same proven caller capture, then Manual at expiry`, async () => {
  const db = fixture(); await armed(db); let writes = [];
  const send = async (input, options) => {
    assert.equal(db.get(jobPath).active, true); // durable restoration precedes Auto
    assert.equal(await options.beforeWrite(), true);
    writes.push(input.mode); return replied();
  };
  assert.equal((await admitWatchEmergency(db, alarm(start, kind), new Date(start), { now: () => start })).outcome, 'admitted');
  await Promise.all([1, 2].map(() => reconcileEmergencyCall(db, imei, { now: () => start, send })));
  assert.deepEqual(writes, ['auto']);
  const expiry = db.get(jobPath).endsAt.getTime();
  for (const t of [0, 20000, 100000]) {
    assert.equal((await admitWatchEmergency(db, alarm(start + t, kind), new Date(start + t), { now: () => start + t })).outcome, 'coalesced');
    await reconcileEmergencyCall(db, imei, { now: () => start + t, send: never });
  }
  assert.equal(db.get(jobPath).endsAt.getTime(), expiry);
  await reconcileEmergencyCall(db, imei, { now: () => start + WINDOW_MS, send });
  assert.deepEqual(writes, ['auto', 'manual']); assert.equal(db.get(jobPath).active, false);
  assert.equal(db.get(statePath).appliedStateVerified, false);
  assert.equal(db.get(statePath).automaticExpiry, false);
  await reconcileEmergencyCall(db, imei, { now: () => start + WINDOW_MS + 1, send: never });
});

test('buffered alarms, missing/invalid time, future time, app alerts and non-emergencies cannot open Auto', async () => {
  const db = fixture(); await armed(db);
  for (const input of [alarm(start - 121000), alarm(start + 31000), { ...alarm(), alarmRecordedAt: null },
    { ...alarm(), alarmRecordedAt: new Date(NaN) }, { ...alarm(), type: 'alert' }, { ...alarm(), alarmType: 'low_battery' },
    { ...alarm(), alarmCommand: 'UD_LTE' }]) {
    assert.equal((await admitWatchEmergency(db, input, new Date(start), { now: () => start })).outcome, 'not_fresh_watch_alarm');
  }
  assert.equal(db.get(jobPath).active, false);
});

test('wrong primary, revoked membership, inactive service and changed capture cannot enable a window', async () => {
  for (const change of [
    db => db.seed('users/owner', { ...user(), emergencyContacts: [{ phone: '+23050000001', isPrimary: true }] }),
    db => db.seed('users/owner', { ...user(), linkedImeis: [] }),
    db => db.seed('serviceSubscriptions/owner', { status: 'expired' }),
    db => db.seed(`watchCallPolicies/${imei}`, { ...callPolicy(), revision: 'changed' }),
  ]) {
    const db = fixture(); await armed(db); change(db);
    assert.notEqual((await admitWatchEmergency(db, alarm(), new Date(start), { now: () => start })).outcome, 'admitted');
    await reconcileEmergencyCall(db, imei, { now: () => start, send: never });
  }
});

test('a restart during Auto uncertainty restores Manual, never replays Auto', async () => {
  const db = fixture(); await armed(db);
  await admitWatchEmergency(db, alarm(), new Date(start), { now: () => start });
  db.failTransaction = db.transactions + 2; // claim persisted; completion fails
  await assert.rejects(reconcileEmergencyCall(db, imei, { now: () => start, send: replied }));
  assert.equal(db.get(jobPath).phase, 'sending_auto');
  await reconcileEmergencyCall(db, imei, { now: () => start + 31000, send: input => { assert.equal(input.mode, 'manual'); return replied(); } });
  assert.equal(db.get(jobPath).active, false);
});

test('expired Auto start after a busy phonebook lease restores without ever sending Auto', async () => {
  const db = fixture(); await armed(db);
  await admitWatchEmergency(db, alarm(), new Date(start), { now: () => start });
  db.seed(`watchPhonebookSettings/${imei}`, { leaseUntil: new Date(start + 40000) });
  await reconcileEmergencyCall(db, imei, { now: () => start, send: never });
  await reconcileEmergencyCall(db, imei, { now: () => start + 41000, send: input => { assert.equal(input.mode, 'manual'); return replied(); } });
});

test('offline restoration survives policy/entitlement deletion, retries are spaced and only replies finish it', async () => {
  const db = fixture(); await armed(db);
  await admitWatchEmergency(db, alarm(), new Date(start), { now: () => start });
  await reconcileEmergencyCall(db, imei, { now: () => start, send: replied });
  db.rows.delete(`watchCallPolicies/${imei}`); db.rows.delete('users/owner');
  let count = 0;
  const send = input => { assert.equal(input.mode, 'manual'); count++; return { outcome: 'not_sent' }; };
  await reconcileEmergencyCall(db, imei, { now: () => start + 10, send });
  assert.equal(db.get(statePath).status, 'restoration_pending');
  await reconcileEmergencyCall(db, imei, { now: () => start + 11, send: never });
  await reconcileEmergencyCall(db, imei, { now: () => start + 60010, send });
  assert.equal(count, 2);
  await reconcileEmergencyCall(db, imei, { now: () => start + 120010, send: replied });
  assert.equal(db.get(jobPath).active, false);
});

test('explicit Manual cancels an in-flight Auto before its write, and completes after recovery replies', async () => {
  const db = fixture(); await armed(db);
  await admitWatchEmergency(db, alarm(), new Date(start), { now: () => start });
  const auto = reconcileEmergencyCall(db, imei, { now: () => start, send: async (input, options) => {
    db.seed('watchCallRequests/manual', callRequest('manual', start + 1));
    const result = await processWatchCallRequest(db, 'manual', { now: () => start + 1, send: never });
    assert.equal(result.outcome, 'restoration_pending');
    assert.equal(await options.beforeWrite(), false);
    return { outcome: 'not_sent' };
  } });
  await auto;
  await reconcileEmergencyCall(db, imei, { now: () => start + 2, send: input => { assert.equal(input.mode, 'manual'); return replied(); } });
  assert.equal(db.get('watchCallRequests/manual').status, 'device_replied');
  assert.equal(db.get(jobPath).active, false);
});

test('disabling during Auto handoff does not clear lease and still forces Manual after a late reply', async () => {
  const db = fixture(); await armed(db);
  await admitWatchEmergency(db, alarm(), new Date(start), { now: () => start });
  await reconcileEmergencyCall(db, imei, { now: () => start, send: async () => {
    await request(db, false, start + 1, 'disable');
    await reconcileEmergencyCall(db, imei, { now: () => start + 2, send: never });
    return replied();
  } });
  assert.equal(db.get(statePath).status, 'restoration_pending');
  await reconcileEmergencyCall(db, imei, { now: () => start + 3, send: input => { assert.equal(input.mode, 'manual'); return replied(); } });
  assert.equal(db.get(statePath).enabled, false); assert.equal(db.get(statePath).status, 'disabled');
});

test('everyday Auto is blocked until emergency policy is off and Manual recovery has finished', async () => {
  const db = fixture(); await armed(db);
  for (const pending of [false, true]) {
    if (pending) await request(db, false, start + 1, 'disable');
    const id = pending ? 'b' : 'a'; db.seed(`watchCallRequests/${id}`, callRequest('auto', start));
    const result = await processWatchCallRequest(db, id, { now: () => start, send: never });
    assert.equal(result.outcome, 'emergency_policy_active');
  }
  await reconcileEmergencyCall(db, imei, { now: () => start + 2, send: replied });
  db.seed('watchCallRequests/c', callRequest('auto', start + 3));
  await processWatchCallRequest(db, 'c', { now: () => start + 3, send: replied });
  await reconcileEmergencyCall(db, imei, { now: () => start + WINDOW_MS, send: never });
  assert.equal(db.get(`watchCallSettings/${imei}`).lastHandoffMode, 'auto');
});

test('stale or forged preference requests cannot change policy, including arbitrary caller numbers', async () => {
  for (const patch of [{ caller: phone }, { requestedBy: 'other' }, { consentAccepted: false },
    { expiresAt: new Date(start - 1) }, { revision: 'changed' }, { createdAt: new Date(start + 60000) }]) {
    const db = fixture(); await configure(db);
    db.seed('watchEmergencyRequests/bad', { imei, enabled: true, requestedBy: 'owner', revision: db.get(statePath).revision,
      consentAccepted: true, createdAt: new Date(start), expiresAt: new Date(start + 60000), status: 'pending', ...patch });
    await processEmergencyRequest(db, 'bad', { now: () => start });
    assert.equal(db.get('watchEmergencyRequests/bad').status, 'not_applied');
    assert.equal(db.get(jobPath), undefined);
  }
});

test('changed primary during a window restores Manual but does not advertise readiness', async () => {
  const db = fixture(); await armed(db);
  await admitWatchEmergency(db, alarm(), new Date(start), { now: () => start });
  await reconcileEmergencyCall(db, imei, { now: () => start, send: replied });
  db.seed('users/owner', { ...user(), emergencyContacts: [{ phone: '+23050000001', isPrimary: true }] });
  await reconcileEmergencyCall(db, imei, { now: () => start + 1, send: input => { assert.equal(input.mode, 'manual'); return replied(); } });
  assert.equal(db.get(statePath).ready, false);
  assert.equal(db.get(statePath).reason, 'primary_contact_mismatch');
});

test('a newer Manual cancellation supersedes the earlier request without losing restoration', async () => {
  const db = fixture(); await armed(db);
  await admitWatchEmergency(db, alarm(), new Date(start), { now: () => start });
  for (const [id, offset] of [['a', 1], ['b', 2]]) {
    db.seed(`watchCallRequests/${id}`, callRequest('manual', start + offset));
    await processWatchCallRequest(db, id, { now: () => start + offset, send: never });
  }
  assert.equal(db.get('watchCallRequests/a').reason, 'superseded');
  await reconcileEmergencyCall(db, imei, { now: () => start + 3, send: replied });
  assert.equal(db.get('watchCallRequests/b').status, 'device_replied');
});
