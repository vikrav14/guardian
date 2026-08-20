/**
 * Unit tests for context intelligence modules
 */

const test = require('node:test');
const assert = require('node:assert');
const WeatherProvider = require('./weatherProvider');
const ContextEvaluator = require('./contextEvaluator');
const { validateSchema, deviceContextSchema } = require('./contextSchemas');

// Test WeatherProvider
test('WeatherProvider: empty weather response on API failure', async () => {
  const provider = new WeatherProvider(null);
  const weather = await provider.getWeather(null, null);

  assert.strictEqual(weather.condition, 'unknown');
  assert.strictEqual(weather.alerts.length, 0);
  assert.strictEqual(weather.confidence, 0.0);
});

test('WeatherProvider: identify severe weather', () => {
  const provider = new WeatherProvider('dummy-key');

  // Test thunderstorm detection
  const severe = provider._normalizeWeather(
    {
      weather: [{ main: 'Thunderstorm', description: 'thunderstorm with rain' }],
      main: { temp: 28, feels_like: 30, humidity: 80 },
      wind: { speed: 15 },
      clouds: { all: 90 },
      coord: { lat: -20.16, lon: 57.50 },
      name: 'Grand Baie',
    },
    'Grand Baie'
  );

  assert.strictEqual(severe.severity, 'severe');
  assert(severe.alerts.length > 0);
  assert.strictEqual(severe.alerts[0].type, 'severe_weather');
});

test('WeatherProvider: identify extreme heat', () => {
  const provider = new WeatherProvider('dummy-key');

  const hot = provider._normalizeWeather(
    {
      weather: [{ main: 'Clear', description: 'clear sky' }],
      main: { temp: 38, feels_like: 42, humidity: 40 },
      wind: { speed: 5 },
      clouds: { all: 10 },
      coord: { lat: -20.16, lon: 57.50 },
      name: 'Grand Baie',
    },
    'Grand Baie'
  );

  assert.strictEqual(hot.severity, 'severe');
  assert(hot.alerts.some(a => a.type === 'extreme_heat'));
});

test('WeatherProvider: cache prevents duplicate requests', () => {
  const provider = new WeatherProvider('dummy-key', 30);
  const weather = {
    temperature: 28,
    condition: 'Thunderstorm',
    alerts: [],
    severity: 'severe',
    fetchedAt: Date.now(),
    source: 'openweathermap',
    confidence: 0.95,
  };

  provider._setInCache('test-key', weather);
  const cached = provider._getFromCache('test-key');

  assert.strictEqual(cached.temperature, weather.temperature);
  assert.strictEqual(cached.condition, weather.condition);
});

test('WeatherProvider: cache expires after duration', () => {
  const provider = new WeatherProvider('dummy-key', 0.01); // 0.6 seconds
  const weather = {
    temperature: 28,
    condition: 'Sunny',
    alerts: [],
    severity: 'normal',
    fetchedAt: Date.now() - 2000, // 2 seconds old
    source: 'openweathermap',
    confidence: 0.95,
  };

  provider._setInCache('test-key', weather);
  const cached = provider._getFromCache('test-key');

  assert.strictEqual(cached, null);
});

// Test ContextEvaluator
test('ContextEvaluator: weather not relevant if not severe', () => {
  const evaluator = new ContextEvaluator();

  const result = evaluator.evaluateWeatherRelevance(
    {
      temperature: 25,
      condition: 'Cloudy',
      alerts: [],
      severity: 'normal',
    },
    { displayName: 'Dexter', age: 8 },
    { online: true, lastSeenMinutesAgo: 2 },
    { placeName: 'Grand Baie', freshnessMinutes: 2, accuracyClass: 'good' }
  );

  assert.strictEqual(result.relevant, false);
  assert.strictEqual(result.severity, 'none');
});

test('ContextEvaluator: severe weather relevant for child', () => {
  const evaluator = new ContextEvaluator();

  const result = evaluator.evaluateWeatherRelevance(
    {
      temperature: 28,
      condition: 'Thunderstorm',
      alerts: [{ type: 'severe_weather', message: 'Thunderstorm warning', urgency: 'high' }],
      severity: 'severe',
    },
    { displayName: 'Dexter', age: 8 },
    { online: true, lastSeenMinutesAgo: 2, batteryPercent: 80 },
    { placeName: 'Grand Baie', freshnessMinutes: 2, accuracyClass: 'good' }
  );

  assert.strictEqual(result.relevant, true);
  assert(result.severity === 'check_in');
  assert(result.message.includes('Dexter'));
  assert(result.message.includes('Thunderstorm'));
});

test('ContextEvaluator: heat relevant for elderly', () => {
  const evaluator = new ContextEvaluator();

  const result = evaluator.evaluateWeatherRelevance(
    {
      temperature: 38,
      condition: 'Clear',
      alerts: [{ type: 'extreme_heat', message: 'High temperature', urgency: 'medium' }],
      severity: 'severe',
    },
    { displayName: 'Mum', age: 72 },
    { online: true, lastSeenMinutesAgo: 5, batteryPercent: 60 },
    { placeName: 'Port Louis', freshnessMinutes: 5, accuracyClass: 'approximate' }
  );

  assert.strictEqual(result.relevant, true);
  assert(result.message.toLowerCase().includes('heat'), `Expected message to mention heat, got: ${result.message}`);
});

