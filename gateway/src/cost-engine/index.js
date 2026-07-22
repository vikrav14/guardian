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
 *
 * @param {object} params
 * @param {number} params.users - active guardian accounts
 * @param {number} [params.gpsIntervalSec=60] - pendant GPS reporting interval
 * @param {boolean} [params.historyOn=false] - WRITE_LOCATION_HISTORY enabled
 * @param {boolean} [params.journeyCompression=true] - compressed journeys vs raw trail
 * @param {number} [params.whatsappPct=15] - % of users using WhatsApp assistant daily
 * @param {boolean} [params.aiNarrationOn=true] - Claude enabled for assistant
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

function round2(n) {
  return Math.round(n * 100) / 100;
}

function getPricing() {
  return pricing;
}

module.exports = {
  estimateMonthlyCost,
  estimateDailyCost,
  getPricing,
};
