'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCommandCoordinator } = require('../src/command-coordinator');
const { createDeviceCommandDispatcher } = require('../src/device-command-dispatcher');
const { database, imei } = require('./helpers/command-database');

test('camera wait gates routine work but preserves replies, locating, emergency, calls and stops', () => {
  let time = 1000;
  const c = createCommandCoordinator({ now: () => time });
  const socket = { writable: true };
  assert(c.beginCapture({ imei, id: 'a', socket, expiresAt: time + 120000 }).ok);
  for (const command of ['UPLOAD,600', 'hrtstart,1', 'bodytemp2', 'SEDENTARY,1,20', 'WALKTIME,00:00-23:59', 'PHBX,1']) {
    assert.equal(c.decide(imei, command).error, 'camera_busy', command);
  }
  for (const command of ['CR', 'MONITOR,+23057123456', 'CALL,+23057123456', 'FIND', 'hrtstart,0', 'bodytemp,0,12', 'SEDENTARY,0,20']) {
    assert.equal(c.decide(imei, command).ok, true, command);
  }
  assert(c.decide(imei, 'UPLOAD,60', { emergency: true }).ok);
  assert(c.decide(imei, 'AL', { protocolReply: true }).ok);
  assert.equal(c.decide(imei, 'CR', { expiresAt: time }).error, 'command_expired');
  assert.equal(c.beginCapture({ imei, id: 'b', socket, expiresAt: time + 1000 }).error, 'camera_busy');
  c.finishCapture(imei, 'old'); assert(c.busyUntil(imei));
  time += 120000; assert(c.decide(imei, 'UPLOAD,600').ok);
  assert(c.beginCapture({ imei, id: 'b', socket, expiresAt: time + 1000 }).ok);
  c.disconnect(socket); assert(c.decide(imei, 'hrtstart,1').ok);
});

function commandHarness() {
  const db = database(), writes = [];
  let time = Date.parse('2026-10-02T00:00:00Z');
  let matches = [{ socket: { writable: true }, session: { imei } }];
  const c = createCommandCoordinator({ now: () => time });
  const args = { db, now: () => time, coordinator: c, find: () => matches,
    send: async (_db, _imei, type, params) => { writes.push({ type, params }); return { channel: 'tcp' }; }, processId: 'one' };
  const add = (id, type, params, extra = {}) => db.rows.set(`deviceCommands/${id}`, {
    imei, type, params, createdBy: 'owner', createdAt: new Date(time), status: 'pending', ...extra });
  return { db, c, args, add, writes, dispatcher: createDeviceCommandDispatcher(args),
    now: () => time, advance: n => { time += n; }, reconnect: () => { matches = [{ socket: { writable: true }, session: { imei } }]; },
    camera: () => c.beginCapture({ imei, id: 'photo', socket: matches[0].socket, expiresAt: time + 120000 }),
    row: id => db.rows.get(`deviceCommands/${id}`) };
}

test('deferred settings retain newest valid intent, emergency bypasses camera, then setting runs once', async () => {
  const h = commandHarness(); h.camera();
  h.add('old', 'set_fall_sensitivity', { level: 2 });
  await h.dispatcher.tick(); assert.equal(h.row('old').status, 'deferred');
  h.advance(1000); h.add('new', 'set_fall_sensitivity', { level: 4 });
  h.add('call', 'voice_monitor', { phone: '+23057123456' });
  await h.dispatcher.tick();
  assert.equal(h.row('old').error, 'superseded');
  assert.equal(h.row('new').status, 'deferred');
  assert.equal(h.writes[0].type, 'voice_monitor');
  h.c.finishCapture(imei, 'photo'); await h.dispatcher.tick(); await h.dispatcher.tick();
  assert.deepEqual(h.writes.map(v => v.type), ['voice_monitor', 'set_fall_sensitivity']);
  assert.equal(h.writes[1].params.level, 4);
  assert.equal(h.row('new').error, null, 'a completed deferred setting clears its old busy reason');
  assert.equal(h.dispatcher.hasWork(), false, 'no idle polling after queue drains');
});

test('only own, documented command builders can dispatch', async () => {
  const h = commandHarness(); h.add('bad', 'toString', {});
  await h.dispatcher.tick();
  assert.equal(h.row('bad').error, 'unsupported_command'); assert.equal(h.writes.length, 0);
  await assert.rejects(require('../src/commands').sendDeviceCommand(h.db, imei, 'toString', {}), /Unknown device command/);
});

