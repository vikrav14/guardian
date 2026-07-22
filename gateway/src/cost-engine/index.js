const pricing = require('./pricing');

function murPerRead(reads) {
  return (reads / 100_000) * pricing.firestore.readPer100k;
}

function murPerWrite(writes) {
  return (writes / 100_000) * pricing.firestore.writePer100k;
}

function murClaudeTokens({ inputTokens = 0, outputTokens = 0 }) {
  return (
    (inputTokens / 1000) * pricing.claude.inputPer1kTokensMur +
    (outputTokens / 1000) * pricing.claude.outputPer1kTokensMur
  );
}

/**
 * Project monthly cloud spend from fleet + product knobs.
 */
function estimateMonthlyCost({
  users,
  gpsIntervalSec = 60,
  historyOn = false,
  journeyCompression = true,
  whatsappPct = 15,
  aiNarrationOn = true,
}) {
  const u = Math.max(0, Number(users) || 0);
  const d = pricing.defaults;
  const devices = u * d.avgDevicesPerUser;
  const daysInMonth = 30;

  const packetsPerDeviceDay = Math.max(1, Math.floor(86400 / Math.max(1, gpsIntervalSec)));
  const gatewayWritesPerDeviceDay = packetsPerDeviceDay * d.writeGatePersistRatio;
  const historyWritesPerDeviceDay = historyOn
    ? packetsPerDeviceDay
    : journeyCompression
      ? packetsPerDeviceDay * 0.02
      : 0;

  const firestoreWrites =
    u * d.firestoreWritesPerUserDay * daysInMonth +
    devices * (gatewayWritesPerDeviceDay + historyWritesPerDeviceDay) * daysInMonth;

  const firestoreReads = u * d.appOpensPerUserDay * d.firestoreReadsPerAppOpen * daysInMonth;

  const whatsappUsers = u * (Math.min(100, Math.max(0, whatsappPct)) / 100);
  const whatsappMessages =
    whatsappUsers * d.whatsappMessagesPerUserDay * daysInMonth * 2;

  const claudeTokens = aiNarrationOn
    ? whatsappMessages * d.claudeTokensPerWhatsAppMessage
    : 0;

  const mapLoads = u * d.mapLoadsPerUserDay * daysInMonth;

  const firestoreMur = murPerRead(firestoreReads) + murPerWrite(firestoreWrites);
  const mapsMur =
    (mapLoads / 1000) * pricing.maps.staticMapPer1000 +
    (u * 0.5 * daysInMonth) / 1000 * pricing.maps.geocodingPer1000;
  const whatsappMur = whatsappMessages * pricing.whatsapp.perMessageMur;
  const claudeMur = aiNarrationOn
    ? murClaudeTokens({ inputTokens: claudeTokens * 0.7, outputTokens: claudeTokens * 0.3 })
    : 0;
  const hostingMur = pricing.hosting.gatewayVmPerMonthMur + pricing.hosting.firebaseHostingPerMonthMur;

  const totalMur = firestoreMur + mapsMur + whatsappMur + claudeMur + hostingMur;

  return {
    currency: pricing.currency,
    users: u,
    assumptions: {
      gpsIntervalSec,
      historyOn,
      journeyCompression,
      whatsappPct,
      aiNarrationOn,
      devices: Math.round(devices * 10) / 10,
    },
    breakdown: {
      firestore: round2(firestoreMur),
      maps: round2(mapsMur),
      whatsapp: round2(whatsappMur),
      claude: round2(claudeMur),
      hosting: round2(hostingMur),
    },
    volumes: {
      firestoreReads: Math.round(firestoreReads),
      firestoreWrites: Math.round(firestoreWrites),
      whatsappMessages: Math.round(whatsappMessages),
      claudeTokens: Math.round(claudeTokens),
      mapLoads: Math.round(mapLoads),
    },
    totalMur: round2(totalMur),
    totalMurPerUser: u > 0 ? round2(totalMur / u) : 0,
  };
}

/**
 * Estimate spend for a single day from observed or projected counters.
 */
