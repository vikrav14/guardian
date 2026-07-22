const { getActiveSessions } = require('../sessions');

const counters = {
  firestoreWrites: 0,
  firestoreReads: 0,
  alertsCreated: 0,
  assistantRequests: 0,
  assistantTokensIn: 0,
  assistantTokensOut: 0,
  aiRequests: 0,
  aiTokensIn: 0,
  aiTokensOut: 0,
  aiAvgLatencyMs: 0,
  whatsappInbound: 0,
  whatsappOutbound: 0,
  writeGatePersisted: 0,
  writeGateSkipped: 0,
  tcpConnections: 0,
  devicesOnlineTcp: 0,
  devicesTotal: 0,
  devicesOnline: 0,
  avgBatteryPercent: 0,
  gpsQualityPct: 0,
  authRequests: 0,
  fcmPush: 0,
  smsSent: 0,
  mapLoads: 0,
  eventsProcessed: 0,
};

const alertTypes = {};
const eventTypes = {};

function increment(key, amount = 1) {
  if (!Object.prototype.hasOwnProperty.call(counters, key)) return;
  counters[key] += amount;
}

function incrementAlert(type = 'unknown') {
  counters.alertsCreated += 1;
  const t = String(type || 'unknown');
  alertTypes[t] = (alertTypes[t] || 0) + 1;
}

function incrementEvent(type = 'unknown') {
  counters.eventsProcessed += 1;
  const t = String(type || 'unknown');
  eventTypes[t] = (eventTypes[t] || 0) + 1;
}

function recordAssistantUsage(usage = {}) {
  counters.assistantRequests += 1;
  counters.aiRequests += 1;
  const input = Number(usage.input_tokens || usage.inputTokens || 0);
  const output = Number(usage.output_tokens || usage.outputTokens || 0);
  counters.assistantTokensIn += input;
  counters.assistantTokensOut += output;
  counters.aiTokensIn += input;
  counters.aiTokensOut += output;
}

function setFleetAggregates(fleet = {}) {
  counters.devicesTotal = Number(fleet.totalDevices) || 0;
  counters.devicesOnline = Number(fleet.devicesOnline) || 0;
  counters.avgBatteryPercent = Number(fleet.avgBatteryPercent) || 0;
  counters.gpsQualityPct = Number(fleet.gpsQualityPct) || 0;
}

function setAiLatencyAvg(ms) {
  counters.aiAvgLatencyMs = Math.round(Number(ms) || 0);
}

function recordWriteGate({ persisted = 0, skipped = 0 } = {}) {
  counters.writeGatePersisted += persisted;
  counters.writeGateSkipped += skipped;
}

function getSnapshot() {
  const sessions = getActiveSessions();
  let tcpWithImei = 0;
  for (const session of sessions.values()) {
    if (session.imei) tcpWithImei += 1;
  }

  return {
    updatedAt: new Date().toISOString(),
    date: todayKey(),
    counters: {
      ...counters,
      tcpConnections: sessions.size,
      devicesOnlineTcp: tcpWithImei,
    },
    alertTypes: { ...alertTypes },
    eventTypes: { ...eventTypes },
  };
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function resetForTests() {
  for (const key of Object.keys(counters)) {
    counters[key] = 0;
  }
  for (const key of Object.keys(alertTypes)) delete alertTypes[key];
  for (const key of Object.keys(eventTypes)) delete eventTypes[key];
}

module.exports = {
  increment,
  incrementAlert,
  incrementEvent,
  recordAssistantUsage,
  recordWriteGate,
  setFleetAggregates,
  setAiLatencyAvg,
  getSnapshot,
  resetForTests,
};
