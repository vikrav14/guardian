'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');
const { MovementError, movementRuntime, authorizeMovement, movementSettings,
  movementFrame } = require('../src/movement-reminder-policy');
const { createMovementTransport, observeMovementReply } = require('../src/movement-reminder-transport');
const { executeMovement, createMovementHandler, readSmallJson } = require('../src/movement-reminder-http');
const { publicMovementState } = require('../src/movement-reminder-store');
const { decodeFrame, handlePacket, buildAckFrame } = require('../src/protocol/gt06');

const imei = '999999999999999', protocolId = '9999999999', uid = 'pilot-owner';
const runtime = { enabled: true, imei, uid };
const settings = { enabled: true, intervalMinutes: 20, start: '21:00', end: '23:59', timezone: 'Indian/Mauritius' };
const payload = { requestId: '00000000-0000-4000-8000-000000000001', expectedVersion: 0, settings };
function accessDb({ user = { linkedImeis: [imei] }, owner = {}, subscription = {
  version: 1, managedBy: 'guardian_admin', plan: 'family', status: 'active',
} } = {}) {
  return { collection: name => ({ doc: id => ({ get: async () => {
    const data = name === 'users' ? (id === uid ? user : owner) : subscription;
    return { exists: !!data, data: () => data };
  } }) }) };
}

test('pilot requires explicit user/device pair and fails closed by default', () => {
  assert.equal(movementRuntime({}).enabled, false);
  assert.equal(movementRuntime({ MOVEMENT_REMINDER_PILOT_ENABLED: 'true' }).enabled, false);
  assert.equal(movementRuntime({ MOVEMENT_REMINDER_PILOT_ENABLED: 'true',
    MOVEMENT_REMINDER_PILOT_IMEI: imei, MOVEMENT_REMINDER_PILOT_UID: uid }).enabled, true);
});

test('pilot access checks target, UID, linkage, membership and trusted active subscription', async () => {
  const args = { db: accessDb(), uid, imei, runtime };
  assert.equal((await authorizeMovement(args)).ownerUid, uid);
  for (const patch of [{ uid: 'stranger' }, { imei: '888888888888888' },
    { runtime: { ...runtime, enabled: false } }, { db: accessDb({ user: { linkedImeis: [] } }) },
    { db: accessDb({ user: { linkedImeis: [imei], serviceOwnerUid: 'owner' }, owner: { memberUids: [] } }) },
    { db: accessDb({ subscription: { version: 1, managedBy: 'guardian_admin', plan: 'care', status: 'expired' } }) },
    { db: accessDb({ subscription: { plan: 'care', status: 'active' } }) }]) {
    await assert.rejects(authorizeMovement({ ...args, ...patch }), MovementError);
  }
});

test('strict interval/clock contract rejects injection and unverified scheduling shapes', () => {
  for (const patch of [{ intervalMinutes: 10 }, { enabled: 'true' }, { weekdays: [1] },
    { start: '23:00', end: '01:00' }, { start: '20:00', end: '20:20' },
    { start: '21:00,1' }, { end: '24:00' }, { timezone: 'UTC' }]) {
    assert.throws(() => movementSettings({ ...settings, ...patch }));
  }
});

test('captured frames and no-ACK worktime reply are exact; ordinary framing is unchanged', () => {
  assert.equal(movementFrame(protocolId, 'SEDENTARY,1,20').toString(), `[3G*${protocolId}*000e*SEDENTARY,1,20]`);
  assert.equal(movementFrame(protocolId, 'SEDENTARY,0,20').toString(), `[3G*${protocolId}*000e*SEDENTARY,0,20]`);
  assert.equal(movementFrame(protocolId, 'SEDENTARYWORKTIME,21:00-23:59,-').toString(),
    `[3G*${protocolId}*001f*SEDENTARYWORKTIME,21:00-23:59,-]`);
  assert.throws(() => movementFrame(protocolId, 'SEDENTARY,1,10'));
  const session = { imei, protocolId };
  const decoded = decodeFrame(Buffer.from(`[3G*${protocolId}*0011*SEDENTARYWORKTIME]`));
  const result = handlePacket(decoded, session);
  assert.equal(result.acks.length, 0);
  assert.equal(result.events[0].type, 'command_echo');
  assert.equal(buildAckFrame(protocolId, 'CR').toString(), `[SG*${protocolId}*0002*CR]`);
});

