const test = require('node:test');
const assert = require('node:assert/strict');
const {
  increment,
  incrementAlert,
  incrementEvent,
  recordAssistantUsage,
  recordWriteGate,
  setFleetAggregates,
  getSnapshot,
  resetForTests,
  checkAdminAuth,
  isAdminEmail,
  getMetricsResponse,
  getGrowthResponse,
  getAiStatsResponse,
  estimateCostSensitivity,
} = require('../src/ops-metrics');
const { resetForTests: resetAiTelemetry } = require('../src/ai-telemetry');
const config = require('../src/config');

const originalAdminApiKey = config.adminApiKey;
const originalAdminEmails = [...config.adminEmails];

test.beforeEach(() => {
  resetForTests();
  resetAiTelemetry();
  delete process.env.NODE_ENV;
  delete process.env.ADMIN_API_KEY;
  // config is loaded once and may already contain the real .env key. Auth
  // tests must control their own configuration instead of depending on the
  // developer machine that runs them.
  config.adminApiKey = '';
  config.adminEmails = [];
});

test.after(() => {
  config.adminApiKey = originalAdminApiKey;
  config.adminEmails = originalAdminEmails;
});

test('increment and getSnapshot track counters', () => {
  increment('firestoreWrites', 3);
  incrementAlert('sos');
  incrementEvent('location');
  recordAssistantUsage({ input_tokens: 100, output_tokens: 50 });
  recordWriteGate({ persisted: 10, skipped: 90 });
  setFleetAggregates({ totalDevices: 12, devicesOnline: 8, avgBatteryPercent: 72, gpsQualityPct: 85 });

  const snap = getSnapshot();
  assert.equal(snap.counters.firestoreWrites, 3);
  assert.equal(snap.counters.alertsCreated, 1);
  assert.equal(snap.alertTypes.sos, 1);
  assert.equal(snap.eventTypes.location, 1);
  assert.equal(snap.counters.assistantRequests, 1);
  assert.equal(snap.counters.aiRequests, 1);
  assert.equal(snap.counters.assistantTokensIn, 100);
  assert.equal(snap.counters.writeGatePersisted, 10);
  assert.equal(snap.counters.devicesTotal, 12);
  assert.equal(snap.counters.devicesOnline, 8);
});

test('getMetricsResponse includes cost estimate and api monitoring', () => {
  increment('firestoreWrites', 1000);
  increment('firestoreReads', 5000);
  const resp = getMetricsResponse();
  assert.ok(resp.costEstimateTodayMur);
  assert.equal(resp.costEstimateTodayMur.currency, 'MUR');
  assert.ok(resp.costEstimateTodayMur.totalMur >= 0);
  assert.ok(Array.isArray(resp.apiMonitoring));
});

test('getGrowthResponse delegates to projectBusiness', () => {
  const resp = getGrowthResponse({ users: 100, deviceSaleMur: 2500, subscriptionMur: 1500 });
  assert.equal(resp.users, 100);
  assert.ok(resp.revenue.totalMur > 0);
});

test('getAiStatsResponse includes recommendations', () => {
  recordAssistantUsage({ input_tokens: 500, output_tokens: 200 });
  const resp = getAiStatsResponse();
  assert.ok(resp.aiRequests >= 1);
  assert.ok(Array.isArray(resp.recommendations));
});

test('estimateCostSensitivity available from ops-metrics', () => {
  const resp = estimateCostSensitivity({ users: 50 });
  assert.ok(resp.baseline);
  assert.ok(resp.scenarios.length > 0);
});

test('checkAdminAuth allows dev without key', async () => {
  const result = await checkAdminAuth({ headers: {} });
  assert.equal(result.ok, true);
});

test('checkAdminAuth blocks production without ADMIN_API_KEY', async () => {
  process.env.NODE_ENV = 'production';
  const result = await checkAdminAuth({ headers: {} });
  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
});

test('checkAdminAuth requires key when configured', async () => {
  process.env.ADMIN_API_KEY = 'secret-key';
  const bad = await checkAdminAuth({ headers: {} });
  assert.equal(bad.ok, false);
  assert.equal(bad.status, 401);

  const good = await checkAdminAuth({ headers: { 'x-admin-key': 'secret-key' } });
  assert.equal(good.ok, true);
});

test('isAdminEmail matches configured allowlist', () => {
  config.adminEmails = ['admin@example.com'];
  assert.equal(isAdminEmail('ADMIN@example.com'), true);
  assert.equal(isAdminEmail('someone@example.com'), false);
});
