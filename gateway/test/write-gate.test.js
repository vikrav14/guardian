const test = require('node:test');
const assert = require('node:assert/strict');
const {
  shouldPersist,
  recordPersist,
  resetCacheForTests,
  movedEnough,
  heartbeatCapDue,
  batteryChanged,
  onDeviceConnect,
} = require('../src/live-cache');

function baseLocation(lat = -20.2642, lng = 57.4791) {
  return { lat, lng, recordedAt: new Date() };
}

test.beforeEach(() => {
  resetCacheForTests();
});

test('shouldPersist skips when moved less than 50m', () => {
  const imei = 'WG1';
  recordPersist(imei, { location: baseLocation(), batteryPercent: 80 });

  const gate = shouldPersist(imei, {
    eventType: 'location',
    location: baseLocation(-20.26425, 57.47915),
  });

  assert.equal(gate.persist, false);
});

test('shouldPersist persists when moved 60m', () => {
  const imei = 'WG2';
  recordPersist(imei, { location: baseLocation(), batteryPercent: 80 });

  const gate = shouldPersist(imei, {
    eventType: 'location',
    location: baseLocation(-20.2642 + 60 / 111320, 57.4791),
  });

  assert.equal(gate.persist, true);
  assert.equal(gate.reason, 'moved');
  assert.equal(gate.appendHistory, false);
});

test('shouldPersist persists on battery 80 to 79', () => {
  const imei = 'WG3';
  recordPersist(imei, { location: baseLocation(), batteryPercent: 80 });

  const gate = shouldPersist(imei, {
    eventType: 'heartbeat',
    batteryPercent: 79,
  });

  assert.equal(gate.persist, true);
  assert.equal(gate.reason, 'battery_changed');
});

test('shouldPersist persists on heartbeat cap after 5 minutes stationary', () => {
  const imei = 'WG4';
  const start = new Date('2026-07-22T12:00:00Z');
  recordPersist(imei, { location: baseLocation(), batteryPercent: 80, now: start });

  const gate = shouldPersist(imei, {
    eventType: 'location',
    location: baseLocation(),
    batteryPercent: 80,
    now: new Date('2026-07-22T12:05:00Z'),
  });

  assert.equal(gate.persist, true);
  assert.equal(gate.reason, 'heartbeat_cap');
});

test('shouldPersist always persists alarms', () => {
  const imei = 'WG5';

  for (const alarmType of ['sos', 'fall', 'low_battery', 'geofence_enter', 'geofence_exit']) {
    const gate = shouldPersist(imei, { alarmType });
    assert.equal(gate.persist, true, alarmType);
    assert.equal(gate.reason, 'alarm');
  }
});

test('shouldPersist first fix after connect', () => {
  const imei = 'WG6';
  onDeviceConnect(imei);

  const gate = shouldPersist(imei, {
    eventType: 'location',
    location: baseLocation(),
  });

  assert.equal(gate.persist, true);
  assert.equal(gate.reason, 'first_fix');
});

test('shouldPersist geofence transition forces persist', () => {
  const imei = 'WG7';
  recordPersist(imei, { location: baseLocation(), batteryPercent: 80 });

  const gate = shouldPersist(imei, {
    eventType: 'location',
    location: baseLocation(),
    geofenceTransition: true,
  });

  assert.equal(gate.persist, true);
  assert.equal(gate.reason, 'geofence_transition');
});

test('movedEnough returns false under threshold', () => {
  const state = { lastPersistedLocation: { lat: -20.2642, lng: 57.4791 } };
  assert.equal(movedEnough(state, baseLocation(-20.26425, 57.47915)), false);
});

test('batteryChanged detects integer change only', () => {
  const state = { lastPersistedBattery: 80 };
  assert.equal(batteryChanged(state, 79), true);
  assert.equal(batteryChanged(state, 80), false);
  assert.equal(batteryChanged(state, 80.4), false);
});

test('heartbeatCapDue false before interval', () => {
  const now = new Date('2026-07-22T12:04:00Z');
  const state = { lastHeartbeatPersistAt: new Date('2026-07-22T12:00:00Z') };
  assert.equal(heartbeatCapDue(state, now), false);
});