function transportFixture() {
  const events = new EventEmitter(), socket = new EventEmitter();
  const session = { imei, protocolId, lastPacketAt: Date.now() };
  socket.writable = true;
  socket.frames = [];
  socket.write = frame => { socket.frames.push(frame); return true; };
  let matches = [{ socket, session }];
  const transport = createMovementTransport({ find: () => matches, events, timeoutMs: 15 });
  return { transport, socket, session, events, setMatches: v => { matches = v; },
    reply(command, overrides = {}) { events.emit('reply', { socket, session,
      decoded: { imei: protocolId, command, args: [] }, ...overrides }); } };
}

test('only the same socket and identity reply satisfy an outstanding write', async () => {
  const f = transportFixture();
  const pending = f.transport.bind(imei).send('SEDENTARY,1,20');
  f.reply('SEDENTARY', { socket: new EventEmitter() });
  f.reply('SEDENTARY', { decoded: { imei: '1111111111', command: 'SEDENTARY' } });
  f.reply('SEDENTARYWORKTIME');
  f.reply('SEDENTARY');
  assert.equal((await pending).replyObserved, true);
  assert.equal(f.events.listenerCount('reply'), 0);
  assert.equal(f.socket.listenerCount('close'), 0);
  assert.equal(f.socket.frames.length, 1);
});

test('timeout never retries; reconnect, offline and duplicate sessions stop sends', async () => {
  const f = transportFixture();
  const bound = f.transport.bind(imei);
  const result = await bound.send('SEDENTARY,1,20');
  assert.equal(result.reason, 'reply_timeout');
  assert.equal(f.socket.frames.length, 1);
  f.setMatches([]);
  assert.throws(() => bound.send('SEDENTARY,0,20'), /watch_offline/);
  f.setMatches([{ socket: new EventEmitter(), session: f.session }]);
  assert.throws(() => bound.send('SEDENTARY,0,20'), /session_changed/);
  f.setMatches([{ socket: f.socket, session: f.session }, { socket: f.socket, session: f.session }]);
  assert.equal(f.transport.connected(imei), false);
});

test('decoded observer handles real packets and ignores malformed/non-bare replies', async () => {
  const { getActiveSessions } = require('../src/sessions');
  const { movementTransport } = require('../src/movement-reminder-transport');
  const socket = new EventEmitter(), session = { imei, protocolId, lastPacketAt: Date.now() };
  socket.write = () => true;
  getActiveSessions().set(socket, session);
  try {
    const waiting = movementTransport.bind(imei).send('SEDENTARY,1,20');
    observeMovementReply({ error: 'length_mismatch', command: 'SEDENTARY', args: [] }, socket, session);
    observeMovementReply({ imei: protocolId, command: 'SEDENTARY', args: ['1'] }, socket, session);
    observeMovementReply(decodeFrame(Buffer.from(`[3G*${protocolId}*0009*SEDENTARY]`)), socket, session);
    assert.equal((await waiting).replyObserved, true);
  } finally { getActiveSessions().delete(socket); }
});

function executionFixture({ failAt = -1, replay = false, failAuditAt = -1 } = {}) {
  const sent = [], updates = [];
  const store = {
    claim: async () => ({ replay, state: { status: 'sending', version: 1 } }),
    update: async ({ patch }) => {
      updates.push(patch);
      if (updates.length === failAuditAt) throw Error('audit unavailable');
      return patch;
    },
  };
  const transport = { bind: () => ({ send: async command => {
    sent.push(command);
    return { command, handoff: true, replyObserved: sent.length !== failAt, reason: 'reply_timeout' };
  } }) };
  return { store, transport, sent, updates };
}

test('single Save sequences off/hours/on, while cleanup off sends only one command', async () => {
  const f = executionFixture();
  const result = await executeMovement({ access: { uid, imei }, payload, ...f });
  assert.deepEqual(f.sent, ['SEDENTARY,0,20', 'SEDENTARYWORKTIME,21:00-23:59,-', 'SEDENTARY,1,20']);
  assert.equal(result.status, 'replies_observed');
  const off = executionFixture();
  await executeMovement({ access: { uid, imei }, payload: { ...payload, settings: { ...settings, enabled: false } }, ...off });
  assert.deepEqual(off.sent, ['SEDENTARY,0,20']);
});

