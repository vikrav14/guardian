'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { routineCommands, temperatureCommand, parseTemperatureMode, createRoutineController } = require('../src/wellness-routine');

const AT = new Date('2026-10-01T10:00:00Z');
function fixture() {
  const f = { at: AT, state: {}, context: { enabled: true, authorized: true, canStop: true,
    request: { routine: 'balanced', revision: 'r1' } },
  device: { connected: true, bt: 2, sessionId: 'session-one', wear: {
    version: 1, deviceAccepted: true, state: 'worn', continuityId: 'period-one',
    observedAt: AT, expiresAt: new Date(+AT + 120_000),
  } }, commands: [], writes: [] };
  f.make = () => createRoutineController({
    clock: () => f.at,
    read: async () => f.skipLease ? null : ({ ...f.context, state: f.state }),
    live: () => f.device,
    save: async patch => { if (f.failSave) throw new Error('db down');
      f.writes.push(patch); f.state = { ...f.state, ...patch }; f.onSave?.(patch); },
    send: command => { f.commands.push(command); return f.onSend?.(command) ?? { ok: true }; },
  });
  f.controller = f.make();
  return f;
}

test('routine presets build matching heart and temperature cycles; no arbitrary commands', () => {
  assert.deepEqual(routineCommands('manual'), ['hrtstart,0', 'bodytemp,0,12']);
  assert.deepEqual(routineCommands('gentle'), ['hrtstart,43200', 'bodytemp,1,12']);
  assert.deepEqual(routineCommands('balanced'), ['hrtstart,28800', 'bodytemp,1,8']);
  assert.equal(temperatureCommand({ action: 'single' }), 'bodytemp2');
  for (const hours of [0, 13, 1.5, '8', Infinity]) assert.throws(() => temperatureCommand({ action: 'start', hours }));
  for (const name of ['hourly', 'constructor', 'balanced,0', null]) assert.throws(() => routineCommands(name));
});

test('only CONFIG establishes BT mode; duplicates are ambiguous and unrelated fields omitted', () => {
  assert.equal(parseTemperatureMode({ command: 'btemp2', args: ['1', '34.56'] }), undefined);
  assert.deepEqual(parseTemperatureMode({ command: 'CONFIG', args: ['BT:2', 'TM:1', 'IMEI:private'] }), { bt: 2, tm: 1 });
  assert.deepEqual(parseTemperatureMode({ command: 'CONFIG', args: ['BT:2', 'BT:2', 'TM:invalid'] }), { bt: null, tm: null });
});

test('start requires access, connection and temperature-mode preconditions', async () => {
  for (const modify of [
    f => { f.context.enabled = false; }, f => { f.context.authorized = false; },
    f => { f.context.validUntil = AT; }, f => { f.device.connected = false; },
    f => { f.device.bt = null; },
  ]) {
    const f = fixture(); modify(f); await f.controller.tick();
    assert.deepEqual(f.commands, []); assert.equal(f.state.phase, 'blocked');
  }
});

test('checkpoint precedes starts; subsequent polls do not reset native intervals', async () => {
  const f = fixture(); f.onSend = () => { assert.equal(f.state.mayBeRunning, true); return { ok: true }; };
  await Promise.all([f.controller.tick(), f.controller.tick()]);
  assert.deepEqual(f.commands, routineCommands('balanced'));
  await f.controller.tick(); assert.equal(f.commands.length, 2);
  assert.equal(f.state.phase, 'awaiting_readings'); assert.equal(f.state.scheduleVerified, false);
  f.context.request = { routine: 'gentle', revision: 'r2' };
  await f.controller.tick(); assert.deepEqual(f.commands.slice(2), routineCommands('gentle'));
});

