const test = require('node:test');
const assert = require('node:assert/strict');
const {
  estimateMonthlyCost,
  estimateDailyCost,
  estimateCostSensitivity,
  projectBusiness,
  getFinanceSnapshot,
  getAiRecommendations,
  getApiMonitoringRows,
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
  assert.equal(pricing.device.pendantSaleMur, 2500);
  assert.equal(pricing.subscription.annualMur, 1500);
});

test('estimateCostSensitivity returns baseline and scenario deltas', () => {
  const result = estimateCostSensitivity({ users: 200, gpsIntervalSec: 60 });
  assert.ok(result.baseline.totalMur > 0);
  assert.ok(Array.isArray(result.scenarios));
  assert.ok(result.scenarios.length > 0);
  for (const scenario of result.scenarios) {
    assert.ok(typeof scenario.deltaMur === 'number');
    assert.ok(scenario.label);
  }
});

test('projectBusiness computes revenue, margin, and break-even', () => {
  const result = projectBusiness({
    users: 500,
    growthRatePct: 5,
    churnPct: 2,
    deviceSaleMur: 2500,
    subscriptionMur: 1500,
    deviceCostMur: 1800,
    supportMarketingPerUserMur: 45,
  });

  assert.equal(result.currency, 'MUR');
  assert.equal(result.users, 500);
  assert.ok(result.revenue.totalMur > 0);
  assert.ok(result.costs.cloudMur > 0);
  assert.ok(typeof result.grossMarginMur === 'number');
  assert.ok(typeof result.netProfitMur === 'number');
  assert.ok(result.breakEvenUsers === null || result.breakEvenUsers > 0);
});

test('getFinanceSnapshot merges revenue and burn rate', () => {
  const result = getFinanceSnapshot({
    assumptions: {
      devicesSoldMonth: 10,
      subscriptionsSoldMonth: 20,
      monthlyBudgetMur: 20000,
    },
    costTodayMur: 150,
    projectedMonthlyMur: 8500,
    projectedMonthlyBreakdown: {
      firestore: 3000,
      maps: 500,
      whatsapp: 200,
      claude: 800,
      hosting: 3200,
    },
  });

  assert.ok(result.revenue.monthMur > 0);
  assert.equal(result.cloud.projectedMonthMur, 8500);
  assert.ok(result.burnRate.budgetMur === 20000);
  assert.ok(result.costBreakdown.firestore === 3000);
  assert.equal(result.profitVsCost.revenueMur, result.revenue.monthMur);
  assert.equal(result.profitVsCost.costMur, 8500);
  assert.equal(result.profitVsCost.profitMur, result.grossMargin.monthMur);
  assert.equal(result.profitVsCost.marginPct, result.grossMargin.monthPct);
});

test('getAiRecommendations returns rule-based savings', () => {
  const result = getAiRecommendations({ users: 500, historyOn: true });
  assert.ok(result.baselineTotalMur > 0);
  assert.ok(Array.isArray(result.recommendations));
});

test('getApiMonitoringRows builds service table', () => {
  const rows = getApiMonitoringRows(
    { firestoreReads: 100, firestoreWrites: 50, assistantRequests: 3, whatsappInbound: 10 },
    { breakdown: { firestore: 12, claude: 5, whatsapp: 3.5, maps: 0 } }
  );
  assert.ok(rows.find((r) => r.service === 'Firestore'));
  assert.ok(rows.find((r) => r.service === 'Claude'));
});
