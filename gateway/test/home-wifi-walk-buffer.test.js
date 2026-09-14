'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHomeWifiWalkBuffer } = require('../src/home-wifi-walk-buffer');
const { recoverHomeWifiWalk } = require('../src/home-wifi-walk-recovery');
const { selectHomeWifiTracking } = require('../src/wifi-home-tracking');
const { resetGeofenceStateForTests } = require('../src/geofence');
const cache = require('../src/live-cache');
const { decodePolyline } = require('../src/polyline');
const { hasJourneyGpsEvidence } = require('../src/journey-source-evidence');
const { createHomeWifiPublisher } = require('../src/wifi-home-display');

const epoch = Date.parse('2026-09-14T08:00:00Z');
const at = seconds => new Date(epoch + seconds * 1000);
const origin = { lat: -20.25, lng: 57.5 };
let sequence = 0;
function harness({ delayed = false } = {}) {
  cache.resetCacheForTests(); resetGeofenceStateForTests();
  const imei = `synthetic-walk-${++sequence}`;
  let clock = +at(0), ready = true, source = 0, owner = 'owner';
  const anchor = { ...origin, radiusMeters: 50, geofenceId: 'home' };
  const key = () => JSON.stringify(['home', origin.lat, origin.lng, 50, owner]);
  const home = () => ({ version: 4, policy: 'enrolled_home_radio_v4', pilot: true,
    state: 'matched', source: 'home_wifi', anchor,
    observedAt: at(source).toISOString(), expiresAt: at(source + 120).toISOString() });
  const context = () => ({ ready, key: key(), anchor,
    home: clock < +at(source + 120) ? home() : null,
    observation: { reason: clock < +at(source + 120) ? 'repeated_router_observations' : 'observation_expired',
      observedAt: at(source).toISOString() } });
  const doc = { id: 'home', data: () => ({ imei, name: 'Home', active: true,
    center: origin, radiusMeters: 50, createdBy: owner }) };
  let release, activeReads = 0, reads = 0, timeout;
  const query = { where: () => query, onSnapshot(next) {
    reads++; activeReads++;
    release = () => next({ docs: [doc] });
    if (!delayed) queueMicrotask(release);
    return () => { activeReads--; };
  } };
  const alerts = [], journeys = [], reports = [];
  const buffer = createHomeWifiWalkBuffer({ readContext: context, now: () => clock,
    report: value => reports.push(value),
    setTimer: callback => { timeout = callback; return { unref() {} }; }, clearTimer: () => {},
    recover: (points, batch, current, signal) => recoverHomeWifiWalk({
      db: { collection: () => query }, imei, points, batch, current, signal, now: () => clock,
      createAlert: async (_imei, alert) => alerts.push(alert),
      flushJourneys: async (_imei, values) => journeys.push(...values),
    }),
  });
  const point = (seconds, metres) => ({ lat: origin.lat + metres / 111195, lng: origin.lng,
    source: 'gps', gpsValid: true, satellites: 7, accuracyMeters: null,
    recordedAt: at(seconds), speedKmh: 5 });
  function observe(value, receipt = +value.recordedAt) {
    clock = receipt; buffer.observe(value, clock);
    const decision = selectHomeWifiTracking(imei, value, context().home, new Date(clock));
    journeys.push(...decision.flushes);
    cache.updateLiveState(imei, { location: value, accuracySource: value.source });
    return decision;
  }
  return { imei, buffer, point, observe, alerts, journeys, reports, context, doc,
    setClock: seconds => { clock = +at(seconds); }, renew: seconds => { source = seconds; },
    revoke: () => { ready = false; }, changeOwner: () => { owner = 'other-owner'; },
    release: () => release(), timeout: () => timeout(), reads: () => reads,
    activeReads: () => activeReads, stop: () => buffer.stop() };
}

function capturedWalk(run) {
  const points = [run.point(68, 107), run.point(113, 41)];
  assert.equal(run.observe(points[0], +at(72)).hold, true);
  assert.equal(run.observe(points[1], +at(116)).hold, true);
  return points;
}

