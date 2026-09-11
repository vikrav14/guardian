'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const provenance = require('../src/location-provenance');
const snapshotApi = require('../src/sos-location-snapshot');
const { prepareSosWhatsApp } = require('../src/sos-whatsapp');
const fixtures = require('../../docs/testing/sos-location-selection.json');

const receipt = new Date('2026-09-01T12:00:00Z');
const after = new Date('2026-09-01T12:10:00Z');
const source = fs.readFileSync(path.join(__dirname, '../src/server.js'), 'utf8');
const noop = () => {};

// Execute the real event dispatcher with boundary dependencies replaced. No
// sockets, Firebase project, geolocation API or hardware commands are started.
function dispatcher(evidence, { geoResult = null, lookupFails = false, failAt = null } = {}) {
  const alerts = [];
  const writes = [];
  const errors = [];
  const wifiObservations = [];
  const warnings = [];
  const failIf = stage => {
    if (failAt === stage) throw new Error(`fixture ${stage} unavailable`);
  };
  let clock = receipt.getTime();
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }
  const modules = {
    net: { createServer: () => ({ on: noop, listen: noop }) },
    './config': { firestoreDisabled: true },
    './firestore': {
      initFirestore: noop, startIntelligenceMonitor: noop, getDb: () => ({}),
      getDeviceDocument: async () => {
        if (lookupFails) throw new Error('fixture lookup unavailable');
        return structuredClone(evidence);
      },
      upsertDevice: async (_imei, patch) => {
        failIf('persistence'); writes.push(patch); clock = after.getTime();
      },
      appendLocation: async () => { failIf('history'); },
      refreshDeviceIntelligence: async () => { failIf('intelligence'); },
      createAlert: async (_imei, alert) => { alerts.push(alert); },
    },
    './connection-handshake': { maybeAnnounceConnecting: async () => {
      failIf('connection'); return false;
    } },
    './adaptive-reporting': { activateSosOverride: async () => { failIf('reporting'); } },
    './connection-live': { buildSessionPersistPatch: (_s, patch) => patch },
    './location-provenance': provenance,
    './sos-location-snapshot': snapshotApi,
    './fleet-hemisphere': { correctFleetHemisphere: event => event },
    './v52-telemetry': { extractV52TelemetryValues: () => ({}), buildV52TelemetryPatch: () => ({}) },
    './http': { startHttpServer: noop },
    './ops-metrics': { incrementEvent: noop },
    './live-cache': {
      getLiveDeviceState: () => ({}), updateLiveState: noop,
      recordPersist: noop, noteObservationForJourney: noop, noteDiagnosticEventForJourney: noop,
      isJourneyActive: () => false,
    },
    './geolocate/google': { geolocateFromV: async () => {
      failIf('geolocation'); clock = after.getTime(); return geoResult;
    } },
    './sos-incident-window': { claimSosIncident: () => ({ accepted: true }) },
    './wifi-home-runtime': { observeWifiHomeEvent: (event, at, packetArgs) => {
      failIf('wifi-observer');
      wifiObservations.push({ event: structuredClone(event), at, packetArgs });
    } },
  };
  const sandbox = {
    require: name => modules[name] || {},
    module: { exports: {} }, Date: Clock, setInterval: noop,
    console: { log: noop, warn: (...args) => warnings.push(args), error: (...args) => errors.push(args) },
  };
  vm.runInNewContext(`${source}\nmodule.exports = { applyEvents };`, sandbox);
  return { apply: sandbox.module.exports.applyEvents, alerts, writes, errors, wifiObservations, warnings };
}

function alarm(overrides = {}) {
  return {
    type: 'alarm', alarmType: 'sos', imei: 'fixture-watch', alarmCode: '00010000',
    accuracySource: 'wifi', gpsValid: false,
    location: { lat: -20.2, lng: 57.2, source: 'wifi', accuracyMeters: 600,
      recordedAt: receipt },
    ...overrides,
  };
}

test('router observer sees original SOS evidence even when geolocation fails', async () => {
  const run = dispatcher(fixtures[0].device);
  const event = alarm({ needsGeolocation: true, wifiAccessPoints: [
    { macAddress: '02:00:00:00:00:01', signalStrength: -60 },
  ] });
  const packetArgs = ['private packet fields'];
  await run.apply([event], {}, packetArgs);
  assert.equal(run.wifiObservations.length, 1);
  assert.deepEqual(run.wifiObservations[0].event, event);
  assert.equal(run.wifiObservations[0].at.getTime(), receipt.getTime());
  assert.equal(run.wifiObservations[0].packetArgs, packetArgs);
  assert.ok(!JSON.stringify(run.alerts).includes('private packet fields'));
  assert.ok(!JSON.stringify(run.writes).includes('private packet fields'));
  assert.equal(run.alerts.length, 1);
  assert.equal(run.alerts[0].sosLocationSnapshot.location.lat, -20.1);
});