test('a longer camera wait cannot renew deferred setting expiry or replay an obsolete setting', async () => {
  const h = commandHarness();
  assert(h.c.beginCapture({ imei, id: 'long-photo', socket: { writable: true }, expiresAt: h.now() + 240_000 }).ok);
  h.add('old', 'set_fall_sensitivity', { level: 2 }); await h.dispatcher.tick();
  h.advance(1000); h.add('new', 'set_fall_sensitivity', { level: 4 }); await h.dispatcher.tick();
  assert.equal(h.row('old').error, 'superseded');
  h.advance(121_000); await h.dispatcher.tick();
  assert.equal(h.row('new').status, 'failed');
  assert.equal(h.row('new').error, 'command_expired');
  assert.equal(h.c.decide(imei, 'UPLOAD,600').error, 'camera_busy');
  h.advance(120_000); await h.dispatcher.tick();
  assert.equal(h.writes.length, 0);
  assert.equal(h.c.decide(imei, 'UPLOAD,600').ok, true);
});

test('a request arriving during an empty reconciliation query is not stranded when polling goes idle', async () => {
  const h = commandHarness();
  let release, observed;
  const paused = new Promise(resolve => { observed = resolve; });
  const resume = new Promise(resolve => { release = resolve; });
  let first = true;
  function wrap(query, pending = false) {
    return new Proxy(query, { get(target, key) {
      if (key === 'where') return (...args) => wrap(target.where(...args), args[1] === 'in');
      if (key === 'limit') return n => wrap(target.limit(n), pending);
      if (key === 'get' && pending) return async () => {
        const snapshot = await target.get();
        if (first) { first = false; observed(); await resume; }
        return snapshot;
      };
      return target[key];
    } });
  }
  const db = { ...h.db, collection: name => wrap(h.db.collection(name)) };
  const dispatcher = createDeviceCommandDispatcher({ ...h.args, db });
  const initial = dispatcher.tick();
  await paused;
  h.add('arrived', 'set_fall_sensitivity', { level: 3 });
  const notification = dispatcher.tick();
  release(); await Promise.all([initial, notification]);
  assert.equal(h.row('arrived').status, 'sent');
  assert.equal(h.writes.length, 1);
});

test('SMS provisioning rechecks deferred authorization after its asynchronous SIM lookup', async () => {
  const { sendDeviceCommand } = require('../src/commands');
  let allowed = true, sent = false;
  const db = { collection: () => ({ doc: () => ({ get: async () => {
    allowed = false;
    return { data: () => ({ simNumber: '+23057123456' }) };
  } }) }) };
  await assert.rejects(sendDeviceCommand(db, imei, 'set_center_number', { phone: '+23057123456' }, {
    beforeSend: async () => { if (!allowed) throw Error('authorization_changed'); },
    sendSms: async () => { sent = true; },
  }), /authorization_changed/);
  assert.equal(sent, false);
});

test('deferred work expires, rechecks linkage, and is not replayed after restart', async () => {
  for (const end of ['expiry', 'revoke', 'restart']) {
    const h = commandHarness(); h.camera(); h.add('a', 'set_fall_sensitivity', { level: 2 });
    await h.dispatcher.tick();
    if (end === 'expiry') h.advance(120001);
    if (end === 'revoke') h.db.rows.set('users/owner', { linkedImeis: [] });
    h.c.finishCapture(imei, 'photo');
    await (end === 'restart' ? createDeviceCommandDispatcher({ ...h.args, processId: 'two' }) : h.dispatcher).tick();
    assert.equal(h.row('a').status, 'failed');
    assert.equal(h.writes.length, 0);
  }
});

test('a newer prompt stop prevents an older deferred enable from running afterwards', async () => {
  const h = commandHarness(); h.camera();
  h.add('enable', 'set_fall_detection', { enabled: true });
  await h.dispatcher.tick(); assert.equal(h.row('enable').status, 'deferred');
  h.advance(1000); h.add('stop', 'set_fall_detection', { enabled: false });
  await h.dispatcher.prompt(await h.db.collection('deviceCommands').doc('stop').get());
  assert.equal(h.row('stop').status, 'sent');
  h.c.finishCapture(imei, 'photo'); await h.dispatcher.tick();
  assert.equal(h.row('enable').error, 'superseded');
  assert.deepEqual(h.writes.map(w => w.params.enabled), [false]);
});

