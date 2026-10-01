'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createWifiDiscovery, createHomeWifiStore, authorizeHomeWifi, setupBinding,
  COLLECTION, MAX_DISCOVERIES } = require('../src/home-wifi-setup');
const { createHomeWifiHandler } = require('../src/home-wifi-http');
const { createHomeWifiEnrollmentRuntime } = require('../src/home-wifi-enrollment-runtime');
const { inspectV52WifiScan } = require('../src/wifi-fence-scan');
const { fingerprintRouter } = require('../src/wifi-home-observer');
const imei = '359633100123456', uid = 'owner', radio = '02:00:00:00:00:01';
const start = Date.parse('2026-10-01T10:00:00Z');
function fields(radios = [['My Home', radio, '-60']]) {
  return ['011026', '100000', 'V', '20.123', 'S', '57.123', 'E', '0', '0', '0', '0',
    '70', '80', '0', '0', '00000000', '0', String(radios.length), ...radios.flat()];
}
const event = (at, device = imei) => ({ imei: device, type: 'location', gpsValid: false,
  accuracySource: 'wifi', location: { gpsValid: false, source: 'wifi', recordedAt: new Date(at) } });
function fakeDb() {
  const data = { users: { owner: { linkedImeis: [imei] }, stranger: { linkedImeis: [] },
      family: { linkedImeis: [imei], serviceOwnerUid: uid } },
    geofences: { home: { imei, createdBy: uid, name: 'Home', active: true,
      center: { lat: -20.1, lng: 57.1 }, radiusMeters: 150 } },
    serviceSubscriptions: { owner: { version: 1, managedBy: 'guardian_admin', plan: 'family', status: 'active' } },
    devices: { [imei]: {} }, [COLLECTION]: {} };
  const listeners = new Map();
  const snapshot = (name, id) => ({ id, exists: data[name]?.[id] !== undefined,
    data: () => structuredClone(data[name]?.[id]) });
  const collection = (name, filters = []) => ({
    doc(id) { return { name, id, get: async () => snapshot(name, id),
      onSnapshot(next) { queueMicrotask(() => next(snapshot(name, id))); return () => {}; } }; },
    where(k, op, value) { assert.equal(op, '=='); return collection(name, [...filters, [k, value]]); },
    async get() { return { docs: Object.keys(data[name] || {}).filter(id => filters.every(([k, value]) =>
      data[name][id][k] === value)).map(id => snapshot(name, id)) }; },
    onSnapshot(next, error) { listeners.set(name, { next, error });
      queueMicrotask(async () => next(await collection(name, filters).get())); return () => listeners.delete(name); },
  });
  const db = { collection, async runTransaction(fn) {
    const writes = [];
    const tx = { get: ref => ref.get(), set: (ref, value) => writes.push(() => { data[ref.name][ref.id] = structuredClone(value); }),
      update: (ref, value) => writes.push(() => Object.assign(data[ref.name][ref.id], structuredClone(value))) };
    const result = await fn(tx); writes.forEach(fn => fn()); return result;
  } };
  return { db, data, listeners, async emit() { listeners.get(COLLECTION)?.next(await collection(COLLECTION).get()); } };
}
async function fixture() {
  const f = fakeDb(); f.clock = start;
  f.discovery = createWifiDiscovery({ now: () => f.clock });
  f.access = { uid, imei };
  const binding = await setupBinding(f.db, f.access, 'home', f.clock);
  f.discoveryAccess = { ...f.access, geofenceId: 'home', homeKey: binding.homeKey };
  f.discovery.open(f.discoveryAccess);
  f.discovery.observe(event(f.clock), new Date(f.clock), fields());
  f.choice = f.discovery.open(f.discoveryAccess)[0];
  f.payload = { candidateId: f.choice.id, geofenceId: 'home', homeKey: binding.homeKey, expectedVersion: 0 };
  f.store = createHomeWifiStore(f.db, { now: () => f.clock });
  return f;
}

