'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createWatchSmsPolicy, INTENT_MS, FRESH_MS, disallowedSmsCommand } = require('../src/watch-sms-policy');
const { createCommandCoordinator } = require('../src/command-coordinator');

function fixture() {
  let time = 1000, next = 0;
  const timers = new Map(), writes = [], logs = [], sessions = new Map();
  const gate = createCommandCoordinator({ now: () => time });
  const policy = createWatchSmsPolicy({ now: () => time,
    schedule: (fn, delay) => { const id = ++next; timers.set(id, { fn, at: time + delay }); return id; },
    cancel: id => timers.delete(id), getSession: socket => sessions.get(socket),
    findSessions: imei => [...sessions].filter(([, s]) => s.imei === imei).map(([socket, session]) => ({ socket, session })),
    send: (imei, command, options) => {
      const decision = gate.decide(imei, command, options);
      if (!decision.ok) return decision;
      writes.push({ imei, command, options });
      if (f.throwWrite) throw Error('unknown transport outcome');
      return { ok: true };
    }, log: value => logs.push(value) });
  const f = { policy, gate, writes, logs, sessions, timers,
    watch: () => {
      const socket = { writable: true, destroyed: false };
      const session = { imei: '861397000000010', protocolId: '9700000001' };
      sessions.set(socket, session);
      return { socket, session };
    },
    observe: (w, command = 'LK', events = [{ type: 'heartbeat' }], extra = {}) =>
      policy.observe({ factory: '3G', imei: w.session.protocolId, command, args: [], ...extra }, events, w.socket, w.session),
    advance: ms => {
      const end = time + ms;
      for (;;) {
        const due = [...timers].filter(([, row]) => row.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        time = due[1].at; timers.delete(due[0]); due[1].fn();
      }
      time = end;
    } };
  return f;
}

test('one fixed off handoff per fresh session; ACK remains distinct from SMS suppression', () => {
  const f = fixture(), w = f.watch();
  f.observe(w);
  assert.equal(f.writes.length, 0, 'packet ACKs/events can finish before routine work');
  f.advance(0);
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].command, 'SMSONOFF,0');
  assert.equal(f.writes[0].options.expectedSocket, w.socket);
  assert.equal(w.session.watchSmsPolicy.status, 'handed_off');
  f.observe(w, 'SMSONOFF', [], { args: ['0'] });
  assert.equal(w.session.watchSmsPolicy.replyAt, null, 'only the observed bare reply qualifies');
  f.observe(w, 'SMSONOFF', []);
  assert.equal(w.session.watchSmsPolicy.status, 'reply_observed');
  assert.equal(w.session.watchSmsPolicy.suppressionVerified, false);
  for (let n = 0; n < 20; n++) { f.observe(w); f.advance(60_000); }
  assert.equal(f.writes.length, 1);
  assert.equal(f.timers.size, 0);
});

test('unknown, malformed, buffered and alarm-only traffic cannot start this routine setting', () => {
  const f = fixture(), w = f.watch();
  f.observe(w, 'LK', [{ type: 'heartbeat' }], { error: 'length_mismatch' });
  f.observe(w, 'LK', [{ type: 'heartbeat' }], { imei: '9700000002' });
  f.observe(w, 'LK', [{ type: 'heartbeat' }], { factory: 'XX' });
  f.observe(w, 'SMSONOFF', []);
  f.observe(w, 'UD2', [{ type: 'location', blindSpotReupload: true }]);
  f.observe(w, 'AL', [{ type: 'alarm' }, { type: 'location' }]);
  w.session.imei = null; f.observe(w); f.advance(INTENT_MS);
  assert.equal(f.writes.length, 0);
  assert.equal(w.session.watchSmsPolicy, undefined);
});

