const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractProviderText,
  validateNarration,
  buildSafetyTemplateParameters,
  buildMapButtonParameter,
  composeSafetyNarration,
} = require('../src/guardian-message-composer');

const now = new Date('2026-08-12T10:00:00.000Z');

function device(overrides = {}) {
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

function fakeProvider(text, provider = 'gemini') {
  return {
    async complete() {
      return {
        content: [{ text }],
        usage: { input_tokens: 50, output_tokens: 20 },
        provider,
        latencyMs: 10,
      };
    },
  };
}

test('extractProviderText supports Gemini and Anthropic-style text blocks', () => {
  assert.equal(
    extractProviderText({ content: [{ text: 'Hello' }, { text: 'there' }] }),
    'Hello there'
  );
  assert.equal(
    extractProviderText({ content: [{ type: 'text', text: 'Hi' }] }),
    'Hi'
  );
});

test('valid human-friendly SOS narration is accepted', async () => {
  const result = await composeSafetyNarration({
    type: 'sos',
    device: device(),
    alert: { type: 'sos', createdAt: new Date('2026-08-12T09:57:00.000Z') },
    now,
    provider: fakeProvider('Jesh triggered an SOS and may need your attention now. Please check on Jesh.'),
  });

  assert.equal(result.source, 'llm');
  assert.equal(result.reason, null);
  assert.equal(result.validation.valid, true);
  assert.equal(result.templateParameters.length, 4);
  assert.equal(result.templateParameters[0], result.narration);
  assert.equal(result.templateParameters[1], '13:57');
  assert.match(result.templateParameters[2], /Lower Vale/);
  assert.match(result.templateParameters[3], /63%/);
  assert.equal(result.buttonUrlParameter, '-20.0085,57.5901');
});

test('invented battery causes deterministic fallback', async () => {
  const result = await composeSafetyNarration({
    type: 'sos',
    device: device(),
    alert: { type: 'sos' },
    now,
    provider: fakeProvider('Jesh triggered an SOS. The watch battery is 91%.'),
  });

  assert.equal(result.source, 'fallback');
  assert.equal(result.reason, 'validation_failed');
  assert.ok(result.validation.issues.includes('BATTERY_MISMATCH'));
  assert.match(result.narration, /Please check on Jesh now/);
});

test('approximate location cannot be called satellite or precise', async () => {
  const result = await composeSafetyNarration({
    type: 'sos',
    device: device({ accuracySource: 'wifi' }),
    alert: { type: 'sos' },
    now,
    provider: fakeProvider('Jesh triggered an SOS. Satellite GPS shows a precise location.'),
  });

  assert.equal(result.source, 'fallback');
  assert.ok(result.validation.issues.includes('POSITIONING_SOURCE_MISMATCH'));
  assert.match(result.templateParameters[2], /Approximate location near Lower Vale/);
});

test('LLM may not claim emergency services or contacts were dispatched', async () => {
  const result = await composeSafetyNarration({
    type: 'sos',
    device: device(),
    alert: { type: 'sos' },
    now,
    provider: fakeProvider('Jesh triggered an SOS. Emergency services were dispatched.'),
  });

  assert.equal(result.source, 'fallback');
  assert.ok(result.validation.issues.includes('UNSUPPORTED_DISPATCH_CLAIM'));
});

test('provider failure falls back without losing deterministic template facts', async () => {
  const provider = {
    async complete() {
      throw new Error('provider down');
    },
  };

  const result = await composeSafetyNarration({
    type: 'sos',
    device: device(),
    alert: { type: 'sos' },
    now,
    provider,
  });

  assert.equal(result.source, 'fallback');
  assert.equal(result.reason, 'provider_error');
  assert.equal(result.templateParameters.length, 4);
  assert.match(result.templateParameters[2], /Lower Vale/);
  assert.match(result.templateParameters[3], /Watch online/);
});

test('slow provider is bounded by timeout and falls back', async () => {
  const provider = {
    async complete() {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { content: [{ text: 'Late result' }], provider: 'gemini' };
    },
  };

  const result = await composeSafetyNarration({
    type: 'sos',
    device: device(),
    alert: { type: 'sos' },
    now,
    provider,
    timeoutMs: 5,
  });

  assert.equal(result.source, 'fallback');
  assert.equal(result.reason, 'timeout');
});

test('missing provider uses fallback with no map button when location is missing', async () => {
  const result = await composeSafetyNarration({
    type: 'fall',
    device: device({ batteryPercent: null, location: null, accuracySource: null }),
    alert: { type: 'fall' },
    now,
    provider: null,
  });

  assert.equal(result.source, 'fallback');
  assert.equal(result.templateParameters.length, 4);
  assert.equal(result.templateParameters[2], 'Location unavailable');
  assert.match(result.templateParameters[3], /battery unavailable/);
  assert.equal(result.buttonUrlParameter, null);
});

test('validator rejects coordinates and links in narration', () => {
  const ctx = {
    hasLocation: true,
    mapsUrl: 'https://maps.google.com/?q=-20.0,57.5',
    batteryPercent: 63,
    online: true,
    approximate: false,
    positioningLabel: 'Satellite GPS',
  };

  const validation = validateNarration(
    'Jesh is at -20.0085, 57.5901 https://maps.google.com',
    ctx
  );

  assert.equal(validation.valid, false);
  assert.ok(validation.issues.includes('RAW_LOCATION_DATA_IN_NARRATION'));
});

test('template parameters always preserve a fixed four-field body contract', () => {
  const ctx = {
    eventTime: null,
    hasLocation: false,
    placeLabel: null,
    approximate: false,
    positioningLabel: null,
    locationFreshness: null,
    online: false,
    batteryPercent: null,
    mapsUrl: null,
    wearerName: 'Mum',
  };

  const params = buildSafetyTemplateParameters(ctx, 'Please check on Mum now.');
  assert.deepEqual(params, [
    'Please check on Mum now.',
    'Time unavailable',
    'Location unavailable',
    'Watch offline · battery unavailable',
  ]);
});

test('map button parameter is only the dynamic URL suffix Meta expects', () => {
  assert.equal(
    buildMapButtonParameter({ mapsUrl: 'https://maps.google.com/?q=-20.0085,57.5901' }),
    '-20.0085,57.5901'
  );
  assert.equal(buildMapButtonParameter({ mapsUrl: null }), null);
});