test('named and nameless packets expose names only on explicit enrollment parsing', () => {
  assert.equal(inspectV52WifiScan(fields()).accessPoints[0].name, undefined);
  assert.equal(inspectV52WifiScan(fields(), { includeNames: true }).accessPoints[0].name, 'My Home');
  assert.equal(inspectV52WifiScan(fields([['evil\u202etest\n', radio, '-60']]), { includeNames: true }).accessPoints[0].name, 'eviltest');
  assert.equal(inspectV52WifiScan(fields([[radio, '-60']]), { includeNames: true }).accessPoints[0].name, '');
});

test('fresh choices are private, scoped, bounded and never reconstructed from an SSID', async () => {
  const f = await fixture();
  assert.equal(f.choice.name, 'My Home');
  assert.equal(f.choice.radioHint, '00:01');
  assert.ok(!JSON.stringify(f.choice).includes(radio));
  for (const patch of [{ uid: 'stranger' }, { imei: '999999999999999' }, { geofenceId: 'school' }, { homeKey: 'bad' }]) {
    assert.throws(() => f.discovery.select({ ...f.discoveryAccess, ...patch }, f.choice.id), /network_expired/);
  }
  f.clock += 120_000;
  assert.deepEqual(f.discovery.open(f.discoveryAccess), []);
  assert.throws(() => f.discovery.select(f.discoveryAccess, f.choice.id), /network_expired/);
  f.discovery.observe(event(start), new Date(f.clock), fields());
  assert.deepEqual(f.discovery.open(f.discoveryAccess), []);
  for (let i = 1; i < MAX_DISCOVERIES; i++) f.discovery.open({ ...f.discoveryAccess, uid: `owner-${i}` });
  assert.throws(() => f.discovery.open({ ...f.discoveryAccess, uid: 'overflow' }), /setup_busy/);
  f.clock += 10 * 60_000;
  assert.deepEqual(f.discovery.open({ ...f.discoveryAccess, uid: 'new' }), []);
});

test('duplicate network names remain distinct; missing/invalid scans cannot refresh old choices', async () => {
  const f = await fixture(); f.clock += 1000;
  f.discovery.observe(event(f.clock), new Date(f.clock), fields([
    ['My Home', radio, '-65'], ['My Home', '02:00:00:00:00:02', '-70']]));
  const choices = f.discovery.open(f.discoveryAccess);
  assert.equal(choices.length, 2); assert.notEqual(choices[0].id, choices[1].id);
  assert.notEqual(choices[0].radioHint, choices[1].radioHint);
  const before = structuredClone(choices);
  f.discovery.observe({ ...event(f.clock + 1000), type: 'heartbeat' }, new Date(f.clock + 1000), fields());
  f.discovery.observe(event(f.clock + 1000), new Date(f.clock + 1000), ['malformed']);
  f.discovery.observe(event(f.clock - 1000), new Date(f.clock), fields());
  assert.deepEqual(f.discovery.open(f.discoveryAccess), before);
  f.clock += 1000;
  f.discovery.observe(event(f.clock), new Date(f.clock), fields([]));
  assert.deepEqual(f.discovery.open(f.discoveryAccess), before);
  f.clock = start + 121_000;
  assert.deepEqual(f.discovery.open(f.discoveryAccess), []);
});