function estimateDailyCost({
  reads = 0,
  writes = 0,
  claudeInputTokens = 0,
  claudeOutputTokens = 0,
  whatsappMessages = 0,
  mapLoads = 0,
  geocodingRequests = 0,
  includeHostingDaily = false,
}) {
  const firestoreMur = murPerRead(reads) + murPerWrite(writes);
  const mapsMur =
    (mapLoads / 1000) * pricing.maps.staticMapPer1000 +
    (geocodingRequests / 1000) * pricing.maps.geocodingPer1000;
  const whatsappMur = whatsappMessages * pricing.whatsapp.perMessageMur;
  const claudeMur = murClaudeTokens({
    inputTokens: claudeInputTokens,
    outputTokens: claudeOutputTokens,
  });
  const hostingMur = includeHostingDaily
    ? pricing.hosting.gatewayVmPerMonthMur / 30
    : 0;

  const totalMur = firestoreMur + mapsMur + whatsappMur + claudeMur + hostingMur;

  return {
    currency: pricing.currency,
    breakdown: {
      firestore: round2(firestoreMur),
      maps: round2(mapsMur),
      whatsapp: round2(whatsappMur),
      claude: round2(claudeMur),
      hosting: round2(hostingMur),
    },
    volumes: {
      reads: Math.round(reads),
      writes: Math.round(writes),
      claudeInputTokens: Math.round(claudeInputTokens),
      claudeOutputTokens: Math.round(claudeOutputTokens),
      whatsappMessages: Math.round(whatsappMessages),
      mapLoads: Math.round(mapLoads),
      geocodingRequests: Math.round(geocodingRequests),
    },
    totalMur: round2(totalMur),
  };
}

/**
 * What-if sensitivity: delta Rs/month vs baseline for each knob.
 */
function estimateCostSensitivity(params = {}) {
  const baseline = estimateMonthlyCost({
    users: params.users ?? 500,
    gpsIntervalSec: params.gpsIntervalSec ?? 60,
    historyOn: params.historyOn ?? false,
    journeyCompression: params.journeyCompression ?? true,
    whatsappPct: params.whatsappPct ?? 15,
    aiNarrationOn: params.aiNarrationOn ?? true,
  });

  const toggles = [
    {
      key: 'historyOn',
      label: 'Raw location history',
      variant: { historyOn: true },
    },
    {
      key: 'historyOff',
      label: 'History OFF (journey compression)',
      variant: { historyOn: false, journeyCompression: true },
    },
    {
      key: 'journeyCompressionOff',
      label: 'Journey compression OFF',
      variant: { journeyCompression: false, historyOn: false },
    },
    {
      key: 'aiNarrationOff',
      label: 'AI narration OFF',
      variant: { aiNarrationOn: false },
    },
    {
      key: 'whatsappHalf',
      label: 'WhatsApp adoption 50%',
      variant: { whatsappPct: 50 },
    },
    {
      key: 'gps120',
      label: 'GPS interval 120s',
      variant: { gpsIntervalSec: 120 },
    },
    {
      key: 'gps30',
      label: 'GPS interval 30s',
      variant: { gpsIntervalSec: 30 },
    },
  ];

  const scenarios = toggles.map(({ key, label, variant }) => {
    const projected = estimateMonthlyCost({ ...params, ...variant });
    return {
      key,
      label,
      totalMur: projected.totalMur,
      deltaMur: round2(projected.totalMur - baseline.totalMur),
      breakdown: projected.breakdown,
    };
  });

  return {
    baseline,
    scenarios,
  };
}

/**
 * Growth planner — break-even and profit projection.
 */
