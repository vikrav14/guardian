const test = require('node:test');
const assert = require('node:assert/strict');

const ContextAI = require('../src/context/contextAI');
const ContextService = require('../src/context/contextService');
const WeatherProvider = require('../src/context/weatherProvider');
const { adaptDeviceContext } = require('../src/context/deviceContextAdapter');
const {
  runContextSweep,
  startContextScheduler,
  stopContextSchedulerForTests,
} = require('../src/context/contextScheduler');
const metrics = require('../src/ops-metrics/collector');
const config = require('../src/config');
const { requireStrictAdmin } = require('../src/http');

function severeWeather() {
  return {
    temperature: 28,
    condition: 'Thunderstorm',
    description: 'thunderstorm with rain',
    alerts: [{
      type: 'severe_weather',
      message: 'Thunderstorm warning',
      urgency: 'high',
    }],
    severity: 'severe',
    fetchedAt: Date.now(),
    source: 'openweathermap',
    confidence: 0.95,
  };
}

function adaptedInputs() {
  return {
    device: {
      online: true,
      lastSeenAt: new Date().toISOString(),
      lastSeenMinutesAgo: 3,
      batteryPercent: 80,
    },
    person: { displayName: 'Dexter', age: 8, careContext: 'child' },
    location: {
      lat: -20.16,
      lng: 57.5,
      placeName: 'Grand Baie',
      freshnessMinutes: 3,
      accuracyClass: 'precise',
    },
  };
}

test('adapter uses the provenance-aware P0 location shape', () => {
  const now = new Date('2026-08-18T10:00:00.000Z');
  const adapted = adaptDeviceContext({
    online: true,
    nickname: 'Mum',
    batteryPercent: 64,
    lastHeartbeatAt: new Date('2026-08-18T09:58:00.000Z'),
    location: {
      lat: -20.1609,
      lng: 57.5012,
      source: 'gps',
      placeLabel: 'Grand Baie',
      recordedAt: new Date('2026-08-18T09:57:00.000Z'),
    },
  }, { now });

  assert.equal(adapted.location.lat, -20.1609);
  assert.equal(adapted.location.lng, 57.5012);
  assert.equal(adapted.location.freshnessMinutes, 3);
  assert.equal(adapted.location.accuracyClass, 'precise');
  assert.equal(adapted.person.displayName, 'Mum');
});

test('adapter does not revive the obsolete lastLocation.coordinates shape', () => {
  const adapted = adaptDeviceContext({
    lastLocation: { coordinates: [57.5, -20.16] },
  });
  assert.equal(adapted, null);
});

test('ContextAI accepts a guarded structured relevance decision', async () => {
  const provider = {
    complete: async () => ({
      provider: 'anthropic',
      stopReason: 'end_turn',
      usage: { input_tokens: 210, output_tokens: 45 },
      content: [{
        type: 'text',
        text: JSON.stringify({
          relevant: true,
          confidence: 0.91,
          recommendedSurface: 'whatsapp_template',
          recommendedAction: 'check_in',
          reason: 'Timely severe weather near a child.',
          explanation: 'Thunderstorm near Dexter’s area. Check in with him.',
        }),
      }],
    }),
  };
  const ai = new ContextAI(provider, { contextLlmJudgmentEnabled: true });
  const input = adaptedInputs();
  const result = await ai.assessContext(
    severeWeather(),
    input.person,
    input.device,
    input.location,
    { relevant: true, severity: 'check_in', reasons: ['Severe weather'], uncertainty: [] }
  );

  assert.equal(result.valid, true);
  assert.equal(result.decision.recommendedSurface, 'whatsapp_template');
  assert.equal(result.decision.recommendedAction, 'check_in');
  assert.equal(result.usage.input_tokens, 210);
});

