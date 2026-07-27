const test = require('node:test');
const assert = require('node:assert/strict');
const { recordAiDecision, getAiStats, resetForTests } = require('../src/ai-telemetry');
const { resetForTests: resetMetrics } = require('../src/ops-metrics/collector');

test.beforeEach(() => {
  resetForTests();
  resetMetrics();
});

test('recordAiDecision tracks latency and tokens', () => {
  recordAiDecision({
    toolsUsed: ['get_location'],
    tokensIn: 1200,
    tokensOut: 300,
    latencyMs: 850,
    callerPhone: '+23050000000',
  });

  const stats = getAiStats();
  assert.equal(stats.aiRequests, 1);
  assert.equal(stats.aiTokensIn, 1200);
  assert.equal(stats.aiTokensOut, 300);
  assert.equal(stats.avgLatencyMs, 850);
  assert.equal(stats.recentDecisions.length, 1);
  assert.equal(stats.recentDecisions[0].toolsUsed[0], 'get_location');
});

test('getAiStats caps recent decisions list', () => {
  for (let i = 0; i < 55; i += 1) {
    recordAiDecision({ latencyMs: 100 + i });
  }
  const stats = getAiStats();
  assert.equal(stats.recentDecisions.length, 10);
});
