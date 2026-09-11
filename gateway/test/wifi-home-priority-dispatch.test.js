'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const cache = require('../src/live-cache');
const geofence = require('../src/geofence');
const { createHomeWifiTrackingPolicy } = require('../src/wifi-home-tracking');

test('real dispatcher retains raw telemetry but blocks GPS tracking while Home has priority', async () => {
  cache.resetCacheForTests(); geofence.resetGeofenceStateForTests();
  const noop = () => {};
  const imei = 'synthetic-watch';
  const now = Date.now();
  let home = { version: 4, policy: 'enrolled_home_radio_v4', pilot: true, state: 'matched', source: 'home_wifi',
    observedAt: new Date(now - 30000).toISOString(), expiresAt: new Date(now + 30000).toISOString(),
    anchor: { lat: -20.25, lng: 57.5, geofenceId: 'home', radiusMeters: 50 } };
  const query = { where: () => query, get: async () => ({ docs: [{ id: 'home', data: () => ({
    imei, active: true, name: 'Home', center: { lat: -20.25, lng: 57.5 }, radiusMeters: 50,
  }) }] }) };
  const db = { collection: () => query };
  const writes = [], history = [], alerts = [], journeys = [], errors = [];
  let boundaryEvaluations = 0, dwellPoints = 0;
  const modules = {
    net: { createServer: () => ({ on: noop, listen: noop }) },
    './config': { firestoreDisabled: true },
    './firestore': { initFirestore: noop, startIntelligenceMonitor: noop, getDb: () => db,
      upsertDevice: async (_imei, patch) => writes.push(patch),
      appendLocation: async (_imei, point) => history.push(point),
      appendJourney: async (_imei, journey) => journeys.push(journey),
      createAlert: async (_imei, alert) => alerts.push(alert), refreshDeviceIntelligence: async () => {} },
    './connection-handshake': { maybeAnnounceConnecting: async () => false },
    './connection-live': { buildSessionPersistPatch: (_s, patch) => patch },
    './fleet-hemisphere': { correctFleetHemisphere: event => event },
    './location-provenance': require('../src/location-provenance'),
    './v52-telemetry': { extractV52TelemetryValues: () => ({}), buildV52TelemetryPatch: () => ({}) },
    './http': { startHttpServer: noop },
    './ops-metrics': { incrementEvent: noop },
    './sessions': { noteDeviceLocation: noop },
    './adaptive-reporting': { applyAdaptiveReporting: async () => ({}) },
    './live-cache': { ...cache,
      shouldPersist: () => ({ persist: true, reason: 'first_fix', appendHistory: true }),
      trackPointForDwell: (...args) => { dwellPoints++; return cache.trackPointForDwell(...args); } },
    './geofence': { ...geofence, evaluateGeofenceTransitions: (...args) => {
      boundaryEvaluations++; return geofence.evaluateGeofenceTransitions(...args);
    } },
    './wifi-home-runtime': { observeWifiHomeEvent: noop, getHomeWifiPriority: () => home },
    './wifi-home-tracking': { selectHomeWifiTracking: createHomeWifiTrackingPolicy() },
  };
  const sandbox = { require: name => modules[name] || {}, module: { exports: {} },
    Date, setInterval: noop, console: { log: noop, warn: noop, error: (...args) => errors.push(args) } };
  const source = fs.readFileSync(path.join(__dirname, '../src/server.js'), 'utf8');
  vm.runInNewContext(`${source}\nmodule.exports = { applyEvents };`, sandbox);
  const point = { lat: -20.24, lng: 57.5, source: 'gps', gpsValid: true,
    satellites: 5, recordedAt: new Date(now - 1000) };
  const event = { imei, type: 'location', location: point, accuracySource: 'gps', gpsValid: true, speedKmh: 20 };
  await sandbox.module.exports.applyEvents([event], {});
  assert.deepEqual(errors, []);
  assert.equal(boundaryEvaluations, 0);
  assert.equal(dwellPoints, 0);
  assert.equal(cache.isJourneyActive(imei), false);
  assert.deepEqual(alerts, []); assert.deepEqual(journeys, []);
  assert.equal(writes.at(-1).location.lat, point.lat);
  assert.equal(writes.at(-1).location.source, 'gps');
  assert.equal(history.at(-1).lat, point.lat);
  assert.equal(history.at(-1).recordedAt, point.recordedAt);

  home = null;
  await sandbox.module.exports.applyEvents([{ ...event,
    location: { ...point, recordedAt: new Date(now) } }], {});
  assert.deepEqual(errors, []);
  assert.equal(boundaryEvaluations, 1);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].type, 'geofence_exit');
  assert.equal(cache.isJourneyActive(imei), true);
});