test('held GPS becomes one partial walk at Home expiry without another GPS report', async () => {
  const run = harness(), points = capturedWalk(run);
  assert.equal(cache.isJourneyActive(run.imei), false);
  run.setClock(119); await run.buffer.tick(); assert.equal(run.reads(), 0);
  run.setClock(120.001); await run.buffer.tick();
  assert.equal(run.activeReads(), 0); assert.equal(cache.isJourneyActive(run.imei), true);
  assert.equal(run.alerts.length, 1); assert.equal(run.alerts[0].type, 'geofence_exit');
  assert.equal(+run.alerts[0].eventAt, +at(68));
  assert.equal(run.alerts[0].payload.observationEvidence.source, 'gps');
  await run.buffer.tick(); assert.equal(run.reads(), 1);
  assert.equal(cache.getLiveDeviceState(run.imei).location.lat, points[1].lat);
  run.renew(560); run.observe({ ...run.point(560, 0), source: 'wifi', gpsValid: false });
  assert.equal(run.journeys.length, 1);
  const journey = run.journeys[0];
  assert.equal(journey.closeReason, 'home_wifi_detected');
  assert.equal(+journey.startAt, +at(68)); assert.equal(+journey.endAt, +at(113));
  assert.equal(journey.pointCount, 2); assert.equal(journey.routeStartAnchored, false);
  assert.ok(journey.distanceKm > 0.065 && journey.distanceKm < 0.067);
  assert.equal(hasJourneyGpsEvidence(journey), true);
  assert.equal(decodePolyline(journey.polyline).length, 2);
  assert.equal(run.alerts.length, 1, 'radio does not invent a GPS arrival');
  assert.equal(run.reports[0].outcome, 'recovered'); run.stop();
});

test('jitter, lone outliers, approximate positions and implausible jumps never recover trips', async () => {
  for (const samples of [[[68, 21], [90, 34], [113, 26]], [[68, 107]],
    [[68, 107], [113, 0]], [[68, 107], [113, 100]], [[68, 107], [113, -107]], [[68, 107], [69, 41]]]) {
    const run = harness();
    for (const [seconds, metres] of samples) run.observe(run.point(seconds, metres));
    run.setClock(120.001); await run.buffer.tick();
    assert.equal(cache.isJourneyActive(run.imei), false, JSON.stringify(samples));
    assert.equal(run.reads(), 0); assert.deepEqual(run.alerts, []); run.stop();
  }
  for (const patch of [{ source: 'wifi', gpsValid: false }, { source: 'lbs', gpsValid: false },
    { gpsValid: false }, { accuracyMeters: 519 }, { satellites: 2 }, { lat: NaN }]) {
    const run = harness();
    run.observe({ ...run.point(68, 107), ...patch }); run.observe({ ...run.point(113, 41), ...patch });
    run.setClock(120.001); await run.buffer.tick(); assert.equal(run.reads(), 0); run.stop();
  }
});

test('duplicates, reversed times, backlog and future fixes cannot supply corroboration', async () => {
  for (const seconds of [68, 67, -100, 140]) {
    const run = harness(); run.observe(run.point(68, 107));
    run.observe(run.point(seconds, 41), +at(113));
    run.setClock(120.001); await run.buffer.tick(); assert.equal(run.reads(), 0); run.stop();
  }
});

test('renewed Home, binding changes, revoked access and stale samples discard pending walks', async () => {
  for (const change of [run => run.renew(115), run => run.revoke(), run => run.changeOwner(), run => run.setClock(200)]) {
    const run = harness(); capturedWalk(run); run.setClock(120.001); change(run);
    await run.buffer.tick(); assert.equal(run.reads(), 0); assert.deepEqual(run.alerts, []); run.stop();
  }
});

test('new live GPS owns normal tracking and cancels provisional replay', async () => {
  const run = harness(); capturedWalk(run);
  assert.equal(run.observe(run.point(121, 120)).hold, false);
  await run.buffer.tick(); assert.equal(run.reads(), 0); run.stop();
});

test('a delayed duplicate or inside fix cannot erase newer corroborating GPS', async () => {
  const run = harness(); capturedWalk(run);
  run.observe(run.point(67, 0), +at(117));
  run.observe(run.point(68, 107), +at(118));
  run.setClock(120.001); await run.buffer.tick();
  assert.equal(cache.isJourneyActive(run.imei), true); run.stop();
  const delayed = harness({ delayed: true }); capturedWalk(delayed); delayed.setClock(120.001);
  const pending = delayed.buffer.tick();
  delayed.buffer.observe(delayed.point(68, 0), +at(121));
  delayed.release(); await pending;
  assert.equal(cache.isJourneyActive(delayed.imei), true); delayed.stop();
});

test('Home loss without GPS cannot infer departure', async () => {
  const run = harness(); run.setClock(120.001); await run.buffer.tick();
  run.observe({ ...run.point(130, 500), source: 'wifi', gpsValid: false });
  await run.buffer.tick(); assert.equal(run.reads(), 0); assert.deepEqual(run.alerts, []); run.stop();
});

test('late reads cannot recover after stop, renewed Home, live GPS, lease loss, expiry or owner changes', async () => {
  for (const change of [run => run.stop(), run => run.renew(121), run => run.revoke(),
    run => run.changeOwner(), run => run.observe(run.point(122, 150)), run => run.setClock(200)]) {
    const run = harness({ delayed: true }); capturedWalk(run); run.setClock(120.001);
    const pending = run.buffer.tick(); assert.equal(run.activeReads(), 1);
    change(run); run.release(); await pending;
    assert.equal(run.activeReads(), 0); assert.deepEqual(run.alerts, []);
    assert.equal(cache.isJourneyActive(run.imei), false); run.stop();
  }
});

