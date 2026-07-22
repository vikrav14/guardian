const collector = require('./collector');
const flusher = require('./flusher');
const auth = require('./auth');
const {
  estimateDailyCost,
  estimateMonthlyCost,
  estimateCostSensitivity,
  projectBusiness,
  getFinanceSnapshot,
  getAiRecommendations,
  getApiMonitoringRows,
  getPricing,
} = require('../cost-engine');
const { getAiStats } = require('../ai-telemetry');
const { getDb } = require('../firestore');

function getMetricsResponse() {
  const snapshot = collector.getSnapshot();
  const costToday = estimateDailyCost({
    reads: snapshot.counters.firestoreReads,
    writes: snapshot.counters.firestoreWrites,
    claudeInputTokens: snapshot.counters.assistantTokensIn || snapshot.counters.aiTokensIn,
    claudeOutputTokens: snapshot.counters.assistantTokensOut || snapshot.counters.aiTokensOut,
    whatsappMessages:
      snapshot.counters.whatsappInbound + snapshot.counters.whatsappOutbound,
  });

  return {
    ...snapshot,
    costEstimateTodayMur: costToday,
    apiMonitoring: getApiMonitoringRows(snapshot.counters, costToday),
  };
}

async function getFleetResponse() {
  const snapshot = collector.getSnapshot();
  const counters = snapshot.counters;

  let fleet = {
    totalDevices: counters.devicesTotal || 0,
    devicesOnline: counters.devicesOnline || counters.devicesOnlineTcp || 0,
    devicesOffline: Math.max(
      0,
      (counters.devicesTotal || 0) - (counters.devicesOnline || counters.devicesOnlineTcp || 0)
    ),
    devicesOnlineTcp: counters.devicesOnlineTcp || 0,
    avgBatteryPercent: counters.avgBatteryPercent || 0,
    gpsQualityPct: counters.gpsQualityPct || 0,
    batterySampleSize: 0,
    gpsSampleSize: 0,
    source: 'metrics',
  };

  const db = getDb();
  if (db && fleet.totalDevices === 0) {
    try {
      const live = await flusher.aggregateFleetFromFirestore(db);
      fleet = { ...live, devicesOnlineTcp: counters.devicesOnlineTcp || 0, source: 'firestore' };
      collector.setFleetAggregates(live);
    } catch (err) {
      fleet.error = err.message;
    }
  }

  return {
    updatedAt: snapshot.updatedAt,
    fleet,
  };
}

async function getFinanceResponse(assumptions = {}) {
  const snapshot = collector.getSnapshot();
  const users = Number(assumptions.users) || 500;
  const projected = estimateMonthlyCost({ users });
  const costToday = estimateDailyCost({
    reads: snapshot.counters.firestoreReads,
    writes: snapshot.counters.firestoreWrites,
    claudeInputTokens: snapshot.counters.assistantTokensIn,
    claudeOutputTokens: snapshot.counters.assistantTokensOut,
    whatsappMessages:
      snapshot.counters.whatsappInbound + snapshot.counters.whatsappOutbound,
  });

  const db = getDb();
  let mergedAssumptions = { ...getPricing().finance, users, ...assumptions };
  if (db) {
    try {
      const doc = await db.collection('ops').doc('finance').collection('config').doc('assumptions').get();
      if (doc.exists) {
        mergedAssumptions = { ...mergedAssumptions, ...doc.data() };
      }
    } catch (err) {
      mergedAssumptions.loadError = err.message;
    }
  }

  return getFinanceSnapshot({
    assumptions: mergedAssumptions,
    costTodayMur: costToday.totalMur,
    costTodayBreakdown: costToday.breakdown,
    projectedMonthlyMur: projected.totalMur,
    projectedMonthlyBreakdown: projected.breakdown,
  });
}

function getGrowthResponse(params = {}) {
  return projectBusiness(params);
}

function getAiStatsResponse() {
  const snapshot = collector.getSnapshot();
  const costToday = estimateDailyCost({
    claudeInputTokens: snapshot.counters.aiTokensIn || snapshot.counters.assistantTokensIn,
    claudeOutputTokens: snapshot.counters.aiTokensOut || snapshot.counters.assistantTokensOut,
  });

  const stats = getAiStats(snapshot.counters);
  const recommendations = getAiRecommendations({ users: 500 });

  return {
    updatedAt: snapshot.updatedAt,
    ...stats,
    estimatedCostTodayMur: costToday.breakdown.claude ?? 0,
    recommendations: recommendations.recommendations,
    quality: {
      correct: 0,
      manualOverrides: 0,
      falsePositives: 0,
    },
  };
}

module.exports = {
  ...collector,
  ...flusher,
  ...auth,
  getMetricsResponse,
  getFleetResponse,
  getFinanceResponse,
  getGrowthResponse,
  getAiStatsResponse,
  estimateCostSensitivity,
  estimateMonthlyCost,
  getPricing,
};
