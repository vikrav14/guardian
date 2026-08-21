const { increment: incrementMetric } = require('../ops-metrics/collector');
const Logger = require('../logger');
const { persistChangedNewsEvents } = require('./defiMediaEventStore');
const { evaluateNewsExposure } = require('./defiMediaExposureMatcher');

const logger = new Logger({ module: 'defimedia-rss-scheduler' });
let activeScheduler = null;

function countByEventType(items) {
  return items.reduce((counts, item) => {
    const eventType = item.eventType || 'other';
    counts[eventType] = Number(counts[eventType] || 0) + 1;
    return counts;
  }, {});
}

async function runDefiMediaRssPoll({
  db,
  provider,
  config = {},
  now = new Date(),
  persistEvents = persistChangedNewsEvents,
  evaluateExposure = evaluateNewsExposure,
} = {}) {
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
  let durable = {
    persistent: false,
    created: poll.changedItems,
    updated: [],
    unchanged: [],
    writes: 0,
  };
  if (config.contextDefiMediaPersistEvents !== false && db) {
    durable = await persistEvents(db, poll.changedItems, now);
  }
  const durableChanged = [...durable.created, ...durable.updated];
  const durableChangedIds = new Set(
    durableChanged.map((item) => item.documentId || item.id),
  );
  const durableChangedCandidates = poll.changedCandidates.filter((item) =>
    durableChangedIds.has(item.documentId || item.id)
  );
  incrementMetric('contextNewsCandidates', durableChangedCandidates.length);

  let exposure = null;
  if (
    config.contextDefiMediaEvaluateDevices !== false &&
    db &&
    poll.candidateItems.length
  ) {
    exposure = await evaluateExposure({
      db,
      candidates: poll.candidateItems,
      now,
      config,
      persist: config.contextDefiMediaPersistMatches !== false,
    });
  }
  const summary = {
    ok: true,
    source: poll.source,
    notModified: poll.notModified,
    itemsSeen: poll.items.length,
    changedItems: poll.changedItems.length,
    durableNewItems: durable.created.length,
    durableUpdatedItems: durable.updated.length,
    restartDuplicatesSuppressed: durable.unchanged.length,
    freshCandidates: poll.candidateItems.length,
    changedCandidates: durableChangedCandidates.length,
    eventTypes: countByEventType(durableChangedCandidates),
    eventsPersisted: durable.writes,
    exposure,
    observeOnly: true,
    automaticDelivery: false,
    deviceSweep: null,
    llmCalls: 0,
    firestoreWrites: durable.writes + Number(exposure?.newFamilyMatches || 0),
  };
  logger.info('Defi Media RSS shadow poll completed', summary);
  return summary;
}

function startDefiMediaRssScheduler({ db, provider, config = {} } = {}) {
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

  const intervalMinutes = Math.max(15, Number(config.contextDefiMediaPollMinutes || 15));
  const intervalMs = intervalMinutes * 60_000;
  let running = false;
  let lastRun = null;

  const runNow = async () => {
    if (running) {
      return { ok: false, skipped: true, reason: 'defimedia_poll_already_running' };
    }
    running = true;
    try {
      lastRun = await runDefiMediaRssPoll({
        db,
        provider,
        config,
        now: new Date(),
      });
      return lastRun;
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
    getStatus: () => ({ ...provider.getSnapshot(), lastRun }),
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
    persistentDeduplication: config.contextDefiMediaPersistEvents !== false && Boolean(db),
    exposureMatching: config.contextDefiMediaEvaluateDevices !== false && Boolean(db),
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
