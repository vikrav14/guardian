const crypto = require('crypto');
const {
  increment: incrementMetric,
} = require('../ops-metrics/collector');
const { adaptDeviceContext } = require('./deviceContextAdapter');
const Logger = require('../logger');

const logger = new Logger({ module: 'context-scheduler' });
let activeScheduler = null;

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), Math.max(1, items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function hourBucket(date = new Date()) {
  return date.toISOString().slice(0, 13).replace(/[-T]/g, '');
}

function observationId(imei, date) {
  const safeImei = String(imei || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '');
  const digest = crypto.createHash('sha256').update(String(imei || '')).digest('hex').slice(0, 10);
  return `${safeImei.slice(0, 24)}_${hourBucket(date)}_${digest}`;
}

async function persistObservation(db, imei, adapted, context, observedAt) {
  const id = observationId(imei, observedAt);
  const payload = {
    imei,
    observedAt: observedAt.toISOString(),
    source: 'hourly_shadow_sweep',
    observeOnly: true,
    deliverySent: false,
    placeName: adapted.location.placeName,
    locationFreshnessMinutes: adapted.location.freshnessMinutes,
    locationAccuracyClass: adapted.location.accuracyClass,
    weather: {
      source: context.weather?.source || 'unknown',
      condition: context.weather?.condition || 'unknown',
      severity: context.weather?.severity || 'unknown',
      alertTypes: (context.weather?.alerts || []).map((alert) => alert.type),
    },
    deterministicEvaluation: context.deterministicEvaluation,
    contextDecision: context.contextDecision,
  };
  await db.collection('contextObservations').doc(id).set(payload, { merge: true });
  incrementMetric('firestoreWrites');
  incrementMetric('contextPersistenceWrites');
}

async function runContextSweep({ db, contextService, config = {}, now = new Date() }) {
  const startedAt = Date.now();
  if (!db || !contextService) {
    return { ok: false, skipped: true, reason: 'context_dependencies_unavailable' };
  }

  incrementMetric('contextSweeps');
  const maxDevices = Math.max(1, Number(config.contextMaxDevicesPerSweep || 1000));
  let query = db.collection('devices');
  if (typeof query.limit === 'function') query = query.limit(maxDevices);
  const snapshot = await query.get();
  const docs = Array.from(snapshot.docs || []).slice(0, maxDevices);
  incrementMetric('firestoreReads', docs.length);

  const summary = {
    ok: true,
    devicesRead: docs.length,
    devicesEvaluated: 0,
    devicesSkipped: 0,
    deterministicCandidates: 0,
    surfaced: 0,
    suppressed: 0,
    errors: 0,
    observationsPersisted: 0,
    observeOnly: true,
  };

  await mapWithConcurrency(
    docs,
    Math.max(1, Number(config.contextConcurrency || 5)),
    async (doc) => {
      try {
        const raw = doc.data() || {};
        const adapted = adaptDeviceContext(raw, { now });
        if (!adapted) {
          summary.devicesSkipped += 1;
          return;
        }
        summary.devicesEvaluated += 1;
        const context = await contextService.getDeviceContext(
          adapted.device,
          adapted.person,
          adapted.location,
          { imei: doc.id, source: 'hourly_shadow_sweep' }
        );
        if (context.error) summary.errors += 1;
        if (!context.deterministicEvaluation?.relevant) return;

        summary.deterministicCandidates += 1;
        if (context.contextEvaluation?.relevant) summary.surfaced += 1;
        else summary.suppressed += 1;

        if (config.contextPersistObservations === true) {
          await persistObservation(db, doc.id, adapted, context, now);
          summary.observationsPersisted += 1;
        }
      } catch (err) {
        summary.errors += 1;
        logger.error('Device context evaluation failed', {
          imei: doc.id,
          error: err.message,
        });
      }
    }
  );

  summary.durationMs = Date.now() - startedAt;
  logger.info('Hourly context shadow sweep completed', summary);
  return summary;
}

function startContextScheduler({ db, contextService, config = {} }) {
  if (activeScheduler) return activeScheduler;
  if (config.contextIntelligenceEnabled !== true) {
    return { active: false, reason: 'disabled', stop() {}, runNow: null };
  }
  if (!config.openWeatherMapKey) {
    logger.warn('Context scheduler not started: OPEN_WEATHER_MAP_KEY is missing');
    return { active: false, reason: 'weather_api_key_missing', stop() {}, runNow: null };
  }
  if (!db || !contextService) {
    logger.warn('Context scheduler not started: dependencies unavailable');
    return { active: false, reason: 'dependencies_unavailable', stop() {}, runNow: null };
  }

  const intervalMinutes = Math.max(60, Number(config.contextPollMinutes || 60));
  const intervalMs = intervalMinutes * 60_000;
  let running = false;

  const runNow = async () => {
    if (running) return { ok: false, skipped: true, reason: 'sweep_already_running' };
    running = true;
    try {
      return await runContextSweep({ db, contextService, config, now: new Date() });
    } catch (err) {
      logger.error('Hourly context shadow sweep failed', { error: err.message });
      return { ok: false, error: err.message };
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
    stop() {
      clearInterval(timer);
      activeScheduler = null;
    },
  };

  if (config.contextRunOnStartup !== false) {
    setImmediate(() => runNow());
  }
  logger.info('Context scheduler started', {
    intervalMinutes,
    observeOnly: true,
    llmJudgment: config.contextLlmJudgmentEnabled !== false,
    persistence: config.contextPersistObservations === true,
  });
  return activeScheduler;
}

function stopContextSchedulerForTests() {
  activeScheduler?.stop();
}

module.exports = {
  mapWithConcurrency,
  observationId,
  persistObservation,
  runContextSweep,
  startContextScheduler,
  stopContextSchedulerForTests,
};
