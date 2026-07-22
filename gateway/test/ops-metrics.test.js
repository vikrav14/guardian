const test = require('node:test');
const assert = require('node:assert/strict');
const {
  increment,
  incrementAlert,
  incrementEvent,
  recordAssistantUsage,
  recordWriteGate,
  getSnapshot,
  resetForTests,
  checkAdminAuth,
  isAdminEmail,
  getMetricsResponse,
} = require('../src/ops-metrics');

test.beforeEach(() => {
  resetForTests();
  delete process.env.NODE_ENV;
  delete process.env.ADMIN_API_KEY;
});

test('increment and getSnapshot track counters', () => {
  increment('firestoreWrites', 3);
  incrementAlert('sos');
  incrementEvent('location');
  recordAssistantUsage({ input_tokens: 100, output_tokens: 50 });
  recordWriteGate({ persisted: 10, skipped: 90 });

  const snap = getSnapshot();
  assert.equal(snap.counters.firestoreWrites, 3);
  assert.equal(snap.counters.alertsCreated, 1);
  assert.equal(snap.alertTypes.sos, 1);
  assert.equal(snap.eventTypes.location, 1);
  assert.equal(snap.counters.assistantRequests, 1);
  assert.equal(snap.counters.assistantTokensIn, 100);
  assert.equal(snap.counters.writeGatePersisted, 10);
  assert.equal(snap.counters.writeGateSkipped, 90);
});

test('getMetricsResponse includes cost estimate', () => {
  increment('firestoreWrites', 1000);
  increment('firestoreReads', 5000);
  const resp = getMetricsResponse();
  assert.ok(resp.costEstimateTodayMur);
  assert.equal(resp.costEstimateTodayMur.currency, 'MUR');
  assert.ok(resp.costEstimateTodayMur.totalMur >= 0);
});

test('checkAdminAuth allows dev without key', () => {
  const result = checkAdminAuth({ headers: {} });
  assert.equal(result.ok, true);
});

test('checkAdminAuth blocks production without ADMIN_API_KEY', () => {
  process.env.NODE_ENV = 'production';
  const result = checkAdminAuth({ headers: {} });
  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
});

test('checkAdminAuth requires key when configured', () => {
  process.env.ADMIN_API_KEY = 'secret-key';
  const bad = checkAdminAuth({ headers: {} });
  assert.equal(bad.ok, false);
  assert.equal(bad.status, 401);

  const good = checkAdminAuth({ headers: { 'x-admin-key': 'secret-key' } });
  assert.equal(good.ok, true);
});

test('isAdminEmail matches configured allowlist', () => {
  assert.equal(isAdminEmail('vikrav14@gmail.com'), true);
  assert.equal(isAdminEmail('other@example.com'), false);
});
