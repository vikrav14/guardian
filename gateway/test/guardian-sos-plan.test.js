const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSosTemplatePlan,
} = require('../src/guardian-sos-plan');

const now = new Date('2026-08-13T00:00:00.000Z');

function deviceWithLocation(recordedAt, overrides = {}) {
  return {
    nickname: 'Jesh',
    online: true,
    lastHeartbeatAt: new Date('2026-08-12T23:59:00.000Z'),
    batteryPercent: 63,
    accuracySource: 'gps',
    location: {
      lat: -20.1609,
      lng: 57.5012,
      placeLabel: 'Lower Vale',
      recordedAt,
    },
    ...overrides,
  };
}

function composeResult(overrides = {}) {
  return {
    narration:
      'Jesh triggered an SOS and may need your attention now. Please check on Jesh.',
    source: 'llm',
    context: null,
    ...overrides,
  };
}

test('fresh SOS uses guardian_sos_v1 and View location button payload', () => {
  const device = deviceWithLocation(
    new Date('2026-08-12T23:58:00.000Z')
  );

  const plan = buildSosTemplatePlan({
    device,
    alert: { type: 'sos', createdAt: now },
    composeResult: composeResult(),
    now,
  });

  assert.equal(plan.locationState, 'fresh');
  assert.equal(plan.templateName, 'guardian_sos_v1');
  assert.equal(plan.bodyParameters.length, 4);
  assert.match(plan.bodyParameters[2], /Lower Vale/);
  assert.match(plan.bodyParameters[2], /updated 2 mins ago/);
  assert.equal(plan.buttonUrlParameter, '-20.1609,57.5012');
  assert.equal(plan.components.length, 2);
  assert.equal(plan.components[1].type, 'button');
});

test('38-minute SOS uses last-known template and explicit age', () => {
  const device = deviceWithLocation(
    new Date('2026-08-12T23:22:00.000Z')
  );

  const plan = buildSosTemplatePlan({
    device,
    alert: { type: 'sos', createdAt: now },
    composeResult: composeResult(),
    now,
  });

  assert.equal(plan.locationState, 'last_known');
  assert.equal(plan.templateName, 'guardian_sos_last_known_v1');
  assert.match(plan.bodyParameters[2], /^Last known location:/);
  assert.match(plan.bodyParameters[2], /recorded 38 mins ago/);
  assert.equal(plan.buttonUrlParameter, '-20.1609,57.5012');
  assert.equal(plan.components[1].type, 'button');
});

test('valid coordinates with unknown age use last-known template', () => {
  const device = deviceWithLocation(null);

  const plan = buildSosTemplatePlan({
    device,
    alert: { type: 'sos', createdAt: now },
    composeResult: composeResult(),
    now,
  });

  assert.equal(plan.locationState, 'last_known');
  assert.match(plan.bodyParameters[2], /recorded time unavailable/);
});

test('no usable coordinates uses no-location template with no button', () => {
  const device = deviceWithLocation(null, {
    location: null,
  });

  const plan = buildSosTemplatePlan({
    device,
    alert: { type: 'sos', createdAt: now },
    composeResult: composeResult(),
    now,
  });

  assert.equal(plan.locationState, 'unavailable');
  assert.equal(plan.templateName, 'guardian_sos_no_location_v1');
  assert.equal(plan.bodyParameters[2], 'Current location unavailable');
  assert.equal(plan.buttonUrlParameter, null);
  assert.equal(plan.components.length, 1);
  assert.equal(plan.components[0].type, 'body');
});

test('last-known state rejects LLM wording that presents stale location as current', () => {
  const device = deviceWithLocation(
    new Date('2026-08-12T23:22:00.000Z')
  );

  const plan = buildSosTemplatePlan({
    device,
    alert: { type: 'sos', createdAt: now },
    composeResult: composeResult({
      narration: 'Jesh is at Lower Vale right now. Please check on Jesh.',
    }),
    now,
  });

  assert.equal(plan.narrationSource, 'fallback');
  assert.equal(
    plan.narrationOverrideReason,
    'stale_location_presented_as_current'
  );
  assert.equal(
    plan.bodyParameters[0],
    'Jesh triggered an SOS. Please check on Jesh now.'
  );
});

test('unavailable state rejects LLM location claims', () => {
  const device = deviceWithLocation(null, {
    location: null,
  });

  const plan = buildSosTemplatePlan({
    device,
    alert: { type: 'sos', createdAt: now },
    composeResult: composeResult({
      narration: 'Jesh is currently at Lower Vale. Please check on Jesh.',
    }),
    now,
  });

  assert.equal(plan.narrationSource, 'fallback');
  assert.equal(
    plan.narrationOverrideReason,
    'location_claim_without_coordinates'
  );
});

test('approximate fresh fix remains explicitly approximate', () => {
  const device = deviceWithLocation(
    new Date('2026-08-12T23:58:00.000Z'),
    { accuracySource: 'wifi' }
  );

  const plan = buildSosTemplatePlan({
    device,
    alert: { type: 'sos', createdAt: now },
    composeResult: composeResult(),
    now,
  });

  assert.equal(plan.locationState, 'fresh');
  assert.match(plan.bodyParameters[2], /Approximate location near Lower Vale/);
  assert.match(plan.bodyParameters[2], /WiFi positioning/);
});
