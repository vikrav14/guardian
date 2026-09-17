'use strict';

const { randomUUID } = require('node:crypto');
const { validConsent } = require('./care-wellbeing');
const { loadEntitlementsForUser } = require('./entitlements');
const { createRoutineController, parseTemperatureMode, temperatureCommand } = require('./wellness-routine');
const { findSocketsForDevice } = require('./sessions');
const { sendDownlinkCommand } = require('./downlink');
const { createHardwareEvidence } = require('./wellness-hardware-evidence');
const { createSupervisedTemperatureTrial } = require('./supervised-temperature-trial');
const { createConditionalWellnessTrial } = require('./conditional-wellness-trial');
const { parseDailyRoutine, createDailyWellnessScheduler } = require('./daily-wellness-scheduler');
const { createDailyWellnessStore } = require('./daily-wellness-store');

let runtime;
const date = value => value?.toDate?.() || (value == null ? null : new Date(value));

function parseRoutineOperation(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
      !['temperature_once', 'firmware_version', 'removal_test_enable', 'removal_test_disable'].includes(payload.action) ||
      Object.keys(payload).some(key => !['action', 'includeReply'].includes(key)) ||
      ('includeReply' in payload && (payload.action !== 'firmware_version' || payload.includeReply !== true))) {
    throw new Error('Use temperature_once, firmware_version, removal_test_enable or removal_test_disable; only firmware_version accepts includeReply: true.');
  }
  return { action: payload.action, includeReply: payload.includeReply === true };
}