test('capture deferral rechecks freshness while emergencies and required replies pass', () => {
  const f = fixture(), w = f.watch();
  f.gate.beginCapture({ imei: w.session.imei, socket: w.socket, id: 'photo', expiresAt: 100_000 });
  f.observe(w); f.advance(0);
  assert.equal(w.session.watchSmsPolicy.reason, 'camera_busy');
  for (const command of ['CR', 'CALL,000000', 'FON,0']) assert(f.gate.decide(w.session.imei, command).ok);
  assert(f.gate.decide(w.session.imei, 'UPLOAD,60', { emergency: true }).ok);
  assert(f.gate.decide(w.session.imei, 'LK', { protocolReply: true }).ok);
  f.advance(FRESH_MS + 5_000);
  f.gate.finishCapture(w.session.imei, 'photo'); f.advance(5_000);
  assert.equal(f.writes.length, 0, 'stale packet evidence cannot release the deferred command');
  assert.equal(w.session.watchSmsPolicy.reason, 'awaiting_fresh_telemetry');
  f.observe(w); f.advance(5_000);
  assert.equal(f.writes.length, 1);
  assert.equal(f.timers.size, 0);
});

test('pending intent expires without a late write or unbounded timer', () => {
  const f = fixture(), w = f.watch();
  f.gate.beginCapture({ imei: w.session.imei, socket: w.socket, id: 'photo', expiresAt: 240_000 });
  f.observe(w); f.advance(INTENT_MS);
  assert.equal(f.writes.length, 0);
  assert.equal(w.session.watchSmsPolicy.status, 'expired');
  f.observe(w); f.advance(0);
  assert.equal(f.writes.length, 0, 'expired work is not replayed by another heartbeat');
  assert.equal(f.timers.size, 0);
});

test('duplicate sessions defer, close cancels old work, replacement gets a new setting', () => {
  const f = fixture(), old = f.watch(), current = f.watch();
  f.observe(old); f.observe(current); f.advance(0);
  assert.equal(f.writes.length, 0);
  assert.equal(current.session.watchSmsPolicy.reason, 'ambiguous_session');
  f.policy.disconnect(old.socket); f.sessions.delete(old.socket); f.advance(5_000);
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].options.expectedSocket, current.socket);
  f.observe(old, 'SMSONOFF', []);
  assert.equal(current.session.watchSmsPolicy.status, 'handed_off');
  f.policy.disconnect(current.socket); f.sessions.delete(current.socket);
  const next = f.watch(); f.observe(next); f.advance(0);
  assert.equal(f.writes.length, 2);
});

test('changed identity and silent session replacement cannot inherit deferred settings', () => {
  for (const mode of ['identity', 'replacement', 'closed']) {
    const f = fixture(), w = f.watch(); f.observe(w);
    if (mode === 'identity') w.session.imei = '861397000000029';
    if (mode === 'replacement') f.sessions.set(w.socket, { ...w.session });
    if (mode === 'closed') w.socket.destroyed = true;
    f.advance(0);
    assert.equal(f.writes.length, 0, mode);
    assert.equal(w.session.watchSmsPolicy.status, 'skipped');
  }
});

test('write exception and missing reply do not cause blind retries', () => {
  for (const throwWrite of [true, false]) {
    const f = fixture(), w = f.watch(); f.throwWrite = throwWrite;
    f.observe(w); f.advance(0);
    for (let n = 0; n < 10; n++) { f.observe(w); f.advance(60_000); }
    assert.equal(f.writes.length, 1);
    assert.equal(w.session.watchSmsPolicy.status, throwWrite ? 'uncertain' : 'handed_off');
  }
});

test('a process restart has no persisted actions to replay; a fresh session must first identify itself', () => {
  const old = fixture(), oldWatch = old.watch(); old.observe(oldWatch); old.advance(0);
  const restarted = fixture(), newWatch = restarted.watch(); restarted.advance(INTENT_MS);
  assert.equal(restarted.writes.length, 0);
  restarted.observe(newWatch); restarted.advance(0);
  assert.equal(restarted.writes.length, 1);
});

test('fixed-off guard rejects enabling, malformed and noncanonical SMS switches', () => {
  for (const command of ['SMSONOFF,1', 'smsonoff,1', ' SMSONOFF,1', 'SMSONOFF', 'SMSONOFF,0,1', 'SMSONOFF,2', 'SMSONOFF,0\n']) {
    assert(disallowedSmsCommand(command), command);
  }
  for (const command of ['SMSONOFF,0', 'CR', 'CALL,000000', 'UPLOAD,60', 'LK']) assert.equal(disallowedSmsCommand(command), false);
});
