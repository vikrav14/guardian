const { increment: incrementMetric } = require('../ops-metrics/collector');
const Logger = require('../logger');

const logger = new Logger({ module: 'defimedia-rss-scheduler' });
let activeScheduler = null;

function countByEventType(items) {
  return items.reduce((counts, item) => {
    const eventType = item.eventType || 'other';
    counts[eventType] = Number(counts[eventType] || 0) + 1;
    return counts;
  }, {});
}

async function runDefiMediaRssPoll({ provider, now = new Date() } = {}) {
  if (!provider) {
    return { ok: false, skipped: true, reason: 'defimedia_provider_unavailable' };
  }

  incrementMetric('contextNewsPolls');
  const poll = await provider.poll({ now });
  if (!poll.ok) {
    incrementMetric('contextNewsFetchErrors');
    return poll;
  }

  incrementMetric('contextNewsItemsSeen', poll.items.length);
  incrementMetric('contextNewsItemsChanged', poll.changedItems.length);
  incrementMetric('contextNewsCandidates', poll.changedCandidates.length);
  const summary = {
    ok: true,
    source: poll.source,
    notModified: poll.notModified,
    itemsSeen: poll.items.length,
    changedItems: poll.changedItems.length,
    freshCandidates: poll.candidateItems.length,
    changedCandidates: poll.changedCandidates.length,
    eventTypes: countByEventType(poll.changedCandidates),
    observeOnly: true,
    automaticDelivery: false,
    deviceSweep: null,
    llmCalls: 0,
    firestoreWrites: 0,
  };
  logger.info('Defi Media RSS shadow poll completed', summary);
  return summary;
}

function startDefiMediaRssScheduler({ provider, config = {} } = {}) {
  if (activeScheduler) return activeScheduler;
  if (config.contextDefiMediaEnabled !== true) {
    return { active: false, reason: 'disabled', stop() {}, runNow: null };
  }
  if (!provider) {
    return {
      active: false,
      reason: 'defimedia_provider_unavailable',
      stop() {},
      runNow: null,
    };
  }

  const intervalMinutes = Math.max(60, Number(config.contextDefiMediaPollMinutes || 60));
  const intervalMs = intervalMinutes * 60_000;
  let running = false;

  const runNow = async () => {
    if (running) {
      return { ok: false, skipped: true, reason: 'defimedia_poll_already_running' };
    }
    running = true;
    try {
      return await runDefiMediaRssPoll({ provider, now: new Date() });
    } catch (error) {
      incrementMetric('contextNewsFetchErrors');
      logger.error('Defi Media RSS shadow poll failed', { error: error.message });
      return { ok: false, error: error.message };
    } finally {
      running = false;
    }
  };

  const timer = setInterval(runNow, intervalMs);
  timer.unref?.();
  activeScheduler = {
    active: true,
    intervalMinutes,
    runNow,
    getStatus: () => provider.getSnapshot(),
    stop() {
      clearInterval(timer);
      activeScheduler = null;
    },
  };

  if (config.contextDefiMediaRunOnStartup !== false) setImmediate(() => runNow());
  logger.info('Defi Media RSS source scheduler started', {
    source: provider.source?.id,
    intervalMinutes,
    observeOnly: true,
    automaticDelivery: false,
    llmClassification: false,
  });
  return activeScheduler;
}

function stopDefiMediaRssSchedulerForTests() {
  activeScheduler?.stop();
}

module.exports = {
  countByEventType,
  runDefiMediaRssPoll,
  startDefiMediaRssScheduler,
  stopDefiMediaRssSchedulerForTests,
};