function startWellnessRoutineRuntime({ db, config, wearEvidence, temperatureTrialQuarantine }) {
  const imei = config.wifiHomePilotImei;
  if (!db || !/^\d{15}$/.test(imei || '')) return null;
  const owner = randomUUID();
  const stateRef = db.collection('devices').doc(imei).collection('wellnessRoutine').doc('current');
  const requestRef = db.collection('wellnessRoutineRequests').doc(imei);
  const sessionIds = new WeakMap();
  const hardware = createHardwareEvidence();
  let conditionalTrial;
  let externalMeasurementPending = false;
  let lastExternalMeasurementAt = null;
  function currentSession() {
    const matches = findSocketsForDevice(imei).filter(({ socket }) => !socket.destroyed);
    return matches.length === 1 ? matches[0].session : null;
  }
  function live() {
    const session = currentSession();
    if (!session) return { connected: false, reason: 'single_session_required' };
    if (!sessionIds.has(session)) sessionIds.set(session, randomUUID());
    return { connected: true, sessionId: sessionIds.get(session),
      bt: session.wellnessTemperatureMode?.bt ?? null,
      tm: session.wellnessTemperatureMode?.tm ?? null,
      wear: wearEvidence.current(imei) };
  }
  const readTrialContext = async () => {
    const [consent, request, state] = await Promise.all([
      db.collection('wellbeingConsents').doc(imei).get(), requestRef.get(), stateRef.get(),
    ]);
    return { consent: consent.data(), request: request.data(), state: state.data() };
  };
  const temperatureTrial = createSupervisedTemperatureTrial({ config, currentSession,
    quarantineStore: temperatureTrialQuarantine,
    send: command => sendDownlinkCommand(imei, command),
    readContext: readTrialContext,
  });
  conditionalTrial = createConditionalWellnessTrial({ config, currentSession,
    readContext: readTrialContext, temperatureTrial,
    sendOptical: command => sendDownlinkCommand(imei, command) });

  const targetsPilot = target => target === imei ||
    findSocketsForDevice(target).some(({ session }) => session.imei === imei);
  function assertMeasurementAvailable(targetImei, command) {
    if (!targetsPilot(targetImei)) return;
    if (/^REMOVE(?:,|$)/i.test(command)) {
      conditionalTrial.cancel('removal_setting_changed');
      return;
    }
    if (!/^(?:hrtstart|bodytemp2?|measurement)(?:,|$)/i.test(command)) return;
    // An explicit stop always remains available, including while a capture
    // is reserved for delayed packets. It cancels any unsent second stage.
    if (/^(?:hrtstart,0|bodytemp,0)(?:,|$)/i.test(command)) {
      conditionalTrial.cancel('external_stop_requested');
      return;
    }
    if (conditionalTrial.isBusy()) {
      throw new Error('A conditional wellness sequence is active or cooling down; inspect its result first.');
    }
    if (externalMeasurementPending) throw new Error('A wellbeing measurement is already being prepared.');
    if (/^hrtstart,(?:[2-9]|\d{2,})(?:,|$)/i.test(command) || /^bodytemp,1(?:,|$)/i.test(command)) {
      throw new Error('Use the daily Wellness routine times; native interval starts are disabled for this pilot.');
    }
  }
  function noteExternalMeasurement(targetImei, command) {
    if (targetsPilot(targetImei) && /^(?:hrtstart|bodytemp2?)(?:,|$)/i.test(command)) {
      lastExternalMeasurementAt = Date.now();
    }
  }
  async function externalMeasurement(operation) {
    assertMeasurementAvailable(imei, 'measurement');
    externalMeasurementPending = true;
    try { return await operation(); }
    finally { externalMeasurementPending = false; }
  }
  async function read() {
    const [requestDoc, grantDoc, consentDoc] = await Promise.all([
      requestRef.get(), db.collection('wellnessPilots').doc(imei).get(),
      db.collection('wellbeingConsents').doc(imei).get(),
    ]);
    const request = requestDoc.data(), grant = grantDoc.data(), consent = consentDoc.data();
    const at = new Date();
    const state = await db.runTransaction(async tx => {
      const prior = (await tx.get(stateRef)).data() || {};
      if (prior.leaseOwner && prior.leaseOwner !== owner && +date(prior.leaseUntil) > +at) return null;
      // No routine means no default commands. A diagnostic summary is useful
      // even before the first request, without retaining raw CONFIG contents.
      tx.set(stateRef, { leaseOwner: owner, leaseUntil: new Date(+at + 60_000) }, { merge: true });
      return prior;
    });
    if (!state) return null;
    const uid = request?.requestedBy;
    const userDoc = typeof uid === 'string' && uid.length > 0 && !uid.includes('/')
      ? await db.collection('users').doc(uid).get() : null;
    const user = userDoc?.data();
    const access = user ? await loadEntitlementsForUser(db, { ...user, uid }, { now: new Date() }) : null;
    const now = new Date();
    const grantValid = grant?.version === 1 && grant.managedBy === 'guardian_admin' &&
      grant.enabled === true && grant.viewerUid === uid &&
      +date(grant.createdAt) <= +now && +date(grant.expiresAt) > +now &&
      +date(grant.expiresAt) - +date(grant.createdAt) <= 86400_000;
    const linked = user?.linkedImeis?.includes(imei) === true && access?.serviceActive === true;
    const requestTime = date(request?.updatedAt);
    const requestValid = (request?.version === 1 || parseDailyRoutine(request)) &&
      Number.isFinite(+requestTime) && requestTime != null &&
      +requestTime <= +now && typeof request?.routine === 'string';
    return { state, request: requestValid ? { ...request, revision: requestTime.toISOString() } : null,
      enabled: config.wellnessRoutinePilotEnabled && config.careWellbeingRequestEnabled && config.careWellbeingIngestEnabled,
      canStop: linked && grantValid,
      authorized: linked && grantValid && validConsent(consent, now),
      validUntil: new Date(Math.min(+date(grant?.expiresAt) || 0,
        +(access?.accessUntil || new Date('9999-01-01')),
        +(date(consent?.expiresAt) || new Date('9999-01-01')))),
    };
  }
  async function save(patch) {
    await db.runTransaction(async tx => {
      const doc = (await tx.get(stateRef)).data();
      if (doc?.leaseOwner !== owner || +date(doc?.leaseUntil) <= Date.now()) throw new Error('routine_lease_lost');
      tx.set(stateRef, patch, { merge: true });
    });
  }
  // Native intervals are retired. This reconciler is retained only to stop
  // old intervals, including a partial handoff saved by an older gateway.
  const controller = createRoutineController({ read: async () => {
    const context = await read();
    if (!context) return null;
    return { ...context, enabled: false,
      request: context.request?.version === 2
        ? { ...context.request, routine: 'manual' } : context.request };
  }, live, save,
    send: command => {
      if (!live().connected) return { ok: false };
      assertMeasurementAvailable(imei, command);
      noteExternalMeasurement(imei, command);
      return sendDownlinkCommand(imei, command);
    } });
  const dailyStore = createDailyWellnessStore({ db, imei, owner });
  const externalBusy = () => externalMeasurementPending ||
    (lastExternalMeasurementAt !== null && Date.now() - lastExternalMeasurementAt < 120_000);
  async function dailyContext() {
    const context = await read();
    if (!context) return null;
    const request = context.request;
    const blockedReason = !context.enabled ? 'pilot_disabled'
      : !context.authorized || +context.validUntil <= Date.now() ? 'access_or_consent_unavailable'
      : request?.version !== 2 ? 'legacy_routine_requires_times'
      : context.state.mayBeRunning || context.state.temperatureMayBeRunning ? 'native_schedule_stop_pending'
      : temperatureTrialQuarantine?.isSuppressed(imei) ? 'diagnostic_quarantine_active'
      : externalBusy() ? 'measurement_busy' : null;
    return { ...context, revision: request?.revision, connected: live().connected,
      lastAttempt: context.state.dailyLastAttempt || context.state.lastAttempt || null, blockedReason };
  }
  const dailyScheduler = createDailyWellnessScheduler({
    read: dailyContext,
    claim: dailyStore.claim,
    save: patch => dailyStore.save(patch),
    execute: async slot => {
      // The durable slot is consumed before this point. A lost response is
      // never retried, and scheduled execution never asserts manual wearing.
      const isCurrent = async () => {
        const context = await dailyContext();
        return !!context && context.revision === slot.revision && !context.blockedReason &&
          context.connected && context.request.routine !== 'manual';
      };
      if (Date.now() - +new Date(slot.scheduledAt) >= 60_000 || !await isCurrent()) {
        throw new Error('schedule_preflight_changed');
      }
      return conditionalTrial.requestScheduled({ isCurrent,
        startDeadlineAt: +new Date(slot.scheduledAt) + 60_000 });
    },
    status: () => conditionalTrial.status(),
  });
  let ticking;
  async function reconcile() {
    const context = await read();
    if (!context) return;
    // A changed/stopped/revoked request invalidates the asynchronous second
    // stage through isCurrent; the next slot remains independent.
    if (context.state.mayBeRunning || context.state.temperatureMayBeRunning ||
        (context.request?.routine === 'manual' && context.canStop)) {
      await controller.tick();
    }
    await dailyScheduler.tick();
    const snapshot = dailyScheduler.snapshot();
    await save({ ...snapshot, version: 2, intervalHours: null,
      customerAccepted: false, scheduleVerified: false, wearingConfirmed: false,
      updatedAt: new Date() });
  }
  function tick() {
    if (!ticking) ticking = reconcile()
      .catch(() => console.warn('[wellness-routine] reconciliation_failed'))
      .finally(() => { ticking = null; });
    return ticking;
  }
  function observe(decoded, session) {
    if (session?.imei !== imei) return;
    hardware.observe(decoded, session);
    const mode = parseTemperatureMode(decoded);
    if (mode !== undefined) {
      session.wellnessTemperatureMode = mode;
      // A partial/malformed later CONFIG must not erase a known incompatible
      // variant and turn it into permission for the missing-mode experiment.
      if (mode.bt !== null) session.wellnessLastReportedTemperatureBt = mode.bt;
    }
    temperatureTrial.observe(decoded, session);
    conditionalTrial.observe(decoded, session);
    // No async read in the GPS/SOS/ACK path. Coalescing occurs in tick().
  }
  let singleRequestAt = 0;
  let versionRequestAt = 0;
  let removalEnableAt = 0;
  function requestRemovalTest(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('A boolean removal-test setting is required.');
    if (!currentSession()) throw new Error('One connected pilot watch session is required.');
    const at = Date.now();
    if (enabled && at - removalEnableAt < 120_000) throw new Error('Wait two minutes before another enable request. Disable remains available.');
    if (enabled) removalEnableAt = at;
    // Strict-admin, explicitly supervised test of supplier II.18. Check and
    // write synchronously to the running gateway's configured pilot only.
    // No timer, SMS command, consent/acceptance change or background retry.
    const command = `REMOVE,${enabled ? 1 : 0}`;
    conditionalTrial.cancel('removal_setting_changed');
    const result = sendDownlinkCommand(imei, command);
    return { outcome: result.ok ? 'command_handed_off' : 'watch_not_connected',
      command, requestedAt: new Date(at).toISOString(), settingMayPersist: true,
      settingsConfirmed: false, wearingConfirmed: false };
  }
  function requestVersion({ includeReply = false } = {}) {
    // Supplier protocol II.45: read firmware version only. No measurement or
    // settings change; a version reply never establishes BT or wearing support.
    const session = currentSession();
    if (!session) throw new Error('One connected watch session is required.');
    const at = new Date();
    if (+at - versionRequestAt < 120_000) throw new Error('Wait two minutes before another version request.');
    versionRequestAt = +at;
    hardware.requestVersion(session, at, { includeReply });
    const result = sendDownlinkCommand(imei, 'VERNO');
    return { outcome: result.ok ? 'version_request_handed_off' : 'watch_not_connected',
      requestedAt: at.toISOString(), versionConfirmed: false };
  }
  async function requestTemperature() {
    // A bounded operator comparison, not an app/customer action. A supplied
    // reading never upgrades wearing evidence or validates an automatic cycle.
    if (!config.careWellbeingRequestEnabled || !config.careWellbeingIngestEnabled) {
      throw new Error('Wellbeing request and ingestion must be enabled.');
    }
    const consent = (await db.collection('wellbeingConsents').doc(imei).get()).data();
    if (!validConsent(consent, new Date())) throw new Error('Current wearer consent is required.');
    const device = live();
    if (!device.connected) throw new Error('One connected watch session is required.');
    if (device.bt !== 2) throw new Error('Waiting for this session to report CONFIG BT:2.');
    if (Date.now() - singleRequestAt < 120_000) throw new Error('Wait two minutes before another temperature request.');
    singleRequestAt = Date.now();
    noteExternalMeasurement(imei, 'bodytemp2');
    const result = sendDownlinkCommand(imei, temperatureCommand({ action: 'single' }));
    return { outcome: result.ok ? 'request_handed_off' : 'watch_not_connected',
      readingConfirmed: false, wearingConfirmed: false };
  }
  const timer = setInterval(tick, 20_000); timer.unref?.();
  void tick();
  runtime = { observe, tick, requestVersion, requestRemovalTest,
    assertMeasurementAvailable, noteExternalMeasurement,
    requestWellnessSequence(payload) {
      if (externalMeasurementPending) throw new Error('A wellbeing measurement is already being prepared.');
      if (lastExternalMeasurementAt !== null && Date.now() - lastExternalMeasurementAt < 120_000) {
        throw new Error('Wait two minutes after the previous measurement request before starting a conditional sequence.');
      }
      return conditionalTrial.request(payload);
    },
    wellnessSequenceStatus: conditionalTrial.status,
    requestTemperature: () => externalMeasurement(requestTemperature),
    requestTemperatureTrial: payload => externalMeasurement(() => temperatureTrial.request(payload)),
    temperatureTrialStatus: temperatureTrial.status,
    async status() {
      const state = (await stateRef.get()).data() || {};
      const { leaseOwner, leaseUntil, handoffKey, revision, ...summary } = state;
      const device = live();
      return { ...summary, outcome: 'read_only',
        updatedAt: summary.updatedAt == null ? null : date(summary.updatedAt).toISOString(),
        ...(summary.handoffAt ? { handoffAt: date(summary.handoffAt).toISOString() } : {}),
        connected: device.connected, temperatureBt: device.bt ?? null,
        temperatureTm: device.tm ?? null, observedModeFrom: 'current_gateway_session',
        ...hardware.current(currentSession()),
        routinePilotEnabled: config.wellnessRoutinePilotEnabled === true };
    },
    close: () => { conditionalTrial.cancel('gateway_stopped'); clearInterval(timer); },
  };
  return runtime;
}

module.exports = { startWellnessRoutineRuntime, getWellnessRoutineRuntime: () => runtime, parseRoutineOperation };
