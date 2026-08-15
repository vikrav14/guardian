'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildFallLocationSnapshot } = require('../src/fall-location-snapshot');
const {
  FALL_TEMPLATE_LANGUAGE,
  prepareFallWhatsApp,
  sendPreparedFallWhatsApp,
} = require('../src/fall-whatsapp');

const now = new Date('2026-08-15T10:00:00.000Z');

function device(recordedAt, overrides = {}) {
  return {
    nickname: 'Jesh',
    online: true,
    lastHeartbeatAt: new Date('2026-08-15T09:59:00.000Z'),
    batteryPercent: 87,
    accuracySource: 'gps',
    location: {
      lat: -20.029192,
      lng: 57.5959408,
      placeLabel: 'Lower Vale',
      source: 'gps',
      gpsValid: true,
      accuracyMeters: null,
      recordedAt,
    },
    ...overrides,
  };
}

function fallAlert(snapshot) {
  return {
    type: 'fall',
    eventAt: now,
    payload: { locationSnapshot: snapshot },
  };
}

test('fall templates use the approved English language code', () => {
  assert.equal(FALL_TEMPLATE_LANGUAGE, 'en');
});

test('fresh fall prepares a four-fact template and View location button', async () => {
  const atFall = device(new Date('2026-08-15T09:58:00.000Z'));
  const prepared = await prepareFallWhatsApp({
    device: atFall,
    alert: fallAlert(buildFallLocationSnapshot(atFall, { now })),
    now,
  });

  assert.equal(prepared.plan.templateName, 'guardian_fall_alert_v1');
  assert.equal(prepared.plan.locationState, 'fresh');
  assert.equal(prepared.plan.bodyParameters.length, 4);
  assert.match(prepared.plan.bodyParameters[0], /fall alert was received for Jesh/i);
  assert.match(prepared.plan.bodyParameters[2], /Lower Vale/);
  assert.match(prepared.plan.bodyParameters[2], /2 mins before fall/);
  assert.equal(prepared.plan.buttonUrlParameter, '-20.029192,57.5959408');
  assert.equal(prepared.plan.components.length, 2);
});

test('last-known fall prepares the honest last-location template and button', async () => {
  const atFall = device(new Date('2026-08-15T09:22:00.000Z'));
  const prepared = await prepareFallWhatsApp({
    device: atFall,
    alert: fallAlert(buildFallLocationSnapshot(atFall, { now })),
    now,
  });

  assert.equal(prepared.plan.templateName, 'guardian_fall_last_location_v1');
  assert.equal(prepared.plan.locationState, 'last_known');
  assert.match(prepared.plan.bodyParameters[2], /Last known location/);
  assert.match(prepared.plan.bodyParameters[2], /38 mins before fall/);
  assert.equal(prepared.plan.buttonUrlParameter, '-20.029192,57.5959408');
});

test('delayed delivery keeps fall-relative age while watch status can be current', async () => {
  const atFall = device(new Date('2026-08-15T09:58:00.000Z'));
  const alert = fallAlert(buildFallLocationSnapshot(atFall, { now }));
  const retryAt = new Date('2026-08-15T11:00:00.000Z');
  const currentDevice = {
    ...atFall,
    online: true,
    lastHeartbeatAt: new Date('2026-08-15T10:59:00.000Z'),
    batteryPercent: 81,
  };
  const prepared = await prepareFallWhatsApp({
    device: currentDevice,
    alert,
    now: retryAt,
  });

  assert.equal(prepared.plan.templateName, 'guardian_fall_alert_v1');
  assert.match(prepared.plan.bodyParameters[2], /2 mins before fall/);
  assert.doesNotMatch(prepared.plan.bodyParameters[2], /1 hr/);
  assert.match(prepared.plan.bodyParameters[3], /Watch online · battery 81%/);
});

test('unavailable fall uses no-location template with no map button', async () => {
  const atFall = device(null, { location: null, accuracySource: null });
  const prepared = await prepareFallWhatsApp({
    device: atFall,
    alert: fallAlert(buildFallLocationSnapshot(atFall, { now })),
    now,
  });

  assert.equal(prepared.plan.templateName, 'guardian_fall_unavailable_v1');
  assert.equal(prepared.plan.locationState, 'unavailable');
  assert.match(prepared.plan.bodyParameters[2], /unavailable/i);
  assert.equal(prepared.plan.buttonUrlParameter, null);
  assert.equal(prepared.plan.components.length, 1);
});

test('fall plan keeps event location after the device moves later', async () => {
  const atFall = device(new Date('2026-08-15T09:58:00.000Z'));
  const alert = fallAlert(buildFallLocationSnapshot(atFall, { now }));
  const laterDevice = device(new Date('2026-08-15T10:08:00.000Z'), {
    location: {
      ...atFall.location,
      lat: -20.1609,
      lng: 57.5012,
      placeLabel: 'Port Louis',
      recordedAt: new Date('2026-08-15T10:08:00.000Z'),
    },
  });
  const prepared = await prepareFallWhatsApp({ device: laterDevice, alert, now });

  assert.match(prepared.plan.bodyParameters[2], /Lower Vale/);
  assert.doesNotMatch(prepared.plan.bodyParameters[2], /Port Louis/);
  assert.equal(prepared.plan.buttonUrlParameter, '-20.029192,57.5959408');
});

test('legacy fall without an event snapshot fails closed to unavailable', async () => {
  const currentDevice = device(new Date('2026-08-15T09:59:00.000Z'));
  const prepared = await prepareFallWhatsApp({
    device: currentDevice,
    alert: { type: 'fall', eventAt: now, payload: {} },
    now,
  });

  assert.equal(prepared.plan.templateName, 'guardian_fall_unavailable_v1');
  assert.equal(prepared.plan.buttonUrlParameter, null);
});

test('prepared fall sends only through Meta and preserves plan evidence', async () => {
  const atFall = device(new Date('2026-08-15T09:58:00.000Z'));
  const prepared = await prepareFallWhatsApp({
    device: atFall,
    alert: fallAlert(buildFallLocationSnapshot(atFall, { now })),
    now,
  });
  const calls = [];
  const result = await sendPreparedFallWhatsApp('+23058590100', prepared, {
    sendTemplate: async (to, templateName, options) => {
      calls.push({ to, templateName, options });
      return { ok: true, provider: 'meta', messageId: 'wamid.fall-test' };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].templateName, 'guardian_fall_alert_v1');
  assert.equal(calls[0].options.languageCode, 'en');
  assert.equal(result.transport, 'meta');
  assert.equal(result.fallbackUsed, false);
  assert.equal(result.locationState, 'fresh');
});
