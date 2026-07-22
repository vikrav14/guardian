const test = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluateDeviceIntelligence,
  resolveHomeGeofence,
  shouldCreateOfflineAlert,
  resetIntelligenceStateForTests,
} = require('../src/intelligence');

const homeGeofence = {
  id: 'home1',
  name: 'Home',
  active: true,
  center: { lat: -20.2642, lng: 57.4791 },
  radiusMeters: 150,
};

test.afterEach(() => {
  resetIntelligenceStateForTests();
});

test('resolveHomeGeofence prefers name containing home', () => {
  const zones = [
    { name: 'School', active: true },
    { name: 'Grandma Home', active: true },
  ];
  assert.equal(resolveHomeGeofence(zones).name, 'Grandma Home');
});

test('resolveHomeGeofence uses sole geofence when only one active', () => {
  const zones = [{ name: 'Office', active: true }];
  assert.equal(resolveHomeGeofence(zones).name, 'Office');
});

test('offline rule fires after configurable heartbeat gap', () => {
  const now = new Date('2026-07-22T12:00:00Z');
  const insights = evaluateDeviceIntelligence({
    imei: 'OFF1',
    now,
    config: { offlineMinutes: 10 },
    device: {
      online: true,
      lastHeartbeatAt: new Date('2026-07-22T11:45:00Z'),
    },
  });

  const offline = insights.find((i) => i.id === 'offline');
  assert.ok(offline);
  assert.equal(offline.level, 'warning');
  assert.match(offline.inference, /No heartbeat for 15 minutes/);
  assert.ok(offline.confidence >= 50);
});

test('low_battery_moving includes battery and speed facts', () => {
  const insights = evaluateDeviceIntelligence({
    imei: 'BAT1',
    device: {
      batteryPercent: 8,
      speedKmh: 12,
      location: { lat: -20.30, lng: 57.50, recordedAt: new Date() },
    },
    geofences: [homeGeofence],
  });

  const rule = insights.find((i) => i.id === 'low_battery_moving');
  assert.ok(rule);
  assert.equal(rule.level, 'warning');
  assert.match(rule.inference, /Battery at 8%/);
  assert.match(rule.inference, /12\.0 km\/h/);
});

test('stale_gps flags old location fixes', () => {
  const now = new Date('2026-07-22T12:00:00Z');
  const insights = evaluateDeviceIntelligence({
    imei: 'GPS1',
    now,
    config: { staleGpsMinutes: 8 },
    device: {
      online: true,
      lastHeartbeatAt: now,
      accuracySource: 'gps',
      location: {
        lat: -20.2642,
        lng: 57.4791,
        recordedAt: new Date('2026-07-22T11:50:00Z'),
      },
    },
  });

  const rule = insights.find((i) => i.id === 'stale_gps');
  assert.ok(rule);
  assert.match(rule.inference, /10 minutes old/);
});

test('geofence_exit_urgent summarizes outside home zone', () => {
  const insights = evaluateDeviceIntelligence({
    imei: 'EXIT1',
    device: {
      online: true,
      lastHeartbeatAt: new Date(),
      speedKmh: 5,
      location: { lat: -20.30, lng: 57.50, recordedAt: new Date() },
    },
    geofences: [homeGeofence],
  });

  const rule = insights.find((i) => i.id === 'geofence_exit_urgent');
  assert.ok(rule);
  assert.match(rule.inference, /Outside Home/);
});

test('battery_forecast estimates days remaining from heartbeat samples', () => {
  const imei = 'FCST1';
  const base = new Date('2026-07-20T08:00:00Z');

  for (let i = 0; i < 4; i++) {
    evaluateDeviceIntelligence({
      imei,
      now: new Date(base.getTime() + i * 3 * 3_600_000),
      device: { batteryPercent: 80 - i * 5 },
    });
  }

  const insights = evaluateDeviceIntelligence({
    imei,
    now: new Date(base.getTime() + 12 * 3_600_000),
    device: { batteryPercent: 60 },
    config: { batteryForecastMinSamples: 3, batteryForecastMinHours: 2 },
  });

  const rule = insights.find((i) => i.id === 'battery_forecast');
  assert.ok(rule);
  assert.match(rule.inference, /days remaining/);
});

test('insights below confidence threshold use generic inference text', () => {
  const insights = evaluateDeviceIntelligence({
    imei: 'LOW1',
    device: {
      online: true,
      lastHeartbeatAt: new Date(),
      batteryPercent: 8,
      speedKmh: 0.5,
    },
  });

  const moving = insights.find((i) => i.id === 'low_battery_moving');
  assert.equal(moving, undefined);
});

test('shouldCreateOfflineAlert respects cooldown', () => {
  const imei = 'CD1';
  assert.equal(shouldCreateOfflineAlert(imei, { offlineAlertCooldownMinutes: 30 }), true);
  assert.equal(shouldCreateOfflineAlert(imei, { offlineAlertCooldownMinutes: 30 }), false);
});

test('evaluateDeviceIntelligence sorts urgent insights first', () => {
  const now = new Date('2026-07-22T12:00:00Z');
  const insights = evaluateDeviceIntelligence({
    imei: 'SORT1',
    now,
    device: {
      online: true,
      batteryPercent: 4,
      speedKmh: 15,
      lastHeartbeatAt: new Date('2026-07-22T11:40:00Z'),
      location: { lat: -20.30, lng: 57.50, recordedAt: new Date('2026-07-22T11:50:00Z') },
    },
    geofences: [homeGeofence],
  });

  assert.ok(insights.length >= 2);
  const levels = insights.map((i) => i.level);
  const urgentIdx = levels.indexOf('urgent');
  const infoIdx = levels.lastIndexOf('info');
  if (urgentIdx >= 0 && infoIdx >= 0) {
    assert.ok(urgentIdx < infoIdx);
  }
});
