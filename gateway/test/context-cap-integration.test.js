const test = require('node:test');
const assert = require('node:assert/strict');

const ContextService = require('../src/context/contextService');
const {
  runContextSourcePoll,
  startContextSourceScheduler,
  stopContextSourceSchedulerForTests,
} = require('../src/context/contextSourceScheduler');

function applicableAlert() {
  return {
    id: 'mu-mms-en:alert-123',
    documentId: 'alert-document',
    source: {
      id: 'mu-mms-en',
      name: 'Mauritius Meteorological Services',
      authority: 'official_authority',
    },
    active: true,
    status: 'actual',
    messageType: 'alert',
    event: 'Heavy Rain Warning',
    eventType: 'heavy_rain',
    headline: 'Heavy Rain Warning for Mauritius',
    instruction: 'Avoid flooded roads.',
    severity: 'severe',
    urgency: 'expected',
    certainty: 'likely',
    effectiveAt: '2026-08-19T06:00:00.000Z',
    expiresAt: '2026-08-19T12:00:00.000Z',
    applicability: { matches: true, confidence: 'exact', reason: 'inside_cap_polygon' },
  };
}

test('official CAP candidates use the shared context path without fetching weather or sending', async () => {
  let weatherCalls = 0;
  const service = new ContextService('', null, {
    contextLlmJudgmentEnabled: false,
  }, {
    weatherProvider: {
      getWeather: async () => {
        weatherCalls += 1;
        throw new Error('weather should not be fetched');
      },
      getCacheStats: () => ({ entries: 0, maxDurationMinutes: 60 }),
    },
    capAlertProvider: {
      getApplicableAlerts: () => [applicableAlert()],
      getSnapshot: () => ({ source: { id: 'mu-mms-en' }, activeAlerts: 1 }),
    },
  });

  const context = await service.getDeviceContext(
    { online: true, lastSeenMinutesAgo: 2, batteryPercent: 80 },
    { displayName: 'Jesh', age: 12, careContext: 'child' },
    {
      lat: -20.16,
      lng: 57.5,
      placeName: 'Lower Vale',
      freshnessMinutes: 2,
      accuracyClass: 'precise',
    },
    { source: 'official_cap_update', skipWeather: true, now: new Date('2026-08-19T08:00:00.000Z') }
  );

  assert.equal(weatherCalls, 0);
  assert.equal(context.officialAlerts.length, 1);
  assert.equal(context.deterministicEvaluation.relevant, true);
  assert.equal(context.deterministicEvaluation.severity, 'check_in');
  assert.equal(context.delivery.mode, 'observe_only');
  assert.equal(context.delivery.sent, false);
  assert.equal(context.contextDecision.recommendedSurface, 'app');
});

test('source poll persists changed source facts and invokes one shared device sweep', async () => {
  const writes = [];
  const db = {
    collection: (name) => ({
      doc: (id) => ({
        set: async (payload) => writes.push({ name, id, payload }),
      }),
    }),
  };
  const provider = {
    poll: async () => ({
      ok: true,
      source: 'mu-mms-en',
      notModified: false,
      alerts: [applicableAlert()],
      activeAlerts: [applicableAlert()],
      changedAlerts: [applicableAlert()],
    }),
  };
  let sweepArgs = null;
  const result = await runContextSourcePoll({
    db,
    provider,
    contextService: {},
    config: { contextCapPersistEvents: true, contextCapEvaluateDevices: true },
    now: new Date('2026-08-19T08:00:00.000Z'),
    runSweep: async (args) => {
      sweepArgs = args;
      return { ok: true, devicesEvaluated: 2 };
    },
  });

  assert.equal(result.observeOnly, true);
  assert.equal(result.eventsPersisted, 1);
  assert.equal(writes[0].name, 'contextEvents');
  assert.equal(writes[0].payload.deliverySent, false);
  assert.equal(sweepArgs.source, 'official_cap_update');
  assert.equal(sweepArgs.skipWeather, true);
});

test('CAP scheduler is disabled by default and clamps polling to five minutes', () => {
  stopContextSourceSchedulerForTests();
  const disabled = startContextSourceScheduler({ config: {} });
  assert.equal(disabled.active, false);

  const scheduler = startContextSourceScheduler({
    provider: { source: { id: 'mu-mms-en' }, poll: async () => ({}), getSnapshot: () => ({}) },
    config: {
      contextCapEnabled: true,
      contextCapPollMinutes: 1,
      contextCapRunOnStartup: false,
    },
  });
  assert.equal(scheduler.active, true);
  assert.equal(scheduler.intervalMinutes, 5);
  scheduler.stop();
});