test('ContextAI rejects invalid output instead of passing it through', async () => {
  const provider = {
    complete: async () => ({
      provider: 'anthropic',
      usage: { input_tokens: 100, output_tokens: 20 },
      content: [{ type: 'text', text: 'Send this now!!!' }],
    }),
  };
  const ai = new ContextAI(provider, { contextLlmJudgmentEnabled: true });
  const input = adaptedInputs();
  const result = await ai.assessContext(
    severeWeather(),
    input.person,
    input.device,
    input.location,
    { relevant: true, severity: 'check_in', reasons: [], uncertainty: [] }
  );

  assert.equal(result.valid, false);
  assert.equal(result.reason, 'invalid_structured_output');
});

test('shared ContextService keeps weather cached for the configured hour', async () => {
  let fetchCount = 0;
  const weatherProvider = new WeatherProvider('test-key', 60);
  weatherProvider._fetchFromOpenWeatherMap = async (lat, lng) => {
    fetchCount += 1;
    return {
      coord: { lat, lon: lng },
      weather: [{ id: 800, main: 'Clear', description: 'clear sky' }],
      main: { temp: 25, feels_like: 25, humidity: 60 },
      wind: { speed: 2 },
      clouds: { all: 5 },
      sys: {},
    };
  };
  const service = new ContextService('test-key', null, {
    contextWeatherCacheMinutes: 60,
    contextLlmJudgmentEnabled: false,
  }, { weatherProvider });
  const input = adaptedInputs();

  await service.getDeviceContext(input.device, input.person, input.location);
  await service.getDeviceContext(input.device, input.person, {
    ...input.location,
    lat: -20.1601,
    lng: 57.5001,
  });

  assert.equal(fetchCount, 1);
  assert.equal(service.getStats().weatherCacheMinutes, 60);
});

test('WeatherProvider coalesces concurrent fetches for the same cache cell', async () => {
  let fetchCount = 0;
  const provider = new WeatherProvider('test-key', 60);
  provider._fetchFromOpenWeatherMap = async (lat, lng) => {
    fetchCount += 1;
    await new Promise((resolve) => setImmediate(resolve));
    return {
      coord: { lat, lon: lng },
      weather: [{ id: 800, main: 'Clear', description: 'clear sky' }],
      main: { temp: 25, feels_like: 25, humidity: 60 },
      wind: { speed: 2 },
      clouds: { all: 5 },
      sys: {},
    };
  };

  await Promise.all([
    provider.getWeather(-20.1601, 57.5001, 'Grand Baie'),
    provider.getWeather(-20.1602, 57.5002, 'Grand Baie'),
    provider.getWeather(-20.1603, 57.5003, 'Grand Baie'),
  ]);

  assert.equal(fetchCount, 1);
  assert.equal(provider.getCacheStats().inflight, 0);
});

test('generic rain is not mislabeled as a heavy-rain candidate', () => {
  const provider = new WeatherProvider('test-key', 60);
  const weather = provider._normalizeWeather({
    coord: { lat: -20.16, lon: 57.5 },
    weather: [{ id: 500, main: 'Rain', description: 'light rain' }],
    main: { temp: 24, feels_like: 24, humidity: 88 },
    rain: { '1h': 1.2 },
    wind: { speed: 3 },
    clouds: { all: 90 },
    sys: {},
  }, 'Grand Baie');

  assert.equal(weather.severity, 'normal');
  assert.equal(weather.alerts.some((alert) => alert.type === 'heavy_rain'), false);
});

test('ContextService records LLM cost and keeps all delivery observe-only', async () => {
  metrics.resetForTests();
  const ai = {
    assessContext: async () => ({
      attempted: true,
      valid: true,
      provider: 'anthropic',
      durationMs: 12,
      usage: { input_tokens: 120, output_tokens: 30 },
      decision: {
        relevant: false,
        confidence: 0.7,
        recommendedSurface: 'suppress',
        recommendedAction: 'none',
        reason: 'Location is too stale for a useful check-in.',
        explanation: null,
      },
    }),
  };
  const service = new ContextService('test-key', null, {
    contextLlmJudgmentEnabled: true,
  }, {
    ai,
    weatherProvider: { getWeather: async () => severeWeather(), getCacheStats: () => ({ entries: 1, maxDurationMinutes: 60 }) },
  });
  const input = adaptedInputs();
  const context = await service.getDeviceContext(
    input.device,
    input.person,
    input.location,
    { imei: '861397053141170', source: 'test' }
  );
  const snapshot = metrics.getSnapshot().counters;

  assert.equal(context.deterministicEvaluation.relevant, true);
  assert.equal(context.contextEvaluation.relevant, false);
  assert.equal(context.delivery.sent, false);
  assert.equal(context.contextDecision.recommendedSurface, 'suppress');
  assert.equal(context.contextDecision.recommendedAction, 'none');
  assert.equal(service.getObservationLog().length, 1);
  assert.equal(snapshot.contextLlmCalls, 1);
  assert.equal(snapshot.contextLlmTokensIn, 120);
  assert.equal(snapshot.contextLlmTokensOut, 30);
});