test('two router sightings followed by an empty report preserve selection only until the last sighting expires', async () => {
  const f = await fixture();
  // Replay the 1 October field sequence: router at +0/+10s, empty at +21s.
  f.clock += 10_000;
  f.discovery.observe(event(f.clock), new Date(f.clock + 1000), fields([['My Home', radio, '-39']]));
  const seen = f.discovery.open(f.discoveryAccess)[0];
  assert.equal(seen.id, f.choice.id);
  f.clock += 11_000;
  f.discovery.observe(event(f.clock), new Date(f.clock + 1000), fields([]));
  f.clock += 22_000;
  assert.deepEqual(f.discovery.open(f.discoveryAccess), [seen]);
  const saved = await f.store.save(f.access, f.payload, f.discovery);
  assert.equal(saved.enabled, true);
  assert.equal(f.data.devices[imei].homeWifiPresence, null);
  f.clock = start + 130_000;
  f.discovery.observe(event(f.clock), new Date(f.clock), fields([]));
  assert.deepEqual(f.discovery.open(f.discoveryAccess), []);
  await assert.rejects(f.store.save(f.access, { ...f.payload, expectedVersion: saved.version }, f.discovery), /network_expired/);
});

test('partial scans retain unseen fresh radios without renewing them and discovery remains bounded', async () => {
  const f = await fixture();
  f.clock += 1000;
  f.discovery.observe(event(f.clock), new Date(f.clock), fields([['Other', '02:00:00:00:00:02', '-70']]));
  const choices = f.discovery.open(f.discoveryAccess);
  assert.equal(choices.length, 2);
  assert.deepEqual(choices.find(n => n.id === f.choice.id), f.choice);
  f.clock = start + 120_000;
  assert.deepEqual(f.discovery.open(f.discoveryAccess).map(n => n.name), ['Other']);
  for (let i = 3; i <= 10; i++) {
    f.clock += 1000;
    f.discovery.observe(event(f.clock), new Date(f.clock), fields([
      ['Network ' + i, '02:00:00:00:00:' + i.toString(16).padStart(2, '0'), '-60']]));
    assert.ok(f.discovery.open(f.discoveryAccess).length <= 5);
  }
  assert.deepEqual(f.discovery.open(f.discoveryAccess).map(n => n.name),
    ['Network 10', 'Network 9', 'Network 8', 'Network 7', 'Network 6']);
});

test('enrollment stores fingerprints, clears old evidence and uses revisions for replace/remove', async () => {
  const f = await fixture();
  f.data.devices[imei].homeWifiPresence = { old: true };
  const saved = await f.store.save(f.access, f.payload, f.discovery);
  assert.equal(saved.enabled, true); assert.equal(saved.version, 1);
  const record = f.data[COLLECTION][imei];
  assert.equal(record.routerHash, fingerprintRouter({ imei, routerId: radio, hashKey: record.hashKey }));
  assert.ok(!JSON.stringify(record).includes(radio));
  assert.ok(!JSON.stringify(saved).includes(record.routerHash));
  assert.equal(f.data.devices[imei].homeWifiPresence, null);
  await assert.rejects(f.store.save(f.access, f.payload, f.discovery), /settings_changed/);
  f.data.serviceSubscriptions.owner.status = 'expired';
  const removed = await f.store.save(f.access, { expectedVersion: 1 }, f.discovery, { remove: true });
  assert.equal(removed.enabled, false); assert.equal(removed.version, 2);
  assert.equal(f.data[COLLECTION][imei].hashKey, undefined);
  assert.equal(f.data[COLLECTION][imei].routerHash, undefined);
});

test('save rechecks owner, plan, fresh scan and unchanged pin; rejects arbitrary radio input', async () => {
  for (const mutate of [
    f => { f.data.users.owner.linkedImeis = []; },
    f => { f.data.users.owner.serviceOwnerUid = 'someone-else'; },
    f => { f.data.serviceSubscriptions.owner.status = 'expired'; },
    f => { f.data.geofences.home.center.lat = -21; },
    f => { f.data.geofences.home.active = false; },
    f => { f.clock += 120_000; },
    f => { f.payload.macAddress = radio; },
    f => { f.payload.candidateId = '0'.repeat(32); },
  ]) {
    const f = await fixture(); mutate(f);
    await assert.rejects(f.store.save(f.access, f.payload, f.discovery));
    assert.equal(f.data[COLLECTION][imei], undefined);
  }
  const f = await fixture();
  await assert.rejects(authorizeHomeWifi({ db: f.db, uid: 'family', imei }), /owner_required/);
  await assert.rejects(authorizeHomeWifi({ db: f.db, uid: 'stranger', imei }), /device_not_linked/);
});