test('session replacement during authorization and ambiguous earlier handoff cannot resend actions', async () => {
  const h = commandHarness(); h.add('a', 'voice_monitor', { phone: '+23057123456' });
  let checks = 0;
  const d = createDeviceCommandDispatcher({ ...h.args, authorize: async () => {
    if (++checks === 2) h.reconnect(); return true;
  } });
  await d.tick(); assert.equal(h.row('a').error, 'session_changed_or_unavailable');
  h.add('b', 'voice_monitor', { phone: '+23057123456' }, { status: 'sending' });
  await createDeviceCommandDispatcher(h.args).tick();
  assert.equal(h.row('b').error, 'handoff_unconfirmed_after_restart');
  assert.equal(h.writes.length, 0);
});

test('guarded administrator SOS mode remains supported, without granting linked clients that command', async () => {
  const h = commandHarness();
  h.db.rows.set(`devices/${imei}`, {});
  h.add('client', 'set_alarm_mode', { mode: 0 });
  h.add('operator', 'set_alarm_mode', { mode: 0 }, { createdBy: 'operator:queue-v52-alarm-mode' });
  await h.dispatcher.tick();
  assert.equal(h.row('client').error, 'authorization_changed');
  assert.equal(h.row('operator').status, 'sent');
  assert.equal(h.writes.length, 1);
});

test('permissions and expiry are checked after asynchronous claims, before any transport handoff', async () => {
  for (const end of ['revoke', 'expire']) {
    const h = commandHarness(); h.add('a', 'ring_to_find', {});
    let checks = 0;
    const dispatcher = createDeviceCommandDispatcher({ ...h.args, authorize: async () => {
      if (++checks === 3) {
        if (end === 'expire') h.advance(120001);
        else return false;
      }
      return true;
    } });
    await dispatcher.tick();
    assert.equal(h.row('a').status, 'failed'); assert.equal(h.writes.length, 0);
  }
});

test('an ambiguous handoff is terminal and is never retried on a later tick or restart', async () => {
  const h = commandHarness(); h.add('a', 'ring_to_find', {});
  let writes = 0;
  const dispatcher = createDeviceCommandDispatcher({ ...h.args, send: async () => {
    writes++; throw new Error('write_unconfirmed');
  } });
  await dispatcher.tick(); await dispatcher.tick();
  await createDeviceCommandDispatcher({ ...h.args, processId: 'replacement' }).tick();
  assert.equal(h.row('a').error, 'write_unconfirmed');
  assert.equal(writes, 1); assert.equal(h.writes.length, 0);
});

test('a prompt stop does not wait behind a slow routine authorization', async () => {
  const h = commandHarness(); h.camera(); h.add('routine', 'set_fall_sensitivity', { level: 3 });
  let release, reached;
  const entered = new Promise(resolve => { reached = resolve; });
  const paused = new Promise(resolve => { release = resolve; });
  const dispatcher = createDeviceCommandDispatcher({ ...h.args, authorize: async (_db, row) => {
    if (row.type === 'set_fall_sensitivity') { reached(); await paused; }
    return true;
  } });
  const routine = dispatcher.tick(); await entered;
  h.add('stop', 'set_fall_detection', { enabled: false });
  try {
    await dispatcher.prompt(await h.db.collection('deviceCommands').doc('stop').get());
    assert.equal(h.row('stop').status, 'sent'); assert.equal(h.writes.length, 1);
  } finally { release(); await routine; }
});

test('returning to automatic reporting invalidates a deferred manual interval', async () => {
  const h = commandHarness(); h.camera();
  h.db.rows.set(`devices/${imei}`, { locationReportingMode: 'manual', locationReportingIntervalSeconds: 300 });
  h.add('interval', 'set_upload_interval', { seconds: 300 });
  await h.dispatcher.tick(); assert.equal(h.row('interval').status, 'deferred');
  h.db.rows.set(`devices/${imei}`, { locationReportingMode: 'automatic', locationReportingIntervalSeconds: 300 });
  h.c.finishCapture(imei, 'photo'); await h.dispatcher.tick();
  assert.equal(h.row('interval').error, 'reporting_policy_changed');
  assert.equal(h.writes.length, 0);
});

