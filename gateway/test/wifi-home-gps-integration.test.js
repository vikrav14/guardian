'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createWifiHomeObserver, fingerprintRouter } = require('../src/wifi-home-observer');
const { createHomeWifiPublisher } = require('../src/wifi-home-display');
const { inspectV52WifiScan } = require('../src/wifi-fence-scan');
const { buildAckFrame, decodeFrame, handlePacket } = require('../src/protocol/gt06');
const { readHomeWifiDisplay } = require('../src/wifi-home-display-policy');
const { buildLocationReplyData } = require('../src/location-reply');
const { buildSosLocationSnapshot } = require('../src/sos-location-snapshot');

const start = Date.parse('2026-09-11T12:00:00Z');
const imei = '359633100123456';
const radio = '02:00:00:00:00:01';
const hashKey = 'ab'.repeat(32);
const observerOptions = { enabled: true, imei, hashKey,
  routerHash: fingerprintRouter({ imei, routerId: radio, hashKey }) };
const anchor = { geofenceId: 'test-home', lat: -20.15, lng: 57.15, radiusMeters: 150 };

function packet(seconds, { gps = false, scan = 'home', outside = false, alarm = false } = {}) {
  const time = new Date(start + seconds * 1000).toISOString().slice(11, 19).replace(/:/g, '');
  const radios = scan === 'missing' ? [] : scan === 'empty' ? ['0'] :
    ['1', 'Private network', scan === 'other' ? '02:00:00:00:00:02' : radio,
      scan === 'weak' ? '-90' : '-48'];
  if (scan === 'invalid') radios.pop();
  const args = ['110926', time, gps ? 'A' : 'V', outside ? '20.16' : '20.15', 'S',
    '57.15', 'E', '0', '0', '0', gps ? '5' : '0', '70', '80', '0', '0',
    alarm ? '00010000' : '00000000', '1', '0', '617', '1', '53', '203778', '-80', ...radios];
  const decoded = decodeFrame(buildAckFrame('6331001234',
    [alarm ? 'AL_LTE' : 'UD_LTE', ...args].join(',')));
  const output = handlePacket(decoded, { imei, protocolId: '6331001234' });
  const event = output.events.find(e => ['location', 'alarm'].includes(e.type));
  event.imei = imei;
  return { decoded, event, acks: output.acks };
}

function harness() {
  const state = { now: start, saved: null, gps: null, failBinding: false, diagnostics: [], writes: [] };
  let observer = createWifiHomeObserver(observerOptions);
  const publisher = createHomeWifiPublisher({
    now: () => state.now,
    readBinding: async at => {
      if (state.failBinding) throw new Error('Synthetic network failure');
      return { ready: true, key: 'test-owner-home', anchor, validUntilMs: at + 60_000 };
    },
    readObservation: at => observer.snapshot(at),
    readGpsObservation: () => observer.readGpsObservation(),
    resetObservation: () => { observer = createWifiHomeObserver(observerOptions); },
    persist: async value => { state.saved = value; state.writes.push(structuredClone(value)); },
    report: row => state.diagnostics.push(row),
  });
  async function receive(seconds, options) {
    state.now = start + seconds * 1000;
    const data = packet(seconds, options);
    const before = structuredClone(data.event);
    const acks = data.acks.map(ack => ack.toString());
    observer.observe(data.event, state.now, inspectV52WifiScan(data.decoded.args));
    if (data.event.gpsValid) state.gps = data.event.location;
    await publisher.tick();
    assert.deepEqual(data.event, before, 'Home must never rewrite GPS/network/SOS events');
    assert.deepEqual(data.acks.map(ack => ack.toString()), acks);
    return data;
  }
  const device = () => ({ homeWifiPresence: state.saved, lastSatelliteLocation: state.gps });
  const selected = () => readHomeWifiDisplay(device(), { now: new Date(state.now) });
  return { state, publisher, receive, device, selected,
    radio: () => observer.snapshot(state.now) };
}

test('GPS at Home preserves radio time; outside GPS shows uncertainty without selecting Home', async () => {
  const run = harness(); await run.publisher.tick();
  for (const at of [0, 10, 20]) await run.receive(at);
  assert.equal(run.selected().source, 'home_wifi');
  const sourceTime = run.state.saved.observedAt;
  await run.receive(30, { gps: true, scan: 'missing' });
  assert.equal(run.selected().source, 'home_wifi');
  assert.equal(run.state.saved.observedAt, sourceTime);
  assert.equal(run.radio().counts.qualified, 3);
  assert.equal(buildLocationReplyData(run.device(), { now: new Date(run.state.now) }).homeWifiDetected, true);
  await run.receive(40, { gps: true, outside: true, scan: 'home' });
  assert.equal(run.radio().matchState, 'matched', 'radio evidence is independent of coordinates');
  assert.equal(run.state.saved.state, 'conflict');
  assert.equal(run.selected(), null);
  assert.equal(run.publisher.getStatus().selectionReason, 'gps_outside_home');
  assert.equal(run.publisher.getStatus().publishedHomeFresh, false);
  assert.equal(run.publisher.getStatus().publishedConflictFresh, true);
  assert.equal(buildLocationReplyData(run.device(), { now: new Date(run.state.now) }).homeWifiDetected, false);
  assert.equal(buildLocationReplyData(run.device(), { now: new Date(run.state.now) }).homeWifiConflict, true);
  await run.receive(50); // A newer radio alone cannot hide a still-fresh outside GPS fix.
  assert.equal(run.selected(), null);
  assert.equal(run.publisher.getStatus().selectionReason, 'gps_outside_home');
});

