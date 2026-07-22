const { getActiveSessions } = require('../sessions');

const counters = {
  firestoreWrites: 0,
  firestoreReads: 0,
  alertsCreated: 0,
  assistantRequests: 0,
  assistantTokensIn: 0,
  assistantTokensOut: 0,
  whatsappInbound: 0,
  whatsappOutbound: 0,
  writeGatePersisted: 0,
  writeGateSkipped: 0,
  tcpConnections: 0,
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
  counters.assistantTokensIn += Number(usage.input_tokens || usage.inputTokens || 0);
  counters.assistantTokensOut += Number(usage.output_tokens || usage.outputTokens || 0);
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
  getSnapshot,
  resetForTests,
};