test('access or routine expiry stops both; offline never claims a completed stop', async () => {
  for (const block of [f => { f.context.authorized = false; },
    f => { f.context.enabled = false; }]) {
    const f = fixture(); await f.controller.tick(); block(f);
    f.device.connected = false; await f.controller.tick();
    assert.equal(f.state.phase, 'stop_pending_offline'); assert.equal(f.commands.length, 2);
    f.device.connected = true; await f.controller.tick();
    assert.deepEqual(f.commands.slice(2), routineCommands('manual'));
    assert.equal(f.state.phase, 'stop_sent'); assert.equal(f.state.scheduleVerified, false);
  }
});

test('restart and fresh session with unknown wearing stop earlier cycles; restoration starts selected cadence', async () => {
  const f = fixture(); await f.controller.tick();
  const worn = f.device.wear; f.device = { connected: true, sessionId: 'new', bt: null, wear: null };
  f.controller = f.make(); await f.controller.tick();
  assert.deepEqual(f.commands.slice(2), routineCommands('manual'));
  f.device.bt = 2; f.device.wear = worn; await f.controller.tick();
  assert.deepEqual(f.commands.slice(4), routineCommands('balanced'));
});

test('Manual remains available for stopping after consent/flag withdrawal, including unknown BT', async () => {
  const f = fixture(); f.context.request.routine = 'manual';
  f.context.authorized = false; f.context.enabled = false; f.device.bt = null;
  await f.controller.tick(); assert.deepEqual(f.commands, ['hrtstart,0']);
  await f.controller.tick(); assert.equal(f.commands.length, 1);
  assert.equal(f.state.reason, 'temperature_mode_unconfirmed');
  f.device.bt = 2; await f.controller.tick();
  assert.deepEqual(f.commands.slice(1), routineCommands('manual'));
  await f.controller.tick(); assert.equal(f.commands.length, 3);
  f.context.canStop = false; f.context.request.revision = 'unauthorized';
  await f.controller.tick(); assert.equal(f.commands.length, 3);
  assert.equal(f.state.phase, 'blocked');
});

test('cleanup stops a temperature-only legacy marker even without renewed access', async () => {
  const f = fixture();
  f.state = { temperatureMayBeRunning: true, mayBeRunning: false };
  f.context.enabled = false;
  f.context.authorized = false;
  f.context.canStop = false;
  f.device.bt = null;
  await f.controller.tick();
  assert.deepEqual(f.commands, ['hrtstart,0', 'bodytemp,0,12']);
  assert.equal(f.state.temperatureMayBeRunning, false);
  assert.equal(f.state.scheduleVerified, false);
});

test('a partial handoff is followed by stops and cannot silently restart without a fresh request', async () => {
  const f = fixture(); f.onSend = cmd => ({ ok: !cmd.startsWith('bodytemp,1') });
  await f.controller.tick(); assert.equal(f.state.phase, 'handoff_failed');
  await f.controller.tick(); assert.deepEqual(f.commands.slice(2), routineCommands('manual'));
  await f.controller.tick(); assert.equal(f.commands.length, 4);
  f.onSend = null; f.context.request.revision = 'r2'; await f.controller.tick();
  assert.deepEqual(f.commands.slice(4), routineCommands('balanced'));
});

test('lost lease and failed durable checkpoint cannot start a watch schedule', async () => {
  const f = fixture(); f.skipLease = true; await f.controller.tick(); assert.deepEqual(f.commands, []);
  f.skipLease = false; f.failSave = true; await assert.rejects(f.controller.tick()); assert.deepEqual(f.commands, []);
});

test('recheck authorization, session and desired revision after asynchronous checkpoint', async () => {
  for (const change of [f => { f.context.authorized = false; },
    f => { f.device.sessionId = 'new'; }, f => { f.context.request.revision = 'replaced'; }]) {
    const f = fixture(); f.onSave = patch => { if (patch.phase === 'sending') change(f); };
    await f.controller.tick(); assert.deepEqual(f.commands, []);
    assert.equal(f.state.phase, 'handoff_failed');
  }
});
