'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHomeWifiTrackingPolicy } = require('../src/wifi-home-tracking');
const { evaluateGeofenceTransitions, getGeofencePresence, resetGeofenceStateForTests } = require('../src/geofence');
const { trackPointForJourney, isJourneyActive, resetCacheForTests,
  updateLiveState, recordPersist, getLiveDeviceState } = require('../src/live-cache');
const { evaluateDeviceIntelligence } = require('../src/intelligence');
const { decodePolyline } = require('../src/polyline');
const { isAtGeofence, getDeviceIntelligence } = require('../src/assistant/tools');

const origin = { lat: -20.25, lng: 57.5 };
const start = Date.parse('2026-09-12T08:00:00Z');
const at = seconds => new Date(start + seconds * 1000);
const imei = 'synthetic-watch';
function evidence(seconds = 10) {
  return { version: 4, policy: 'enrolled_home_radio_v4', pilot: true,
    state: 'matched', source: 'home_wifi', observedAt: at(seconds).toISOString(),
    expiresAt: at(seconds + 120).toISOString(),
    anchor: { ...origin, geofenceId: 'home', radiusMeters: 50, label: 'Home' } };
}
function gps(seconds, offset = 0, speedKmh = 0) {
  return { lat: origin.lat + offset, lng: origin.lng, source: 'gps',
    gpsValid: true, satellites: 7, recordedAt: at(seconds), speedKmh };
}
const zones = [
  { id: 'home', data: { imei, active: true, name: 'Home', center: origin, radiusMeters: 50 } },
  { id: 'school', data: { imei, active: true, name: 'School',
    center: { lat: origin.lat + 0.01, lng: origin.lng }, radiusMeters: 150 } },
];
function database(docs = zones) {
  const query = { where: () => query, get: async () => ({ docs: docs.map(d => ({ id: d.id, data: () => d.data })) }) };
  return { collection: () => query };
}
function harness(db = database()) {
  resetCacheForTests(); resetGeofenceStateForTests();
  const select = createHomeWifiTrackingPolicy();
  const alerts = [], journeys = [];
  async function receive(point, home, now = point.recordedAt) {
    const before = structuredClone(point);
    const decision = select(imei, point, home, now);
    journeys.push(...decision.flushes);
    if (!decision.hold) {
      const transitions = await evaluateGeofenceTransitions(db, imei, point);
      alerts.push(...transitions);
      const presence = getGeofencePresence(imei);
      const transition = transitions[0];
      const result = trackPointForJourney(imei, point, now, {
        geofenceTransition: Boolean(transition), transitionType: transition?.type,
        geofenceId: transition?.payload?.geofenceId, geofenceName: transition?.payload?.geofenceName,
        transitionEvidence: transition?.payload?.observationEvidence,
        hasActiveSafeZones: presence.hasActiveZones, insideAnySafeZone: presence.insideAny,
        insideSafeZoneIds: presence.insideZoneIds, hasUncertainSafeZones: presence.hasUncertainZones,
      });
      journeys.push(...result.flushes);
    }
    updateLiveState(imei, { location: point, speedKmh: point.speedKmh, accuracySource: point.source });
    recordPersist(imei, { location: point }, now);
    assert.deepEqual(point, before, 'raw telemetry must not be rewritten to the Home anchor');
    return decision;
  }
  return { receive, select, alerts, journeys };
}

test('Home radio holds GPS A/V drift, School transitions, dwell and new journeys', async () => {
  const run = harness();
  await run.receive(gps(0), null);
  for (let seconds = 10; seconds <= 110; seconds += 10) {
    const point = gps(seconds, seconds % 20 ? 0.01 : 0.006, 15);
    if (seconds % 30 === 0) Object.assign(point, { source: 'wifi', gpsValid: false, accuracyMeters: 519 });
    assert.equal((await run.receive(point, evidence())).hold, true);
    assert.equal(isJourneyActive(imei), false);
    assert.deepEqual(getGeofencePresence(imei).insideZoneIds, ['home']);
  }
  assert.deepEqual(run.alerts, []);
  assert.deepEqual(run.journeys, []);
  assert.notEqual(getLiveDeviceState(imei).location.lat, origin.lat, 'raw GPS remains available');
});

test('expiry does not depart; new valid GPS can depart without joining an indoor GPS baseline', async () => {
  const run = harness();
  await run.receive(gps(10, -0.02), evidence());
  assert.equal(run.select(imei, null, evidence(), at(130)).hold, true);
  for (const point of [gps(5, 0.002), { ...gps(135, 0.01), source: 'lbs', gpsValid: false }, gps(200, 0.002)]) {
    assert.equal((await run.receive(point, null, at(135))).hold, true);
  }
  assert.deepEqual(run.alerts, []);
  assert.equal((await run.receive(gps(140, 0.002), null)).hold, false);
  assert.equal(run.alerts.length, 1);
  assert.equal(run.alerts[0].type, 'geofence_exit');
  assert.equal(run.alerts[0].payload.geofenceId, 'home');
  assert.equal(run.alerts[0].payload.observationEvidence.source, 'gps');
  await run.receive(gps(150, 0.003), null);
  await run.receive(gps(160, 0.02, 10), evidence(160));
  assert.equal(run.journeys.length, 1);
  const journey = run.journeys[0];
  assert.equal(journey.closeReason, 'home_wifi_detected');
  assert.equal(journey.pointCount, 2);
  assert.ok(journey.distanceKm > 0.10 && journey.distanceKm < 0.12);
  assert.equal(+journey.endAt, +at(150), 'Home does not extend the GPS route to an invented arrival');
  assert.equal(journey.routeStartAnchored, false);
  assert.deepEqual(decodePolyline(journey.polyline), [
    { lat: origin.lat + 0.002, lng: origin.lng }, { lat: origin.lat + 0.003, lng: origin.lng },
  ]);
  assert.equal(run.alerts.length, 1, 'radio re-entry seeds Home without an invented crossing alert');
});