async function request(handler, method, body, token = uid, query = `imei=${imei}&geofenceId=home`) {
  const req = Readable.from(body == null ? [] : [Buffer.from(JSON.stringify(body))]);
  req.method = method; req.headers = token ? { authorization: `Bearer ${token}` } : {};
  const result = {};
  await handler(req, { writeHead(status, headers) { result.status = status; result.headers = headers; },
    end(text) { result.body = JSON.parse(text); } }, new URL(`http://local/app/home-wifi?${query}`));
  return result;
}
test('HTTP owner access, no-store responses, revocation, invalid bodies and saved-vs-detected state', async () => {
  const f = await fixture();
  const runtime = { ready: true, discovery: f.discovery, status: () => ({ version: 0,
    publisher: { publishedHomeFresh: true, lastHomeDetection: { observedAt: new Date(start).toISOString() } } }) };
  const handler = createHomeWifiHandler({ getDb: () => f.db, getRuntime: () => runtime,
    verifyToken: async token => ({ uid: token }), connected: () => true, now: () => f.clock });
  assert.equal((await request(handler, 'GET', null, null)).status, 401);
  assert.equal((await request(handler, 'GET', null, 'family')).status, 403);
  assert.equal((await request(handler, 'GET', null, 'stranger')).status, 403);
  const list = await request(handler, 'GET');
  assert.match(list.headers['Cache-Control'], /no-store/);
  assert.equal(list.body.networks[0].name, 'My Home');
  assert.equal(list.body.detectedNow, false);
  assert.equal((await request(handler, 'POST', f.payload)).status, 200);
  const staleRuntime = await request(handler, 'GET');
  assert.equal(staleRuntime.body.saved.enabled, true);
  assert.equal(staleRuntime.body.detectedNow, false);
  assert.equal((await request(handler, 'POST', { ...f.payload, name: 'arbitrary' })).status, 400);
  f.data.users.owner.linkedImeis = [];
  assert.equal((await request(handler, 'GET')).status, 403);
});

test('runtime reloads enrollment, feeds normal Home observer, and blocks stale writes after removal', async t => {
  const f = await fixture(); await f.store.save(f.access, f.payload, f.discovery);
  const publishers = [];
  const runtime = createHomeWifiEnrollmentRuntime({ db: f.db, now: () => f.clock,
    publish(options) {
      const stop = () => { stop.stopped = true; };
      stop.getEvidence = () => null; stop.getStatus = () => ({});
      publishers.push({ options, stop }); return stop;
    } });
  t.after(() => runtime.stop());
  await new Promise(resolve => setImmediate(resolve));
  for (const seconds of [0, 10, 20]) {
    f.clock = start + seconds * 1000;
    runtime.observe(event(f.clock), new Date(f.clock), fields());
  }
  assert.equal(runtime.status(imei).observer.matchState, 'matched');
  const binding = await publishers[0].options.readBinding(f.clock, { signal: new AbortController().signal, restorePresence: true });
  assert.equal(binding.ready, true);
  const oldPublisher = publishers[0].options;
  await f.store.save(f.access, { expectedVersion: 1 }, f.discovery, { remove: true });
  // Watcher has not caught up yet. The database revision still blocks it.
  await oldPublisher.persist({ expiresAt: new Date(f.clock + 10_000).toISOString() }, { old: true });
  assert.equal(f.data.devices[imei].homeWifiPresence, null);
  await f.emit();
  assert.equal(publishers[0].stop.stopped, true);
  assert.equal(runtime.status(imei).enrolled, false);
  assert.equal(runtime.evidence(imei), null);
});
