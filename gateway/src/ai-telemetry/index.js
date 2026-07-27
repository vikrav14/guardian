const { getDb } = require('../firestore');
const { recordAssistantUsage, increment: incrementMetric, getSnapshot } = require('../ops-metrics/collector');

const MAX_DECISIONS = 50;
const recentDecisions = [];

let latencyTotalMs = 0;
let latencyCount = 0;

/**
 * Record one assistant handleChat invocation for AI observability.
 */
function recordAiDecision({
  toolsUsed = [],
  tokensIn = 0,
  tokensOut = 0,
  latencyMs = 0,
  callerPhone = '',
} = {}) {
  if (tokensIn > 0 || tokensOut > 0) {
    recordAssistantUsage({ input_tokens: tokensIn, output_tokens: tokensOut });
  } else {
    incrementMetric('assistantRequests');
    incrementMetric('aiRequests');
  }

  if (latencyMs > 0) {
    latencyTotalMs += latencyMs;
    latencyCount += 1;
  }

  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    toolsUsed: Array.isArray(toolsUsed) ? toolsUsed : [],
    tokensIn: Number(tokensIn) || 0,
    tokensOut: Number(tokensOut) || 0,
    latencyMs: Number(latencyMs) || 0,
    callerPhone: String(callerPhone || ''),
  };

  recentDecisions.unshift(entry);
  if (recentDecisions.length > MAX_DECISIONS) {
    recentDecisions.length = MAX_DECISIONS;
  }

  persistDecision(entry).catch((err) => {
    console.error('[ai-telemetry] persist failed', err.message);
  });

  return entry;
}

async function persistDecision(entry) {
  const db = getDb();
  if (!db) return;

  await db
    .collection('ops')
    .doc('ai')
    .collection('decisions')
    .doc(entry.id)
    .set(entry, { merge: true });
}

function getAiStats(counters) {
  const c = counters === undefined ? getSnapshot().counters : counters;
  const avgLatencyMs =
    latencyCount > 0
      ? Math.round(latencyTotalMs / latencyCount)
      : c.aiAvgLatencyMs || 0;

  return {
    aiRequests: c.aiRequests || c.assistantRequests || 0,
    aiTokensIn: c.aiTokensIn || c.assistantTokensIn || 0,
    aiTokensOut: c.aiTokensOut || c.assistantTokensOut || 0,
    avgLatencyMs,
    recentDecisions: recentDecisions.slice(0, 10),
  };
}

function resetForTests() {
  recentDecisions.length = 0;
  latencyTotalMs = 0;
  latencyCount = 0;
}

module.exports = {
  recordAiDecision,
  getAiStats,
  resetForTests,
};