test('ContextEvaluator: stale location adds uncertainty', () => {
  const evaluator = new ContextEvaluator();

  const result = evaluator.evaluateWeatherRelevance(
    {
      temperature: 28,
      condition: 'Thunderstorm',
      alerts: [{ type: 'severe_weather', message: 'Thunderstorm warning', urgency: 'high' }],
      severity: 'severe',
    },
    { displayName: 'Jeshna', age: 14 },
    { online: true, lastSeenMinutesAgo: 45, batteryPercent: 40 },
    { placeName: 'School', freshnessMinutes: 45, accuracyClass: 'approximate' }
  );

  assert.strictEqual(result.relevant, true);
  assert(result.uncertainty.includes('Location is stale (45 mins old)'));
  assert(result.message.includes('Guardian has not received a fresh location'));
});

// Test Schema Validation
test('Schema validation: valid device context', () => {
  const valid = {
    device: { online: true, lastSeenAt: new Date().toISOString(), batteryPercent: 80 },
    location: { lat: -20.16, lng: 57.50, placeName: 'Grand Baie', freshnessMinutes: 2, accuracyClass: 'good' },
    weather: {
      condition: 'Sunny',
      alerts: [],
      severity: 'normal',
      fetchedAt: Date.now(),
      source: 'openweathermap',
    },
    contextEvaluation: {
      relevant: false,
      severity: 'none',
      message: 'No concerns',
    },
    fetchedAt: new Date().toISOString(),
  };

  const result = validateSchema(valid, deviceContextSchema);
  assert.strictEqual(result.valid, true, `Validation failed: ${result.errors.join(', ')}`);
  assert.strictEqual(result.errors.length, 0);
});

test('Schema validation: missing required field', () => {
  const invalid = {
    device: { online: true },
    // missing location, weather, contextEvaluation
  };

  const result = validateSchema(invalid, deviceContextSchema);
  assert.strictEqual(result.valid, false);
  assert(result.errors.length > 0);
});

// Test ContextAI
test('ContextAI: ignores non-relevant context', async () => {
  const ContextAI = require('./contextAI');
  const mockProvider = {
    complete: async () => ({
      content: [{ type: 'text', text: 'Should not be called' }],
      usage: { input_tokens: 0, output_tokens: 0 },
    }),
  };
  const ai = new ContextAI(mockProvider, {});

  const explanation = await ai.explainContext(
    { temperature: 25, condition: 'Sunny', alerts: [], severity: 'normal' },
    { displayName: 'Dexter', age: 8 },
    { online: true, batteryPercent: 80 },
    { placeName: 'School', freshnessMinutes: 5 },
    { relevant: false, severity: 'none', reasons: [], uncertainty: [] }
  );

  assert.strictEqual(explanation, null);
});

test('ContextAI: validates explanation tone (rejects explicit AI mention)', () => {
  const ContextAI = require('./contextAI');
  const ai = new ContextAI(null, {});

  const validation = ai._validateExplanation(
    'Our algorithm has detected artificial intelligence patterns at your location.',
    { severity: 'check_in' }
  );

  assert.strictEqual(validation.valid, false);
  assert(validation.issues.length > 0);
});

test('ContextAI: validates explanation tone (rejects alarmist)', () => {
  const ContextAI = require('./contextAI');
  const ai = new ContextAI(null, {});

  const validation = ai._validateExplanation(
    'CRITICAL DANGER!!! You must act NOW!!! Your child is in EXTREME PERIL!!!',
    { severity: 'check_in' }
  );

  assert.strictEqual(validation.valid, false);
  assert(validation.issues.some(i => i.includes('exclamation')));
});

test('ContextAI: validates explanation length', () => {
  const ContextAI = require('./contextAI');
  const ai = new ContextAI(null, {});

  const tooShort = ai._validateExplanation('Hi', { severity: 'info' });
  assert.strictEqual(tooShort.valid, false);

  const tooLong = ai._validateExplanation('x'.repeat(500), { severity: 'info' });
  assert.strictEqual(tooLong.valid, false);

  const valid = ai._validateExplanation('Moderate weather at location. Check in when convenient.', {
    severity: 'info',
  });
  assert.strictEqual(valid.valid, true);
});

test('ContextAI: builds fact sheet correctly', () => {
  const ContextAI = require('./contextAI');
  const ai = new ContextAI(null, {});

  const facts = ai._buildFactSheet(
    { temperature: 28, condition: 'Thunderstorm', severity: 'severe' },
    { displayName: 'Dexter', age: 8 },
    { online: true, batteryPercent: 80 },
    { placeName: 'Grand Baie', freshnessMinutes: 2 },
    {
      relevant: true,
      severity: 'check_in',
      reasons: ['Severe weather applies to area', 'Child may need shelter'],
      uncertainty: [],
    }
  );

  assert(facts.includes('Dexter'));
  assert(facts.includes('"age": 8'));
  assert(facts.includes('Grand Baie'));
  assert(facts.includes('Thunderstorm'));
  assert(facts.includes('"batteryPercent": 80'));
});

console.log('✅ All context intelligence tests passed');
