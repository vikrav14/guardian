const {
  increment: incrementMetric,
} = require('../ops-metrics/collector');
const { runContextSweep } = require('./contextScheduler');
const Logger = require('../logger');

const logger = new Logger({ module: 'context-source-scheduler' });
let activeSourceScheduler = null;

function eventPayload(event, observedAt) {
  return {
    ...event,
    observedAt: observedAt.toISOString(),
    observeOnly: true,
    deliverySent: false,
  };
}

async function persistChangedEvents(db, events, observedAt) {
  if (!db || !events.length) return 0;
  let writes = 0;
  for (const event of events) {
    await db.collection('contextEvents').doc(event.documentId).set(
      eventPayload(event, observedAt),
      { merge: true }
    );
    writes += 1;
    incrementMetric('firestoreWrites');
    incrementMetric('contextCapEventWrites');
  }
  return writes;
}

async function runContextSourcePoll({
  db,
  provider,
  contextService,
  config = {},
  now = new Date(),
  runSweep = runContextSweep,
} = {}) {
  if (!provider) {
    return { ok: false, skipped: true, reason: 'cap_provider_unavailable' };
  }

  incrementMetric('contextCapPolls');
  const poll = await provider.poll({ now });
  if (!poll.ok) {
    incrementMetric('contextCapFetchErrors');
    return poll;
  }

  incrementMetric('contextCapAlertsSeen', poll.alerts.length);
  incrementMetric('contextCapAlertsChanged', poll.changedAlerts.length);
  const summary = {
    ok: true,
    source: poll.source,
    notModified: poll.notModified,
    alertsSeen: poll.alerts.length,
    activeAlerts: poll.activeAlerts.length,
    changedAlerts: poll.changedAlerts.length,
    eventsPersisted: 0,
    deviceSweep: null,
    observeOnly: true,
  };

  if (config.contextCapPersistEvents === true && db && poll.changedAlerts.length) {
    summary.eventsPersisted = await persistChangedEvents(db, poll.changedAlerts, now);
  }

  if (
    poll.changedAlerts.length &&
    config.contextCapEvaluateDevices !== false &&
    db &&
    contextService
  ) {
    incrementMetric('contextCapDeviceSweeps');
    summary.deviceSweep = await runSweep({
      db,
      contextService,
      config,
      now,
      source: 'official_cap_update',
      skipWeather: true,
    });
  }

  logger.info('Official CAP shadow poll completed', summary);
  return summary;
}

function startContextSourceScheduler({ db, provider, contextService, config = {} } = {}) {
  if (activeSourceScheduler) return activeSourceScheduler;
  if (config.contextCapEnabled !== true) {
    return { active: false, reason: 'disabled', stop() {}, runNow: null };
  }
  if (!provider) {
    return { active: false, reason: 'cap_provider_unavailable', stop() {}, runNow: null };
  }

  const intervalMinutes = Math.max(5, Number(config.contextCapPollMinutes || 5));
  const intervalMs = intervalMinutes * 60_000;
  let running = false;

  const runNow = async () => {
    if (running) return { ok: false, skipped: true, reason: 'cap_poll_already_running' };
    running = true;
    try {
      return await runContextSourcePoll({ db, provider, contextService, config, now: new Date() });
    } catch (error) {
      incrementMetric('contextCapFetchErrors');
      logger.error('Official CAP shadow poll failed', { error: error.message });
      return { ok: false, error: error.message };
    } finally {
      running = false;
    }
  };

  const timer = setInterval(runNow, intervalMs);
  timer.unref?.();
  activeSourceScheduler = {
    active: true,
    intervalMinutes,
    runNow,
    getStatus: () => provider.getSnapshot(),
    stop() {
      clearInterval(timer);
      activeSourceScheduler = null;
    },
  };

  if (config.contextCapRunOnStartup !== false) setImmediate(() => runNow());
  logger.info('Official CAP source scheduler started', {
    source: provider.source?.id,
    intervalMinutes,
    observeOnly: true,
    eventPersistence: config.contextCapPersistEvents === true,
    observationPersistence: config.contextPersistObservations === true,
  });
  return activeSourceScheduler;
}

function stopContextSourceSchedulerForTests() {
  activeSourceScheduler?.stop();
}

module.exports = {
  eventPayload,
  persistChangedEvents,
  runContextSourcePoll,
  startContextSourceScheduler,
  stopContextSourceSchedulerForTests,
};