test('partial failure, audit failure and mid-operation access revocation prevent final enable', async () => {
  for (const f of [executionFixture({ failAt: 2 }), executionFixture({ failAuditAt: 4 })]) {
    const result = await executeMovement({ access: { uid, imei }, payload, ...f });
    assert.equal(result.status, 'unconfirmed');
    assert.equal(f.sent.includes('SEDENTARY,1,20'), false);
  }
  const f = executionFixture();
  let authCount = 0;
  await executeMovement({ access: { uid, imei }, payload, ...f, authorizeAgain: async () => {
    if (++authCount === 2) throw new MovementError('device_not_linked', 403);
  } });
  assert.deepEqual(f.sent, ['SEDENTARY,0,20']);
});

test('replay and failed durable claim send nothing; expired processing stays unconfirmed', async () => {
  const f = executionFixture({ replay: true });
  await executeMovement({ access: { uid, imei }, payload, ...f });
  assert.deepEqual(f.sent, []);
  f.store.claim = async () => { throw Error('database unavailable'); };
  await assert.rejects(executeMovement({ access: { uid, imei }, payload, ...f }));
  assert.deepEqual(f.sent, []);
  const expired = publicMovementState({ status: 'sending', leaseUntilMs: 1 }, 2);
  assert.equal(expired.status, 'unconfirmed');
  assert.equal(expired.appliedStateVerified, false);
  assert.equal(expired.reminderBehaviourVerified, false);
});

test('HTTP endpoint has no admin-key/dev-open fallback and does not leak internal errors', async () => {
  let tokenChecks = 0;
  const handler = createMovementHandler({ runtime, getDb: () => accessDb(),
    verifyToken: async token => { tokenChecks++; if (token !== 'valid') throw Error('secret'); return { uid }; },
    storeFactory: () => ({ read: async () => ({ status: 'not_checked' }) }),
    transport: { connected: () => true },
  });
  for (const [headers, expected] of [[{}, 401], [{ 'x-admin-key': 'key' }, 401],
    [{ authorization: 'Bearer invalid' }, 401], [{ authorization: 'Bearer valid' }, 200]]) {
    const res = { writeHead(status) { this.status = status; }, end(body) { this.body = JSON.parse(body); } };
    await handler({ method: 'GET', headers }, res, new URL(`http://local/app/movement-reminders?imei=${imei}`));
    assert.equal(res.status, expected);
    assert.equal(JSON.stringify(res.body).includes('secret'), false);
  }
  assert.equal(tokenChecks, 2);
});

test('request body is bounded and invalid JSON fails before execution', async () => {
  await assert.rejects(readSmallJson(Readable.from([Buffer.alloc(2049)])), /request_too_large/);
  await assert.rejects(readSmallJson(Readable.from([Buffer.from('{')])), /invalid_json/);
});

test('invalid request IDs and versions are rejected before durable claim or send', async () => {
  for (const patch of [{ requestId: '../other' }, { expectedVersion: -1 }, { command: 'FIND' }]) {
    const f = executionFixture();
    await assert.rejects(executeMovement({ access: { uid, imei }, payload: { ...payload, ...patch }, ...f }), /invalid_request/);
    assert.deepEqual(f.sent, []);
  }
});

test('pilot launcher requires an explicit environment file and one linked owner', async () => {
  const { options, selectPilotUid } = require('../scripts/start-movement-reminder-pilot');
  assert.throws(() => options(['--imei', imei]));
  assert.throws(() => options(['--imei', imei, '--env', '.env', '--send', 'true']));
  assert.equal(options(['--imei', imei, '--env', '.env']).imei, imei);
  const db = docs => ({ collection: () => ({ where: () => ({ get: async () => ({ docs }) }) }) });
  const owner = { id: uid, data: () => ({}) };
  assert.equal(await selectPilotUid(db([owner]), imei), uid);
  await assert.rejects(selectPilotUid(db([]), imei));
  await assert.rejects(selectPilotUid(db([owner, owner]), imei));
});
