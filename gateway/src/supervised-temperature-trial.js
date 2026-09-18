'use strict';

const { randomUUID } = require('node:crypto');
const { validConsent } = require('./care-wellbeing');
const { createTemperatureTrialEvidence } = require('./temperature-trial-evidence');

const CONTEXT_TIMEOUT_MS = 5000;

function parseTemperatureTrialOperation(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
      Object.keys(payload).some(key => !['action', 'operatorPosition', 'commandCase'].includes(key)) ||
      payload.action !== 'single' ||
      (Object.hasOwn(payload, 'commandCase') && !['lowercase', 'uppercase'].includes(payload.commandCase)) ||
      !['worn', 'removed'].includes(payload.operatorPosition)) {
    throw new Error('Use action single with operatorPosition worn or removed; optional commandCase must be lowercase or uppercase.');
  }
  return { action: 'single', operatorPosition: payload.operatorPosition,
    ...(Object.hasOwn(payload, 'commandCase') ? { commandCase: payload.commandCase } : {}) };
}

// Separate strict-admin experiment. CONFIG is not a required handshake in the
// supplier's single-measurement example. Missing BT permits this explicit probe,
// never a customer routine or a stored claim that BT=2 / worn was established.
function createSupervisedTemperatureTrial({ config, readContext, currentSession,
  send, clock = Date.now, quarantineStore }) {
  const evidence = createTemperatureTrialEvidence({ clock });
  let busy = false, lastAttemptAt = null;
  let memorySuppressed = false, releaseFailed = false;
  const quarantine = quarantineStore || {
    isSuppressed: () => memorySuppressed,
    suppress: () => { memorySuppressed = true; },
    resume: () => { memorySuppressed = false; },
  };
  if (['isSuppressed', 'suppress', 'resume'].some(key => typeof quarantine[key] !== 'function')) {
    throw new TypeError('Temperature quarantine needs synchronous status, suppress and resume operations.');
  }
  function suppressTemperatureIngestion() {
    if (releaseFailed) return true;
    try { return quarantine.isSuppressed() !== false; }
    catch { return true; }
  }
  const enabled = () => config.wellnessRoutineEnabled === true &&
    config.careWellbeingRequestEnabled === true &&
    config.careWellbeingIngestEnabled === true;

  function boundedOperation(operation) {
    let timer;
    // Only this raced result reaches the request continuation. A late database
    // result cannot revive a timed-out preparation or send a watch command.
    return Promise.race([
      Promise.resolve().then(operation),
      new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Temperature context read timed out.')), CONTEXT_TIMEOUT_MS);
      }),
    ]).finally(() => clearTimeout(timer));
  }
  const boundedContext = () => boundedOperation(readContext);

  function preflightSession() {
    const session = currentSession();
    if (!session) throw new Error('One connected pilot watch session is required.');
    const age = clock() - session.lastPacketAt;
    if (!Number.isFinite(age) || age < 0 || age > 180_000) {
      throw new Error('A fresh watch packet within three minutes is required.');
    }
    const bt = session.wellnessTemperatureMode?.bt ?? session.wellnessLastReportedTemperatureBt ?? null;
    if (bt !== null && bt !== 2) throw new Error('The reported BT mode does not match this documented single-measurement command.');
    return session;
  }

  // Readiness is also used before the optical stage of a conditional trial.
  // It never arms evidence, changes quarantine or sends a watch command.
  function assertReady({ expectedSession } = {}) {
    if (!enabled()) throw new Error('Wellness routine, request and ingestion must be enabled.');
    if (busy) throw new Error('A temperature test is already being prepared.');
    if (lastAttemptAt !== null && clock() - lastAttemptAt < 120_000) {
      throw new Error('Wait two minutes before another temperature test; inspect the existing result first.');
    }
    const session = preflightSession();
    if (expectedSession && session !== expectedSession) {
      throw new Error('The watch session changed during preparation; nothing sent.');
    }
    return session;
  }

  function assertScheduledReady(options = {}) {
    const session = assertReady(options);
    if (suppressTemperatureIngestion()) {
      throw new Error('A removed-watch diagnostic quarantine is active; supervised cleanup is required before scheduled readings.');
    }
    return session;
  }

  async function execute(operation, { expectedSession, shouldSend, isCurrent } = {}) {
    const scheduled = operation.positionBasis === 'scheduled';
    // Uppercase is an explicitly selected protocol-family comparison. Never
    // fall back between spellings or change customer routine command builders.
    const command = operation.commandCase === 'uppercase' ? 'BODYTEMP2' : 'bodytemp2';
    const initialSession = scheduled ? assertScheduledReady({ expectedSession }) : assertReady({ expectedSession });
    const initialProtocolId = initialSession.protocolId;
    const initialImei = initialSession.imei;
    busy = true;
    try {
      const { consent, request: routineRequest, state } = await boundedContext();
      if (!enabled() || !validConsent(consent, new Date(clock()))) {
        throw new Error('Current wearer consent and enabled pilot ingestion are required.');
      }
      if ((scheduled ? routineRequest?.version !== 2 || !['gentle', 'balanced'].includes(routineRequest.routine)
        : routineRequest?.routine && routineRequest.routine !== 'manual') ||
          state?.mayBeRunning === true || state?.temperatureMayBeRunning === true) {
        throw new Error('Select Manual and resolve any possibly running routine before this test.');
      }
      // The scheduler rechecks revision, access and its lease after the local
      // consent read. A timed-out callback cannot later revive this request.
      if (scheduled && await boundedOperation(isCurrent) !== true) {
        throw new Error('The scheduled reading is no longer authorized; nothing sent.');
      }
      if (!enabled() || !validConsent(consent, new Date(clock()))) {
        throw new Error('Current wearer consent and enabled pilot ingestion are required.');
      }
      const session = preflightSession();
      if (session !== initialSession || session.protocolId !== initialProtocolId || session.imei !== initialImei) {
        throw new Error('The watch session changed during preparation; nothing sent.');
      }
      // The optical controller may be cancelled while consent is loading.
      // This guard is internal, never supplied by an HTTP request.
      if (shouldSend && shouldSend() !== true) {
        throw new Error('The conditional sequence no longer permits temperature; nothing sent.');
      }
      if (scheduled && suppressTemperatureIngestion()) {
        throw new Error('A removed-watch diagnostic quarantine is active; nothing sent.');
      }
      // Persist before arming a capture or handing off a removed request.
      // A failed write leaves no apparent request awaiting a watch reply.
      if (operation.operatorPosition === 'removed') quarantine.suppress();
      const requestedAt = new Date(clock()), trialId = randomUUID();
      lastAttemptAt = +requestedAt;
      const startEvidence = scheduled ? evidence.startScheduled : evidence.start;
      startEvidence(session, { requestedAt, trialId, operatorPosition: operation.operatorPosition, command,
        modeBt: session.wellnessTemperatureMode?.bt ?? session.wellnessLastReportedTemperatureBt ?? null });
      // Quarantine is independent of the capture window, packet limit and TCP
      // session. The runtime supplies durable storage. Arm before dispatch so
      // an immediate reply cannot enter ordinary wellbeing history.
      let outcome;
      try {
        const result = send(command);
        outcome = result?.ok === true ? 'command_handed_off' : 'not_sent';
      } catch {
        // A failed response is not permission to send the measurement again.
        outcome = 'handoff_unknown';
      }
      evidence.markHandoff(outcome);
      let cleanupError;
      if (!scheduled && operation.operatorPosition === 'worn' && outcome === 'command_handed_off') {
        try {
          quarantine.resume();
          releaseFailed = false;
        } catch {
          releaseFailed = true;
          // A partial cleanup must not release the current process. Restore
          // the durable marker when possible without retrying the watch send.
          try { quarantine.suppress(); } catch { /* Keep the in-memory block. */ }
          cleanupError = 'temperature_trial_quarantine_release_failed';
        }
      }
      return { outcome, trialId, command, requestedAt: requestedAt.toISOString(),
        operatorPosition: operation.operatorPosition, positionBasis: operation.positionBasis,
        ...(operation.operatorPosition === 'removed' ? { dataUse: 'engineering_trial_only' } : {}),
        temperatureIngestionSuppressed: suppressTemperatureIngestion(),
        ...(cleanupError ? { cleanupError } : {}),
        captureWindowSeconds: 120, automaticRetry: false,
        readingConfirmed: false, wearingConfirmed: false, scheduleVerified: false };
    } finally { busy = false; }
  }

  async function request(payload, options = {}) {
    return execute({ ...parseTemperatureTrialOperation(payload), positionBasis: 'operator_reported' }, options);
  }

  function requestScheduled({ expectedSession, shouldSend, isCurrent } = {}) {
    if (typeof isCurrent !== 'function' || typeof shouldSend !== 'function') {
      return Promise.reject(new TypeError('Scheduled temperature requires trusted schedule and synchronous sequence guards.'));
    }
    return execute({ operatorPosition: 'unknown', positionBasis: 'scheduled', commandCase: 'uppercase' },
      { expectedSession, shouldSend, isCurrent });
  }

  async function status({ includeValues = false } = {}) {
    // Metadata is always available to strict admin; health values require
    // explicit opt-in and a fresh consent read, including after revocation.
    let valuesAllowed = false;
    if (includeValues === true && enabled()) {
      const { consent } = await boundedContext();
      valuesAllowed = validConsent(consent, new Date(clock()));
    }
    const session = currentSession();
    const trial = evidence.current(session, { includeValues: valuesAllowed });
    return { outcome: 'read_only', connected: Boolean(session),
      trial, temperatureIngestionSuppressed: suppressTemperatureIngestion(),
      ...(includeValues ? { valuesIncluded: trial.valuesIncluded === true } : {}) };
  }

  return { request, requestScheduled, assertReady, assertScheduledReady,
    status, observe: evidence.observe, suppressTemperatureIngestion };
}

module.exports = { createSupervisedTemperatureTrial, parseTemperatureTrialOperation };
