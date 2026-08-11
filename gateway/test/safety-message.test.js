const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSafetyMessage, buildSafetyContext, isOnline } = require('../src/safety-message');

const now = new Date('2026-08-12T10:00:00.000Z');

function baseDevice(overrides = {}) {
  return {
    nickname: 'Jesh',
    online: true,
    lastHeartbeatAt: new Date('2026-08-12T09:59:00.000Z'),
    batteryPercent: 63,
    accuracySource: 'gps',
    location: {
      lat: -20.0085,
      lng: 57.5901,
      placeLabel: 'Lower Vale',
      recordedAt: new Date('2026-08-12T09:58:00.000Z'),
    },
    ...overrides,
  };
}

test('SOS contains one rich factual payload and never exposes IMEI', () => {
  const text = buildSafetyMessage({
    type: 'sos',
    device: { imei: '861397052547492', ...baseDevice() },
    alert: { type: 'sos', createdAt: new Date('2026-08-12T09:57:00.000Z') },
    now,
  });
  assert.match(text, /GUARDIAN SOS — Jesh/);
  assert.match(text, /Lower Vale/);
  assert.match(text, /Satellite GPS/);
  assert.match(text, /Updated 2 mins ago/);
  assert.match(text, /Watch online · Battery 63%/);
  assert.match(text, /https:\/\/maps\.google\.com\/\?q=-20\.0085,57\.5901/);
  assert.doesNotMatch(text, /861397052547492/);
  assert.doesNotMatch(text, /IMEI/i);
});

test('WiFi fallback is explicitly described as approximate', () => {
  const text = buildSafetyMessage({
    type: 'sos',
    device: baseDevice({ accuracySource: 'wifi' }),
    alert: { type: 'sos' },
    now,
  });
  assert.match(text, /Approximate location near Lower Vale/);
  assert.match(text, /Approximate location \(WiFi positioning\)/);
  assert.doesNotMatch(text, /Satellite GPS/);
});

test('LBS fallback is explicitly described as approximate', () => {
  const text = buildSafetyMessage({
    type: 'sos',
    device: baseDevice({ accuracySource: 'lbs' }),
    alert: { type: 'sos' },
    now,
  });
  assert.match(text, /Approximate location near Lower Vale/);
  assert.match(text, /cell tower positioning/);
});

test('stale heartbeat does not claim the watch is online', () => {
  const device = baseDevice({ online: true, lastHeartbeatAt: new Date('2026-08-12T09:40:00.000Z') });
  assert.equal(isOnline(device, now), false);
  const text = buildSafetyMessage({ type: 'sos', device, alert: { type: 'sos' }, now });
  assert.match(text, /Watch offline · Battery 63%/);
});

test('missing location is stated and no map link is fabricated', () => {
  const text = buildSafetyMessage({
    type: 'sos',
    device: baseDevice({ location: null, accuracySource: null }),
    alert: { type: 'sos' },
    now,
  });
  assert.match(text, /Location unavailable/);
  assert.match(text, /Location link unavailable/);
  assert.doesNotMatch(text, /maps\.google/);
});

test('unknown battery is omitted rather than invented', () => {
  const text = buildSafetyMessage({
    type: 'sos',
    device: baseDevice({ batteryPercent: null }),
    alert: { type: 'sos' },
    now,
  });
  assert.match(text, /Watch online/);
  assert.doesNotMatch(text, /Battery/);
});

test('fall alert uses the same rich context contract', () => {
  const text = buildSafetyMessage({ type: 'fall', device: baseDevice(), alert: { type: 'fall' }, now });
  assert.match(text, /GUARDIAN FALL ALERT — Jesh/);
  assert.match(text, /Open location:/);
});

test('legacy hardware suffix is removed from wearer name', () => {
  const ctx = buildSafetyContext({
    device: baseDevice({ nickname: null, relationship: null, name: "Mum's pendant" }),
    alert: { type: 'sos' },
    now,
  });
  assert.equal(ctx.wearerName, 'Mum');
});