test('router observer failure cannot prevent SOS or replace its frozen evidence', async () => {
  const run = dispatcher(fixtures[0].device, { failAt: 'wifi-observer' });
  await run.apply([alarm()], {});
  assert.equal(run.alerts.length, 1);
  assert.equal(run.alerts[0].sosLocationSnapshot.location.lat, -20.1);
  assert.equal(run.errors.length, 0);
  assert.match(run.warnings.flat().join(' '), /observer unavailable; tracking continues/);
});

test('actual alarm dispatcher freezes selected GPS before telemetry persistence and sends it later', async () => {
  const run = dispatcher(fixtures[0].device);
  await run.apply([alarm()], {});
  assert.equal(run.errors.length, 0);
  assert.equal(run.alerts.length, 1);
  const alert = run.alerts[0];
  assert.equal(alert.sosLocationSnapshot.location.lat, -20.1);
  assert.equal(alert.sosLocationSnapshot.latestObservation.lat, -20.2);
  assert.equal(alert.sosLocationSnapshot.capturedAt.getTime(), receipt.getTime());
  assert.equal(alert.eventAt.getTime(), receipt.getTime());
  assert.equal(run.writes[0].location.lat, -20.2, 'raw observation must remain unchanged');
  assert.equal(run.writes[0].accuracySource, 'wifi');
  const prepared = await prepareSosWhatsApp({ alert, now: after,
    device: { location: { lat: -21, lng: 58, source: 'gps', recordedAt: after } } });
  assert.equal(prepared.plan.buttonUrlParameter, '-20.1,57.1');
  assert.match(prepared.plan.bodyParameters[2], /13 mins before SOS receipt/);
});

test('geolocation without a device time does not invent a fresh SOS observation timestamp', async () => {
  const run = dispatcher({}, { geoResult: { lat: -20.5, lng: 57.5, accuracyMeters: 700 } });
  await run.apply([alarm({ location: undefined, needsGeolocation: true })], {});
  assert.equal(run.errors.length, 0);
  assert.equal(run.alerts.length, 1);
  const snapshot = run.alerts[0].sosLocationSnapshot;
  assert.equal(snapshot.location.lat, -20.5);
  assert.equal(snapshot.location.recordedAt, null);
  assert.equal(snapshot.state, 'last_known');
});

test('failed approximate resolution still allows SOS with retained GPS evidence', async () => {
  const run = dispatcher(fixtures[0].device);
  await run.apply([alarm({ needsGeolocation: true })], {});
  assert.equal(run.errors.length, 0);
  assert.equal(run.alerts.length, 1);
  assert.equal(run.alerts[0].sosLocationSnapshot.location.lat, -20.1);
});

test('unavailable prior evidence does not drop the physical alarm or invent a GPS fix', async () => {
  const run = dispatcher({}, { lookupFails: true });
  await run.apply([alarm({ location: undefined })], {});
  assert.equal(run.alerts.length, 1);
  assert.equal(run.alerts[0].sosLocationSnapshot.state, 'unavailable');
  assert.equal(run.alerts[0].sosLocationSnapshot.location, null);
  assert.equal(run.errors.length, 1);
  assert.match(run.errors[0][0], /evidence lookup failed/);
});

for (const failAt of ['connection', 'geolocation', 'reporting', 'persistence', 'history', 'intelligence']) {
  test(`SOS survives ${failAt} failure with the same frozen primary GPS`, async () => {
    const run = dispatcher(fixtures[0].device, { failAt });
    await run.apply([alarm({ needsGeolocation: failAt === 'geolocation' })], {});
    assert.equal(run.alerts.length, 1, 'ancillary failures must not suppress SOS');
    assert.equal(run.alerts[0].sosLocationSnapshot.location.lat, -20.1);
    assert.equal(run.alerts[0].sosLocationSnapshot.capturedAt.getTime(), receipt.getTime());
    assert.equal(run.errors.length, 1, 'failed work remains observable');
    assert.match(run.errors[0].join(' '), new RegExp(failAt));
    const prepared = await prepareSosWhatsApp({ alert: run.alerts[0], now: after });
    assert.equal(prepared.plan.buttonUrlParameter, '-20.1,57.1');
  });
}

test('actual notification text builder uses the same frozen SOS point, not live coordinates', () => {
  const notifySource = fs.readFileSync(path.join(__dirname, '../src/notify.js'), 'utf8');
  const sandbox = {
    require: name => name === './sos-location-snapshot' ? snapshotApi : {},
    module: { exports: {} },
  };
  vm.runInNewContext(notifySource, sandbox);
  const alert = { type: 'sos', sosLocationSnapshot: snapshotApi.buildSosLocationSnapshot(fixtures[0].device, { now: receipt }) };
  const message = sandbox.module.exports.buildMessage('fixture-watch', alert, {
    location: { lat: -21, lng: 58, source: 'gps', recordedAt: after },
  });
  assert.match(message, /q=-20\.1,57\.1/);
  assert.doesNotMatch(message, /q=-21,58/);
  assert.match(message, /13 mins before SOS receipt/);
});
