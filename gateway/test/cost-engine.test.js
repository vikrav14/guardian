const test = require('node:test');
const assert = require('node:assert/strict');
const {
  estimateMonthlyCost,
  estimateDailyCost,
  getPricing,
} = require('../src/cost-engine');

test('estimateMonthlyCost returns MUR breakdown for fleet size', () => {
  const result = estimateMonthlyCost({
    users: 100,
    gpsIntervalSec: 60,
    historyOn: false,
    journeyCompression: true,
    whatsappPct: 20,
    aiNarrationOn: true,
  });

  assert.equal(result.currency, 'MUR');
  assert.equal(result.users, 100);
  assert.ok(result.totalMur > 0);
  assert.ok(result.breakdown.firestore >= 0);
  assert.ok(result.breakdown.hosting > 0);
  const breakdownSum = Object.values(result.breakdown).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(result.totalMur - breakdownSum) < 0.02);
});

test('estimateMonthlyCost scales with user count', () => {
  const small = estimateMonthlyCost({ users: 10 });
  const large = estimateMonthlyCost({ users: 1000 });
  assert.ok(large.totalMur > small.totalMur);
  assert.ok(large.volumes.firestoreReads > small.volumes.firestoreReads);
});

test('historyOn increases projected firestore writes', () => {
  const compressed = estimateMonthlyCost({ users: 50, historyOn: false, journeyCompression: true });
  const rawHistory = estimateMonthlyCost({ users: 50, historyOn: true });
  assert.ok(rawHistory.volumes.firestoreWrites > compressed.volumes.firestoreWrites);
});

test('aiNarrationOff removes Claude cost', () => {
  const withAi = estimateMonthlyCost({ users: 100, aiNarrationOn: true, whatsappPct: 50 });
  const withoutAi = estimateMonthlyCost({ users: 100, aiNarrationOn: false, whatsappPct: 50 });
  assert.equal(withoutAi.breakdown.claude, 0);
  assert.ok(withAi.breakdown.claude >= 0);
});

test('estimateDailyCost from observed counters', () => {
  const result = estimateDailyCost({
    reads: 50_000,
    writes: 10_000,
    claudeInputTokens: 20_000,
    claudeOutputTokens: 5_000,
    whatsappMessages: 120,
    mapLoads: 800,
  });

  assert.equal(result.currency, 'MUR');
  assert.ok(result.totalMur > 0);
  assert.ok(result.breakdown.firestore > 0);
  assert.ok(result.breakdown.whatsapp > 0);
});

test('getPricing exposes MUR rates object', () => {
  const pricing = getPricing();
  assert.equal(pricing.currency, 'MUR');
  assert.ok(pricing.firestore.readPer100k > 0);
  assert.ok(pricing.claude.inputPer1kTokensMur > 0);
});