test('first GPS after Home without zones cannot create a trip from a baseline jump', async () => {
  const run = harness(database([]));
  await run.receive(gps(10, -0.02), evidence());
  await run.receive(gps(140, 0.002), null);
  assert.equal(isJourneyActive(imei), false);
  await run.receive(gps(150, 0.002), null);
  assert.equal(isJourneyActive(imei), false);
  await run.receive(gps(160, 0.003), null);
  assert.equal(isJourneyActive(imei), true, 'subsequent genuine GPS movement still starts a route');
});

test('legacy, candidate and expired records cannot activate movement priority', () => {
  for (const change of [
    { version: 3, policy: 'enrolled_home_radio_v3' }, { state: 'candidate' },
    { pilot: false }, { expiresAt: at(9).toISOString() },
  ]) {
    const select = createHomeWifiTrackingPolicy({ suspend: () => { throw new Error('Unexpected suspension'); } });
    assert.equal(select('other-watch', gps(20), { ...evidence(), ...change }, at(20)).hold, false);
  }
});

test('post-Home GPS allows the existing bounded V52 clock skew but rejects future backlog', () => {
  const select = createHomeWifiTrackingPolicy({ suspend: () => [], seedHome: () => {} });
  select(imei, gps(10), evidence(), at(10));
  assert.equal(select(imei, gps(180), null, at(140)).hold, true);
  assert.equal(select(imei, gps(142), null, at(140)).hold, false);
});

test('fresh Home suppresses GPS-derived AI warnings but preserves offline and battery analysis', () => {
  const device = { ...gps(10, 0.02, 8), imei, online: true, batteryPercent: 5,
    lastHeartbeatAt: at(20), location: gps(10, 0.02), speedKmh: 8, accuracySource: 'gps' };
  const normal = evaluateDeviceIntelligence({ device, geofences: zones.map(z => z.data), now: at(20) });
  assert.ok(normal.some(i => i.id === 'geofence_exit_urgent'));
  assert.ok(normal.some(i => i.id === 'low_battery_moving'));
  const home = evaluateDeviceIntelligence({ device: { ...device, homeWifiPresence: evidence() },
    geofences: zones.map(z => z.data), now: at(20) });
  assert.ok(!home.some(i => ['geofence_exit_urgent', 'stale_gps', 'low_battery_moving'].includes(i.id)));
  const offline = evaluateDeviceIntelligence({ device: { ...device, online: false,
    lastHeartbeatAt: at(-3600), homeWifiPresence: evidence() }, now: at(20) });
  assert.ok(offline.some(i => i.id === 'offline'));
});

test('Home qualifying during a pending geofence query prevents a late GPS exit', async () => {
  resetGeofenceStateForTests();
  await evaluateGeofenceTransitions(database(), imei, gps(0));
  let release;
  let home = null;
  const query = { where: () => query, get: () => new Promise(resolve => { release = resolve; }) };
  const pending = evaluateGeofenceTransitions({ collection: () => query }, imei, gps(10, 0.01),
    { readHomeEvidence: () => home });
  const now = Date.now();
  home = { ...evidence(), observedAt: new Date(now - 1000).toISOString(),
    expiresAt: new Date(now + 30_000).toISOString() };
  release({ docs: zones.map(d => ({ id: d.id, data: () => d.data })) });
  assert.deepEqual(await pending, []);
  assert.deepEqual(getGeofencePresence(imei).insideZoneIds, ['home']);
});

test('assistant Home checks use radio evidence, not GPS or another saved zone', async () => {
  const now = Date.now();
  const home = { ...evidence(), observedAt: new Date(now - 1000).toISOString(),
    expiresAt: new Date(now + 30_000).toISOString() };
  const device = { imei, nickname: 'Test wearer', homeWifiPresence: home,
    location: gps(10, 0.01), accuracySource: 'gps', intelligence: {
      topInsight: { id: 'geofence_exit_urgent', inference: 'Outside Home' },
      insights: [{ id: 'geofence_exit_urgent', inference: 'Outside Home' }],
    } };
  const ctx = { devices: [device] };
  const result = await isAtGeofence(database(), ctx, { imei, geofence_name: 'Home' });
  assert.equal(result.atGeofence, true);
  assert.equal(result.source, 'home_wifi');
  assert.equal(result.distanceMeters, undefined, 'radio proximity has no measured distance');
  const school = await isAtGeofence(database(), ctx, { imei, geofence_name: 'School' });
  assert.equal(school.atGeofence, null, 'GPS must not simultaneously claim School');
  const insight = await getDeviceIntelligence(ctx, { imei });
  assert.equal(insight.homeWifiDetected, true);
  assert.equal(insight.topInsight, null, 'cached GPS warnings cannot contradict current Home evidence');
  device.location = null;
  assert.equal((await isAtGeofence(database(), ctx, { imei, geofence_name: 'Home' })).atGeofence, true);
});
