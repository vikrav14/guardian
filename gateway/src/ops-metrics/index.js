const collector = require('./collector');
const flusher = require('./flusher');
const auth = require('./auth');
const { estimateDailyCost } = require('../cost-engine');

function getMetricsResponse() {
  const snapshot = collector.getSnapshot();
  const costToday = estimateDailyCost({
    reads: snapshot.counters.firestoreReads,
    writes: snapshot.counters.firestoreWrites,
    claudeInputTokens: snapshot.counters.assistantTokensIn,
    claudeOutputTokens: snapshot.counters.assistantTokensOut,
    whatsappMessages:
      snapshot.counters.whatsappInbound + snapshot.counters.whatsappOutbound,
  });

  return {
    ...snapshot,
    costEstimateTodayMur: costToday,
  };
}

module.exports = {
  ...collector,
  ...flusher,
  ...auth,
  getMetricsResponse,
};