test('read timeout cancels its listener without retrying another departure', async () => {
  const run = harness({ delayed: true }); capturedWalk(run); run.setClock(120.001);
  const pending = run.buffer.tick(); run.timeout(); await pending;
  assert.equal(run.activeReads(), 0); run.release(); await run.buffer.tick();
  assert.equal(run.reads(), 1); assert.deepEqual(run.alerts, []); run.stop();
});

test('fresh zone snapshot rejects a deleted, edited or reassigned Home', async () => {
  for (const patch of [{ active: false }, { radiusMeters: 75 }, { createdBy: 'different-owner' }]) {
    const run = harness({ delayed: true }); capturedWalk(run); run.setClock(120.001);
    const data = run.doc.data(); run.doc.data = () => ({ ...data, ...patch });
    const pending = run.buffer.tick(); run.release(); await pending;
    assert.deepEqual(run.alerts, []); assert.equal(cache.isJourneyActive(run.imei), false); run.stop();
  }
});

test('publisher tracking context expires and stops without exposing binding identity in status', async () => {
  let clock = +at(0);
  const publisher = createHomeWifiPublisher({ now: () => clock,
    readBinding: async () => ({ ready: true, key: 'private-binding', validUntilMs: +at(60),
      anchor: { ...origin, geofenceId: 'home', radiusMeters: 50 } }),
    readObservation: () => ({ enabled: true, configured: true, matchState: 'matched', consecutiveMatches: 3,
      observedAt: at(0).toISOString(), expiresAt: at(120).toISOString() }),
    resetObservation: () => {}, persist: async () => {} });
  await publisher.tick(); assert.equal(publisher.getTrackingContext().ready, true);
  assert.equal(publisher.getTrackingContext().key, 'private-binding');
  assert.equal(JSON.stringify(publisher.getStatus()).includes('private-binding'), false);
  clock = +at(60); assert.equal(publisher.getTrackingContext().ready, false);
  publisher.stop(); assert.equal(publisher.getTrackingContext(+at(10)).ready, false);
});

test('live runtime scopes retention to its pilot, ticks without packets and stops/restarts empty', async () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const run = harness();
  let clock = +at(72), publisherStops = 0;
  const timers = new Set(), recovered = [];
  const publisher = Object.assign(() => { publisherStops++; }, {
    getStatus: () => ({}), getEvidence: () => run.context().home,
    getTrackingContext: () => run.context(),
  });
  const config = { wifiHomeObserveEnabled: true, wifiHomeDisplayPilotEnabled: true, wifiHomePilotImei: run.imei };
  const modules = {
    './config': config, './wifi-home-observer': {},
    './wifi-home-display': { startHomeWifiPublisher: () => publisher },
    './home-wifi-walk-buffer': { createHomeWifiWalkBuffer: options => createHomeWifiWalkBuffer({
      ...options, now: () => clock,
    }) },
  };
  const sandbox = { module: { exports: {} }, require: name => {
    assert.ok(modules[name], `unexpected dependency ${name}`); return modules[name];
  }, Date, console: { log() {} }, setInterval: callback => {
    const timer = { callback, unref() {} }; timers.add(timer); return timer;
  }, clearInterval: timer => timers.delete(timer) };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/wifi-home-runtime'), 'utf8'), sandbox);
  const api = sandbox.module.exports;
  const start = () => api.startWifiHomeDisplayPilot({}, { recoverWalk: async (points, _batch, current) => {
    assert.equal(current(), true); recovered.push(points); return { recovered: true };
  } });
  const stop = start(); assert.equal(timers.size, 1);
  run.setClock(72); api.observeHomeWifiWalk('other-watch', run.point(68, 500), at(72));
  api.observeHomeWifiWalk(run.imei, run.point(68, 107), at(72));
  clock = +at(116); run.setClock(116); api.observeHomeWifiWalk(run.imei, run.point(113, 41), at(116));
  clock = +at(120.001); run.setClock(120.001);
  [...timers][0].callback(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(recovered.length, 1); assert.equal(recovered[0].length, 2);
  stop(); assert.equal(timers.size, 0); assert.equal(publisherStops, 1);
  const restarted = start(); [...timers][0].callback();
  await new Promise(resolve => setImmediate(resolve)); assert.equal(recovered.length, 1);
  restarted(); config.wifiHomeDisplayPilotEnabled = false;
  assert.equal(start(), null); assert.equal(timers.size, 0); run.stop();
});