test('fresh declared Home scans in GPS packets can qualify without changing their coordinate source', async () => {
  const run = harness(); await run.publisher.tick();
  for (const at of [0, 10, 20]) {
    const data = await run.receive(at, { gps: true });
    assert.equal(data.event.accuracySource, 'gps');
    assert.equal(data.event.wifiAccessPoints, undefined, 'private scan must not leak into telemetry');
  }
  assert.equal(run.radio().counts.qualified, 3);
  assert.equal(run.selected().source, 'home_wifi');
  assert.equal(run.state.saved.version, 3);
  assert.equal(run.state.saved.anchor.radiusMeters, 150);
  for (const privateValue of [imei, radio, hashKey, 'Private network']) {
    assert.ok(!JSON.stringify(run.state.saved).includes(privateValue));
    assert.ok(!JSON.stringify(run.publisher.getStatus()).includes(privateValue));
  }
});

test('GPS and empty scans cannot extend Home beyond the last actual radio sighting', async () => {
  const run = harness(); await run.publisher.tick();
  for (const at of [0, 10, 20]) await run.receive(at);
  for (const at of [30, 60, 90, 120]) {
    await run.receive(at, { gps: true, scan: 'empty' });
    assert.equal(run.selected().source, 'home_wifi');
    assert.equal(run.state.saved.observedAt, new Date(start + 20_000).toISOString());
    assert.equal(run.radio().counts.qualified, 3);
  }
  await run.receive(140, { gps: true, scan: 'missing' });
  assert.equal(run.selected(), null);
  assert.equal(run.publisher.getStatus().lastClearedReason, 'observation_expired');
});

test('contradictory and malformed GPS scans clear radio evidence; revocation requires requalification', async () => {
  for (const [scan, expected] of [['other', 'router_not_seen'], ['weak', 'signal_weak'], ['invalid', 'invalid_scan']]) {
    const run = harness(); await run.publisher.tick();
    for (const at of [0, 10, 20]) await run.receive(at);
    await run.receive(30, { gps: true, scan });
    assert.equal(run.selected(), null);
    assert.equal(run.publisher.getStatus().lastClearedReason, expected);
  }
  const run = harness(); await run.publisher.tick();
  for (const at of [0, 10, 20]) await run.receive(at);
  run.state.failBinding = true;
  await run.receive(30, { gps: true });
  assert.equal(run.selected(), null);
  assert.equal(run.publisher.getStatus().lastClearedReason, 'home_binding_unavailable');
  run.state.failBinding = false;
  await run.receive(60);
  assert.equal(run.selected(), null, 'binding recovery requires new sustained router evidence');
});

test('SOS packet ACKs, GPS snapshot and telemetry stay identical when Home is selected', async () => {
  const run = harness(); await run.publisher.tick();
  for (const at of [0, 10, 20]) await run.receive(at);
  const data = await run.receive(30, { gps: true, alarm: true });
  assert.equal(data.event.type, 'alarm');
  assert.equal(data.event.alarmType, 'sos');
  assert.ok(data.acks.length > 0);
  const options = { now: new Date(run.state.now) };
  assert.deepEqual(buildSosLocationSnapshot(run.device(), options),
    buildSosLocationSnapshot({ ...run.device(), homeWifiPresence: null }, options));
  assert.equal(run.selected().source, 'home_wifi');
  assert.equal(run.state.gps.source, 'gps');
});

test('live runtime passes GPS packet radio scans privately to the observer and publisher', () => {
  const settings = { wifiHomeObserveEnabled: true, wifiHomeDisplayPilotEnabled: true,
    wifiHomePilotImei: imei, wifiHomeHashKey: hashKey, wifiHomeRouterHash: observerOptions.routerHash };
  let publisherOptions;
  const logs = [];
  const sandbox = { module: { exports: {} }, console: { log: row => logs.push(row) }, require(name) {
    if (name === './config') return settings;
    if (name === './wifi-home-observer') return { createWifiHomeObserver };
    if (name === './wifi-fence-scan') return { inspectV52WifiScan };
    if (name === './sessions') return { findSocketsForDevice: () => [{ socket: { destroyed: false } }] };
    if (name === './wifi-home-display') return { startHomeWifiPublisher(options) {
      publisherOptions = options;
      const stop = () => {};
      stop.getStatus = () => ({ active: true });
      return stop;
    } };
    throw new Error('Unexpected runtime dependency');
  } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/wifi-home-runtime.js'), 'utf8'), sandbox);
  const api = sandbox.module.exports;
  api.startWifiHomeDisplayPilot({});
  for (const seconds of [0, 10, 20]) {
    const data = packet(seconds, { gps: true });
    const before = structuredClone(data.event);
    api.observeWifiHomeEvent(data.event, new Date(start + seconds * 1000), data.decoded.args);
    assert.deepEqual(data.event, before);
  }
  const status = api.getWifiHomeRuntimeStatus(start + 20_000);
  assert.equal(status.observer.matchState, 'matched');
  assert.equal(status.observer.counts.qualified, 3);
  assert.equal(publisherOptions.readGpsObservation().lat, anchor.lat);
  assert.equal(publisherOptions.readObservation(start + 20_000).matchState, 'matched');
  const publicText = JSON.stringify({ status, logs });
  for (const secret of [imei, radio, hashKey, observerOptions.routerHash, 'Private network', String(anchor.lat)]) {
    assert.ok(!publicText.includes(secret));
  }
});