function projectBusiness({
  users = 500,
  growthRatePct = 5,
  churnPct = 2,
  deviceCostMur,
  deviceSaleMur,
  subscriptionMur,
  supportMarketingPerUserMur,
  gpsIntervalSec = 60,
  historyOn = false,
  journeyCompression = true,
  whatsappPct = 15,
  aiNarrationOn = true,
}) {
  const u = Math.max(0, Number(users) || 0);
  const salePrice = Number(deviceSaleMur ?? pricing.device.pendantSaleMur);
  const deviceCost = Number(deviceCostMur ?? pricing.device.pendantCostMur);
  const subAnnual = Number(subscriptionMur ?? pricing.subscription.annualMur);
  const subMonthly = subAnnual / 12;
  const supportPerUser = Number(
    supportMarketingPerUserMur ?? pricing.finance.supportMarketingPerUserMur
  );

  const cloud = estimateMonthlyCost({
    users: u,
    gpsIntervalSec,
    historyOn,
    journeyCompression,
    whatsappPct,
    aiNarrationOn,
  });

  const devicesPerUser = pricing.defaults.avgDevicesPerUser;
  const deviceRevenue = u * devicesPerUser * salePrice;
  const subscriptionRevenue = u * subMonthly;
  const totalRevenue = deviceRevenue + subscriptionRevenue;
  const deviceCogs = u * devicesPerUser * deviceCost;
  const supportCost = u * supportPerUser;
  const cloudCost = cloud.totalMur;
  const grossMargin = totalRevenue - deviceCogs - cloudCost;
  const netProfit = grossMargin - supportCost;

  const revenuePerUser =
    devicesPerUser * salePrice + subMonthly - devicesPerUser * deviceCost - supportPerUser;
  const cloudPerUser = u > 0 ? cloudCost / u : cloud.totalMurPerUser;
  const netPerUser = revenuePerUser - cloudPerUser;

  let breakEvenUsers = 0;
  if (netPerUser > 0) {
    breakEvenUsers = Math.ceil(cloudCost / netPerUser);
  } else if (netPerUser < 0) {
    breakEvenUsers = null;
  }

  const netGrowthPct = (Number(growthRatePct) || 0) - (Number(churnPct) || 0);
  const projectedUsers12Mo = Math.round(u * Math.pow(1 + netGrowthPct / 100, 12));

  return {
    currency: pricing.currency,
    users: u,
    inputs: {
      growthRatePct: Number(growthRatePct) || 0,
      churnPct: Number(churnPct) || 0,
      deviceCostMur: deviceCost,
      deviceSaleMur: salePrice,
      subscriptionMur: subAnnual,
      supportMarketingPerUserMur: supportPerUser,
    },
    revenue: {
      deviceSalesMur: round2(deviceRevenue),
      subscriptionMur: round2(subscriptionRevenue),
      totalMur: round2(totalRevenue),
    },
    costs: {
      deviceCogsMur: round2(deviceCogs),
      cloudMur: round2(cloudCost),
      supportMarketingMur: round2(supportCost),
      totalMur: round2(deviceCogs + cloudCost + supportCost),
    },
    cloudBreakdown: cloud.breakdown,
    grossMarginMur: round2(grossMargin),
    grossMarginPct: totalRevenue > 0 ? round2((grossMargin / totalRevenue) * 100) : 0,
    netProfitMur: round2(netProfit),
    breakEvenUsers,
    projectedUsers12Mo,
    netGrowthPct: round2(netGrowthPct),
  };
}

/**
 * Finance dashboard snapshot from assumptions + live metrics.
 */
function getFinanceSnapshot({
  assumptions = {},
  costTodayMur = 0,
  costTodayBreakdown = {},
  projectedMonthlyMur = 0,
  projectedMonthlyBreakdown = {},
}) {
  const a = { ...pricing.finance, ...assumptions };
  const deviceSale = Number(a.deviceSaleMur ?? pricing.device.pendantSaleMur);
  const subAnnual = Number(a.subscriptionMur ?? pricing.subscription.annualMur);
  const subMonthly = subAnnual / 12;

  const revenueToday =
    (Number(a.devicesSoldToday) || 0) * deviceSale +
    (Number(a.subscriptionsSoldToday) || 0) * subMonthly;
  const revenueMonth =
    (Number(a.devicesSoldMonth) || 0) * deviceSale +
    (Number(a.subscriptionsSoldMonth) || 0) * subMonthly;

  const budgetMur = Number(a.monthlyBudgetMur ?? pricing.finance.monthlyBudgetMur);
  const cloudUsedMonth = projectedMonthlyMur;
  const cloudForecastMonth = projectedMonthlyMur;
  const grossMarginMonth = revenueMonth - cloudUsedMonth;

  const pieBreakdown = {
    firestore: projectedMonthlyBreakdown.firestore ?? 0,
    maps: projectedMonthlyBreakdown.maps ?? 0,
    whatsapp: projectedMonthlyBreakdown.whatsapp ?? 0,
    hosting: projectedMonthlyBreakdown.hosting ?? 0,
    ai: projectedMonthlyBreakdown.claude ?? 0,
    other: 0,
  };

  return {
    currency: pricing.currency,
    pricing: {
      deviceSaleMur: deviceSale,
      subscriptionAnnualMur: subAnnual,
      subscriptionMonthlyMur: round2(subMonthly),
    },
    revenue: {
      todayMur: round2(revenueToday),
      monthMur: round2(revenueMonth),
    },
    cloud: {
      todayMur: round2(costTodayMur),
      projectedMonthMur: round2(projectedMonthlyMur),
    },
    grossMargin: {
      monthMur: round2(grossMarginMonth),
      monthPct: revenueMonth > 0 ? round2((grossMarginMonth / revenueMonth) * 100) : 0,
    },
    burnRate: {
      budgetMur: round2(budgetMur),
      usedMur: round2(cloudUsedMonth),
      forecastMur: round2(cloudForecastMonth),
      usedPct: budgetMur > 0 ? round2((cloudUsedMonth / budgetMur) * 100) : 0,
    },
    costBreakdown: pieBreakdown,
    assumptions: a,
  };
}