test('hourly sweep evaluates only devices with a trustworthy location', async () => {
  const docs = [
    {
      id: 'device-1',
      data: () => ({
        online: true,
        location: {
          lat: -20.16,
          lng: 57.5,
          source: 'gps',
          recordedAt: new Date('2026-08-18T09:58:00.000Z'),
        },
      }),
    },
    {
      id: 'device-2',
      data: () => ({ lastLocation: { coordinates: [57.5, -20.16] } }),
    },
  ];
  const db = {
    collection: () => ({
      limit: () => ({ get: async () => ({ docs }) }),
    }),
  };
  let calls = 0;
  const contextService = {
    getDeviceContext: async () => {
      calls += 1;
      return {
        deterministicEvaluation: { relevant: false },
        contextEvaluation: { relevant: false },
      };
    },
  };
  const result = await runContextSweep({
    db,
    contextService,
    config: { contextMaxDevicesPerSweep: 1000, contextConcurrency: 2 },
    now: new Date('2026-08-18T10:00:00.000Z'),
  });

  assert.equal(result.devicesRead, 2);
  assert.equal(result.devicesEvaluated, 1);
  assert.equal(result.devicesSkipped, 1);
  assert.equal(calls, 1);
});

test('scheduler enforces an hourly minimum interval', () => {
  stopContextSchedulerForTests();
  const db = { collection: () => ({ limit: () => ({ get: async () => ({ docs: [] }) }) }) };
  const scheduler = startContextScheduler({
    db,
    contextService: {},
    config: {
      contextIntelligenceEnabled: true,
      openWeatherMapKey: 'test-key',
      contextPollMinutes: 5,
      contextRunOnStartup: false,
    },
  });

  assert.equal(scheduler.active, true);
  assert.equal(scheduler.intervalMinutes, 60);
  scheduler.stop();
});

test('device context endpoint never permits dev-open admin access', async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousAdminKey = process.env.ADMIN_API_KEY;
  const previousConfigAdminKey = config.adminApiKey;
  delete process.env.ADMIN_API_KEY;
  process.env.NODE_ENV = 'test';
  config.adminApiKey = '';

  const response = { status: null, body: null };
  const res = {
    writeHead(status) { response.status = status; },
    end(body) { response.body = JSON.parse(body); },
  };

  try {
    const allowed = await requireStrictAdmin({ headers: {} }, res);
    assert.equal(allowed, false);
    assert.equal(response.status, 503);
    assert.match(response.body.error, /configure ADMIN_API_KEY/i);
  } finally {
    config.adminApiKey = previousConfigAdminKey;
    if (previousAdminKey == null) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = previousAdminKey;
    if (previousNodeEnv == null) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});

test('ContextAI requires the explanation to match the structured action enum', () => {
  const ai = new ContextAI(null, {});
  const validation = ai._validateDecision({
    relevant: true,
    confidence: 0.9,
    recommendedSurface: 'app',
    recommendedAction: 'check_in',
    reason: 'Synthetic severe weather is timely.',
    explanation: 'Synthetic severe weather is nearby. Monitor battery.',
  });

  assert.equal(validation.valid, false);
  assert(validation.issues.some((issue) => issue.includes('action phrase: check in')));
});
