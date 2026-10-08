'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCommandCoordinator } = require('../src/command-coordinator');
const { createDeviceCommandDispatcher } = require('../src/device-command-dispatcher');
const { applyAdaptiveReporting, startReportingReconciler } = require('../src/adaptive-reporting');
const { database, setup, receive, imei } = require('./helpers/photo-harness');

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

test('real capture ingress releases routine gate before storage/AI; timeout and disconnect release it', async () => {
  const input = { imei, purpose: 'Check surroundings', consentConfirmed: true, safetyPurposeConfirmed: true };
  for (const end of ['image', 'timeout', 'disconnect']) {
    const s = setup();
    const id = await s.api.request('owner', input);
    assert.equal(s.args.coordinator.decide(imei, 'UPLOAD,600').error, 'camera_busy');
    if (end === 'image') await receive(s, id);
    if (end === 'timeout') { s.advance(120001); await s.api.sweep(); }
    if (end === 'disconnect') s.api.disconnect(s.socket);
    assert(s.args.coordinator.decide(imei, 'UPLOAD,600').ok);
    assert.equal(s.writes.length, 1, 'no capture retry');
  }
});

test('live downlink and movement transport use the same camera gate; duplicate sessions never fan out actions', async t => {
  const { commandCoordinator } = require('../src/command-coordinator');
  const sessions = require('../src/sessions');
  const { sendDownlinkCommand } = require('../src/downlink');
  const { createMovementTransport } = require('../src/movement-reminder-transport');
  const { createSnapshotController } = require('../src/safety-snapshot-live');
  const s = setup();
  sessions.registerSession(s.socket, { imei, protocolId: '9705254749' });
  const api = createSnapshotController({ ...s.args, coordinator: commandCoordinator,
    now: () => new Date(), findSessions: sessions.findSocketsForDevice });
  t.after(() => { api.disconnect(s.socket); sessions.unregisterSession(s.socket); });
  await api.request('owner', { imei, purpose: 'Check surroundings', consentConfirmed: true, safetyPurposeConfirmed: true });
  assert.equal(sendDownlinkCommand(imei, 'UPLOAD,600').error, 'camera_busy');
  assert.equal(sendDownlinkCommand(imei, 'hrtstart,1').error, 'camera_busy');
  assert.throws(() => createMovementTransport().bind(imei).send('SEDENTARY,1,20'), /camera_busy/);
  assert(sendDownlinkCommand(imei, 'CR').ok);
  assert(sendDownlinkCommand(imei, 'UPLOAD,60', { emergency: true }).ok);
  assert(sendDownlinkCommand(imei, 'hrtstart,0').ok);
  const duplicate = { writable: true, write() { assert.fail('duplicate action write'); } };
  sessions.registerSession(duplicate, { imei, protocolId: '9705254749' });
  assert.equal(sendDownlinkCommand(imei, 'FIND').error, 'ambiguous_session');
  sessions.unregisterSession(duplicate);
  api.disconnect(s.socket);
  assert(sendDownlinkCommand(imei, 'UPLOAD,600').ok);
  assert.equal(s.writes.filter(frame => frame.includes('rcapture')).length, 1);
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

function reportingHarness() {
  let row = { locationReportingMode: 'automatic', locationReportingIntervalSeconds: 60,
    batteryPercent: 80, adaptiveReporting: { appliedIntervalSeconds: 60 } };
  const merge = (a, b) => { for (const [key, value] of Object.entries(b)) {
    if (value && typeof value === 'object' && !(value instanceof Date)) a[key] = merge(a[key] || {}, value);
    else a[key] = value;
  } return a; };
  const ref = { get: async () => ({ data: () => structuredClone(row) }), set: async value => { merge(row, value); } };
  const db = { collection: () => ({ doc: () => ref }),
    runTransaction: async work => work({ get: target => target.get(),
      set: (target, value, options) => target.set(value, options) }) };
  const writes = [], contexts = [];
  const send = async (_db, _imei, _type, params, options) => { writes.push({ ...params, ...options }); };
  return { db, row, writes, contexts, options: { send, setContext: c => contexts.push(c) } };
}

test('reporting restores from persisted SOS deadlines after restart without telemetry', async () => {
  const h = reportingHarness();
  const base = Date.now();
  h.row.adaptiveReporting = { appliedIntervalSeconds: 60, reason: 'sos_emergency_override',
    sosActiveUntil: new Date(base + 1000), sosCooldownUntil: new Date(base + 2000), lastCommandAt: new Date(base) };
  const worker = startReportingReconciler({ db: h.db, connected: () => [imei],
    context: () => ({ ...h.options, nowMs: base + 1500 }), intervalMs: 600000 });
  await worker.tick(); worker.stop();
  assert.equal(h.writes.at(-1).seconds, 300);
  await applyAdaptiveReporting(h.db, imei, { ...h.options, nowMs: base + 2500 });
  assert.equal(h.writes.at(-1).seconds, 600);
  assert.equal(h.row.locationReportingMode, 'automatic');
});

test('a bounded outing expires to ten minutes even when the battery falls below fifteen percent', async () => {
  const h = reportingHarness(), base = Date.now();
  await applyAdaptiveReporting(h.db, imei, { ...h.options, outingActiveUntilMs: base + 900000, nowMs: base });
  assert.equal(h.row.adaptiveReporting.reason, 'outing_active');
  await applyAdaptiveReporting(h.db, imei, { ...h.options, nowMs: base + 900001 });
  assert.equal(h.writes.at(-1).seconds, 600);
  const count = h.writes.length;
  await applyAdaptiveReporting(h.db, imei, { ...h.options, nowMs: base + 900002, batteryPercent: 8, force: true });
  assert.equal(h.writes.length, count, 'battery change alone sends no new interval');
  assert.equal(h.row.adaptiveReporting.desiredIntervalSeconds, 600);
});

test('camera deferral never counts as applied and restores ten minutes despite a battery change', async () => {
  const h = reportingHarness(), base = Date.now();
  const busy = async () => { throw Object.assign(new Error('camera_busy'), { code: 'camera_busy', expiresAt: base + 120000 }); };
  const result = await applyAdaptiveReporting(h.db, imei, { ...h.options, send: busy, nowMs: base });
  assert.equal(result.status, 'deferred');
  assert.equal(h.row.adaptiveReporting.appliedIntervalSeconds, 60);
  await applyAdaptiveReporting(h.db, imei, { ...h.options, nowMs: base + 120000, batteryPercent: 8 });
  assert.equal(h.writes.at(-1).seconds, 600);
});

test('reconnect replaces persisted battery tiers with ten minutes without renewing expired activity', async () => {
  for (const priorSeconds of [60, 300, 900]) {
    const h = reportingHarness(), base = Date.now();
    h.row.batteryPercent = 8;
    h.row.locationReportingIntervalSeconds = priorSeconds;
    h.row.adaptiveReporting = { appliedIntervalSeconds: priorSeconds, reason: 'battery_critical',
      lastCommandAt: new Date(base - 1000), outingActiveUntil: new Date(base - 1),
      sosActiveUntil: new Date(base - 1), sosCooldownUntil: new Date(base - 1),
      fallActiveUntil: new Date(base - 1), fallCooldownUntil: new Date(base - 1) };
    const session = {};
    const worker = startReportingReconciler({ db: h.db, connected: () => [imei],
      sessionFor: () => [session], context: () => ({ ...h.options, nowMs: base }), intervalMs: 600000 });
    try { await worker.tick(); await worker.tick(); } finally { worker.stop(); }
    assert.deepEqual(h.writes.map(row => row.seconds), [600]);
    assert.equal(h.row.adaptiveReporting.reason, 'normal_baseline');
    assert.equal(h.row.locationReportingMode, 'automatic');
    assert.equal(+h.row.adaptiveReporting.outingActiveUntil, base - 1);
  }
});

test('critical-battery emergency and cooldown return to ten minutes for both alarm types', async () => {
  const { activateEmergencyOverride, SOS_ACTIVE_MS, SOS_COOLDOWN_MS } = require('../src/adaptive-reporting');
  for (const alarmType of ['sos', 'fall']) {
    const h = reportingHarness(), base = Date.now();
    h.row.batteryPercent = 8;
    h.row.adaptiveReporting.appliedIntervalSeconds = 600;
    h.row.locationReportingIntervalSeconds = 600;
    await activateEmergencyOverride(h.db, imei, { ...h.options, alarmType, nowMs: base });
    await applyAdaptiveReporting(h.db, imei, { ...h.options, nowMs: base + SOS_ACTIVE_MS });
    await applyAdaptiveReporting(h.db, imei, { ...h.options, nowMs: base + SOS_ACTIVE_MS + SOS_COOLDOWN_MS });
    assert.deepEqual(h.writes.map(row => row.seconds), [300, 600]);
    assert.equal(h.row.adaptiveReporting.reason, 'normal_baseline');
  }
});

test('manual mode cannot suppress emergency override; original manual intent survives', async () => {
  const h = reportingHarness(), base = Date.now();
  h.row.locationReportingMode = 'manual'; h.row.locationReportingIntervalSeconds = 900;
  h.row.adaptiveReporting = { appliedIntervalSeconds: 900, sosActiveUntil: new Date(base + 1000) };
  await applyAdaptiveReporting(h.db, imei, { ...h.options, nowMs: base });
  assert.equal(h.writes.at(-1).seconds, 60);
  await applyAdaptiveReporting(h.db, imei, { ...h.options, nowMs: base + 1001 });
  assert.equal(h.writes.at(-1).seconds, 900);
});

test('fall reporting bypasses a busy camera and restores through cooldown after worker restart', async () => {
  const { activateEmergencyOverride, SOS_ACTIVE_MS, SOS_COOLDOWN_MS } = require('../src/adaptive-reporting');
  const h = reportingHarness(), base = Date.now();
  h.row.locationReportingIntervalSeconds = 600;
  h.row.adaptiveReporting.appliedIntervalSeconds = 600;
  const c = createCommandCoordinator({ now: () => base });
  c.beginCapture({ imei, id: 'capture', socket: { writable: true }, expiresAt: base + 120000 });
  const send = async (db, id, type, params, options) => {
    assert.equal(c.decide(id, `UPLOAD,${params.seconds}`, options.coordination).ok, true);
    await h.options.send(db, id, type, params, options);
  };
  await activateEmergencyOverride(h.db, imei, { ...h.options, send, alarmType: 'fall', nowMs: base });
  assert.equal(h.writes.at(-1).seconds, 60);
  assert.equal(h.row.adaptiveReporting.reason, 'fall_emergency_override');
  assert.equal(+h.row.adaptiveReporting.fallActiveUntil, base + SOS_ACTIVE_MS);
  assert.equal(h.row.adaptiveReporting.sosActiveUntil, undefined);
  c.finishCapture(imei, 'capture');
  const worker = startReportingReconciler({ db: h.db, connected: () => [imei],
    context: () => ({ ...h.options, nowMs: base + SOS_ACTIVE_MS }), intervalMs: 600000 });
  await worker.tick(); worker.stop();
  assert.equal(h.writes.at(-1).seconds, 300);
  await applyAdaptiveReporting(h.db, imei, { ...h.options, nowMs: base + SOS_ACTIVE_MS + SOS_COOLDOWN_MS });
  assert.equal(h.writes.at(-1).seconds, 600);
  assert.equal(h.row.adaptiveReporting.reason, 'normal_baseline');
});

test('fall critical battery safeguard and latest manual intent survive emergency expiry', async () => {
  const { activateEmergencyOverride, SOS_ACTIVE_MS, SOS_COOLDOWN_MS } = require('../src/adaptive-reporting');
  const h = reportingHarness(), base = Date.now();
  h.row.locationReportingMode = 'manual';
  h.row.locationReportingIntervalSeconds = 900;
  h.row.adaptiveReporting.appliedIntervalSeconds = 900;
  await activateEmergencyOverride(h.db, imei, { ...h.options, alarmType: 'fall', nowMs: base, batteryPercent: 8 });
  assert.equal(h.writes.at(-1).seconds, 300);
  assert.equal(h.row.manualReportingIntervalSeconds, 900);
  h.row.manualReportingIntervalSeconds = 1200;
  await applyAdaptiveReporting(h.db, imei, { ...h.options, nowMs: base + SOS_ACTIVE_MS + SOS_COOLDOWN_MS });
  assert.equal(h.writes.at(-1).seconds, 1200);
});

test('older alarm receipt cannot shorten a lease and unrelated alarms cannot create one', async () => {
  const { activateEmergencyOverride, SOS_ACTIVE_MS } = require('../src/adaptive-reporting');
  const h = reportingHarness(), base = Date.now();
  await activateEmergencyOverride(h.db, imei, { ...h.options, alarmType: 'fall', nowMs: base });
  await activateEmergencyOverride(h.db, imei, { ...h.options, alarmType: 'fall', nowMs: base - 5000 });
  assert.equal(+h.row.adaptiveReporting.fallActiveUntil, base + SOS_ACTIVE_MS);
  const before = structuredClone(h.row), count = h.writes.length;
  const result = await activateEmergencyOverride(h.db, imei, { ...h.options, alarmType: 'low_battery', nowMs: base });
  assert.equal(result.changed, false);
  assert.deepEqual(h.row, before);
  assert.equal(h.writes.length, count);
});

test('a reporting write already in flight cannot overwrite a newer emergency deadline', async () => {
  const { activateEmergencyOverride, SOS_ACTIVE_MS } = require('../src/adaptive-reporting');
  for (const alarmType of ['sos', 'fall']) {
    const h = reportingHarness(), base = Date.now();
    h.row.adaptiveReporting[`${alarmType}ActiveUntil`] = new Date(base - 1000);
    let release, entered;
    const paused = new Promise(resolve => { entered = resolve; });
    const resume = new Promise(resolve => { release = resolve; });
    const evaluation = applyAdaptiveReporting(h.db, imei, { ...h.options, nowMs: base,
      send: async () => { entered(); await resume; } });
    await paused;
    // The alarm commits its deadline while the older evaluation is at send().
    let committed;
    const commitment = new Promise(resolve => { committed = resolve; });
    const transaction = h.db.runTransaction;
    h.db.runTransaction = async fn => { const result = await transaction(fn); committed(); return result; };
    const alarm = activateEmergencyOverride(h.db, imei, { ...h.options, alarmType, nowMs: base });
    await commitment;
    release(); await Promise.all([evaluation, alarm]);
    assert.equal(+h.row.adaptiveReporting[`${alarmType}ActiveUntil`], base + SOS_ACTIVE_MS);
    assert.equal(h.writes.at(-1).seconds, 60);
  }
});

test('reconnecting during an SOS camera wait defers interval reassertion, then hands it off once', async () => {
  const h = reportingHarness(), base = Date.now();
  const c = createCommandCoordinator({ now: () => base });
  c.beginCapture({ imei, id: 'capture', socket: { writable: true }, expiresAt: base + 240000 });
  h.row.adaptiveReporting.sosActiveUntil = new Date(base + 1800000);
  const send = async (db, id, type, params, options) => {
    const gate = c.decide(id, `UPLOAD,${params.seconds}`, options.coordination);
    if (!gate.ok) throw Object.assign(new Error(gate.error), { code: gate.error, expiresAt: gate.expiresAt });
    return h.options.send(db, id, type, params, options);
  };
  const session = {};
  const worker = startReportingReconciler({ db: h.db, connected: () => [imei],
    sessionFor: () => [session], context: () => ({ ...h.options, send, nowMs: base }), intervalMs: 600000 });
  try {
    await worker.tick(); await worker.tick();
    assert.equal(h.writes.length, 0);
    assert.equal(h.row.adaptiveReporting.commandStatus, 'deferred');
    assert.equal(h.row.adaptiveReporting.reason, 'sos_emergency_override');
    c.finishCapture(imei, 'capture'); await worker.tick(); await worker.tick();
    assert.deepEqual(h.writes.map(row => row.seconds), [60]);
    assert.equal(h.writes[0].coordination.emergency, false);
  } finally { worker.stop(); }
});

test('outing changes and emergency cooldown are routine settings during a photo wait', async () => {
  for (const policy of ['outing', 'cooldown']) {
    const h = reportingHarness(), base = Date.now();
    h.row.adaptiveReporting.appliedIntervalSeconds = 600;
    if (policy === 'cooldown') h.row.adaptiveReporting.sosCooldownUntil = new Date(base + 60000);
    const c = createCommandCoordinator({ now: () => base });
    c.beginCapture({ imei, id: 'capture', socket: { writable: true }, expiresAt: base + 240000 });
    const result = await applyAdaptiveReporting(h.db, imei, { ...h.options, nowMs: base,
      ...(policy === 'outing' ? { outingActiveUntilMs: base + 60000 } : {}),
      send: async (_db, id, _type, params, options) => {
        const gate = c.decide(id, `UPLOAD,${params.seconds}`, options.coordination);
        assert.equal(gate.error, 'camera_busy');
        throw Object.assign(new Error(gate.error), { code: gate.error });
      } });
    assert.equal(result.status, 'deferred');
  }
});

test('processing an old event does not renew its expired emergency window', async () => {
  const { activateEmergencyOverride, SOS_ACTIVE_MS, SOS_COOLDOWN_MS } = require('../src/adaptive-reporting');
  const h = reportingHarness(), nowMs = Date.now();
  const eventAtMs = nowMs - SOS_ACTIVE_MS - SOS_COOLDOWN_MS - 1;
  await activateEmergencyOverride(h.db, imei, { ...h.options, alarmType: 'fall', nowMs, eventAtMs });
  assert.equal(h.writes.at(-1).seconds, 600);
  assert.equal(h.row.adaptiveReporting.reason, 'normal_baseline');
});