/**
 * Rule-based AI/cost recommendations (not LLM-generated).
 */
function getAiRecommendations(params = {}) {
  const baseline = estimateMonthlyCost({
    users: params.users ?? 500,
    gpsIntervalSec: params.gpsIntervalSec ?? 60,
    historyOn: params.historyOn ?? false,
    journeyCompression: params.journeyCompression ?? true,
    whatsappPct: params.whatsappPct ?? 15,
    aiNarrationOn: params.aiNarrationOn ?? true,
  });

  const sensitivity = estimateCostSensitivity(params);
  const recommendations = [];

  for (const scenario of sensitivity.scenarios) {
    if (scenario.deltaMur >= -1) continue;
    recommendations.push({
      id: scenario.key,
      title: scenario.label,
      savingsMur: round2(Math.abs(scenario.deltaMur)),
      savingsMurPerMonth: round2(Math.abs(scenario.deltaMur)),
      impact: scenario.deltaMur < -500 ? 'high' : scenario.deltaMur < -100 ? 'medium' : 'low',
      description: `Switching to "${scenario.label}" saves Rs ${Math.abs(scenario.deltaMur).toFixed(0)}/month vs baseline.`,
    });
  }

  recommendations.sort((a, b) => b.savingsMur - a.savingsMur);

  if (params.gpsIntervalSec !== 60) {
    const at60 = estimateMonthlyCost({ ...params, gpsIntervalSec: 60 });
    const delta = baseline.totalMur - at60.totalMur;
    if (delta > 10) {
      recommendations.unshift({
        id: 'gps60',
        title: 'Reduce GPS interval to 60s',
        savingsMur: round2(delta),
        savingsMurPerMonth: round2(delta),
        impact: delta > 500 ? 'high' : 'medium',
        description: `60s GPS reporting saves Rs ${delta.toFixed(0)}/month vs ${params.gpsIntervalSec}s interval.`,
      });
    }
  }

  return {
    baselineTotalMur: baseline.totalMur,
    recommendations: recommendations.slice(0, 6),
  };
}

/**
 * API monitoring table rows from ops counters.
 */
function getApiMonitoringRows(counters = {}, costToday = {}) {
  const breakdown = costToday.breakdown || {};
  const waMessages =
    (counters.whatsappInbound || 0) + (counters.whatsappOutbound || 0);

  return [
    {
      service: 'Google Maps',
      requests: counters.mapLoads || 0,
      costMur: breakdown.maps ?? 0,
    },
    {
      service: 'Firestore',
      requests: (counters.firestoreReads || 0) + (counters.firestoreWrites || 0),
      costMur: breakdown.firestore ?? 0,
    },
    {
      service: 'Firebase Auth',
      requests: counters.authRequests || 0,
      costMur: 0,
    },
    {
      service: 'FCM',
      requests: counters.fcmPush || 0,
      costMur: 0,
    },
    {
      service: 'Claude',
      requests: counters.assistantRequests || counters.aiRequests || 0,
      costMur: breakdown.claude ?? 0,
    },
    {
      service: 'WhatsApp',
      requests: waMessages,
      costMur: breakdown.whatsapp ?? 0,
    },
    {
      service: 'Twilio SMS',
      requests: counters.smsSent || 0,
      costMur: round2((counters.smsSent || 0) * 0.25),
    },
  ];
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function getPricing() {
  return pricing;
}

module.exports = {
  estimateMonthlyCost,
  estimateDailyCost,
  estimateCostSensitivity,
  projectBusiness,
  getFinanceSnapshot,
  getAiRecommendations,
  getApiMonitoringRows,
  getPricing,
};