test('a revoked or invalid newer setting cannot supersede an older valid intent', async () => {
  const h = commandHarness();
  h.add('valid', 'set_fall_sensitivity', { level: 2 });
  h.advance(1000);
  h.add('bad', 'set_fall_sensitivity', { level: 99 });
  h.add('revoked', 'set_fall_sensitivity', { level: 5 }, { createdBy: 'unlinked' });
  await h.dispatcher.tick();
  assert.equal(h.row('valid').status, 'sent'); assert.equal(h.writes.length, 1);
});

test('stale reconciliation cannot overwrite a prompt handoff or send it twice', async () => {
  const h = commandHarness(); h.add('stop', 'set_fall_detection', { enabled: false });
  let release, entered, calls = 0;
  const paused = new Promise(resolve => { release = resolve; });
  const reached = new Promise(resolve => { entered = resolve; });
  const dispatcher = createDeviceCommandDispatcher({ ...h.args, authorize: async () => {
    if (++calls === 1) { entered(); await paused; return false; }
    return true;
  } });
  const routine = dispatcher.tick(); await reached;
  await dispatcher.prompt(await h.db.collection('deviceCommands').doc('stop').get());
  assert.equal(h.row('stop').status, 'sent');
  release(); await routine; await dispatcher.tick();
  assert.equal(h.row('stop').status, 'sent'); assert.equal(h.writes.length, 1);
});

test('legacy medication watermarks follow the physical slot across different reminder IDs', async () => {
  const h = commandHarness(); h.camera();
  const params = { time: '18:30', frequency: 2, text: 'Test' };
  h.add('old', 'set_medication_reminder', params, { reminderId: 'old-app-record' });
  await h.dispatcher.tick();
  h.advance(1000);
  h.add('off', 'set_medication_reminder', { ...params, enabled: false }, { reminderId: 'new-app-record' });
  await h.dispatcher.prompt(await h.db.collection('deviceCommands').doc('off').get());
  h.c.finishCapture(imei, 'photo'); await h.dispatcher.tick();
  assert.equal(h.row('old').error, 'superseded');
  assert.deepEqual(h.writes.map(w => w.params.enabled), [false]);
});


for (const mode of ['automatic', 'manual']) test(`reporting reconciler cannot revive an obsolete queued interval after ${mode} selection`, async () => {
  const h = commandHarness(); h.camera(); let called = false;
  const dispatcher = createDeviceCommandDispatcher({ ...h.args, reporting: async () => { called = true; } });
  h.db.rows.set(`devices/${imei}`, { locationReportingMode: 'manual', locationReportingIntervalSeconds: 60,
    manualReportingIntervalSeconds: 300 }); // Emergency handoff is not the chosen manual interval.
  h.add('interval', 'set_upload_interval', { seconds: 300 });
  await dispatcher.tick(); assert.equal(h.row('interval').status, 'deferred');
  h.db.rows.set(`devices/${imei}`, { locationReportingMode: mode, locationReportingIntervalSeconds: 300,
    manualReportingIntervalSeconds: 1200 });
  h.c.finishCapture(imei, 'photo'); await dispatcher.tick();
  assert.equal(h.row('interval').error, 'reporting_policy_changed');
  assert.equal(called, false);
});

test('current manual preference can reconcile while emergency reporting is handed off', async () => {
  const h = commandHarness(); let called = false;
  h.db.rows.set(`devices/${imei}`, { locationReportingMode: 'manual', locationReportingIntervalSeconds: 60,
    manualReportingIntervalSeconds: 1200 });
  h.add('interval', 'set_upload_interval', { seconds: 1200 });
  const dispatcher = createDeviceCommandDispatcher({ ...h.args, reporting: async (_row, { beforeSend }) => {
    await beforeSend(); called = true; return { seconds: 60, reason: 'sos_emergency_override' };
  } });
  await dispatcher.tick(); assert(called); assert.equal(h.row('interval').status, 'sent');
  assert.equal(h.db.rows.get(`devices/${imei}`).manualReportingIntervalSeconds, 1200);
});
