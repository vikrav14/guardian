'use strict';

const { randomUUID } = require('node:crypto');
const { validConsent } = require('./care-wellbeing');

const OPTICAL_WINDOW_MS = 120_000;
const VALUE_RETENTION_MS = 10 * 60_000;
const CONTEXT_TIMEOUT_MS = 5000;

function parseConditionalWellnessOperation(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
      Object.keys(payload).some(key => !['action', 'operatorPosition', 'commandCase'].includes(key)) ||
      payload.action !== 'single' ||
      !['worn', 'removed'].includes(payload.operatorPosition) ||
      (Object.hasOwn(payload, 'commandCase') && payload.commandCase !== 'uppercase')) {
    throw new Error('Use action single with operatorPosition worn or removed; commandCase, if supplied, must be uppercase.');
  }
  return { action: 'single', operatorPosition: payload.operatorPosition, commandCase: 'uppercase' };
}

function strictInteger(value, min, max) {
  if (typeof value !== 'string' || !/^\d{1,3}$/.test(value)) return null;
  const number = Number(value);
  return number >= min && number <= max ? number : null;
}

// These are transport bounds, not normal-health ranges or a contact detector.
// Preserve the exact observed bphrt three-field/seven-field variant only.
function opticalResult(decoded) {
  const { command, args, payload } = decoded;
  if (decoded.error || !Array.isArray(args) || typeof payload !== 'string' ||
      payload.length > 160 || payload !== [command, ...args].join(',')) return null;
  if (command === 'bphrt') {
    if (![3, 7].includes(args.length) || args.slice(3).some(value => value !== '')) return null;
    const systolicMmHg = strictInteger(args[0], 40, 300);
    const diastolicMmHg = strictInteger(args[1], 20, 200);
    const heartRateBpm = strictInteger(args[2], 20, 250);
    if (systolicMmHg === null || diastolicMmHg === null || heartRateBpm === null ||
        systolicMmHg <= diastolicMmHg) return null;
    return { systolicMmHg, diastolicMmHg, heartRateBpm };
  }
  if (command === 'oxygen') {
    if (args.length !== 2 || !['0', '1'].includes(args[0])) return null;
    const spo2Percent = strictInteger(args[1], 1, 100);
    return spo2Percent === null ? null : { spo2Percent };
  }
  return null;
}

function createConditionalWellnessTrial({ config, currentSession, readContext,
  sendOptical, temperatureTrial, clock = Date.now, uuid = randomUUID }) {
  if (!temperatureTrial || ['assertReady', 'request', 'status'].some(key =>
    typeof temperatureTrial[key] !== 'function')) {
    throw new TypeError('A temperature trial with readiness, request and status is required.');
  }
  let sequence = null, preparing = false, lockUntil = 0, generation = 0;
  const enabled = () => config.wellnessRoutineEnabled === true &&
    config.careWellbeingRequestEnabled === true &&
    config.careWellbeingIngestEnabled === true;
  const contextAllowed = (context, scheduled = false) => enabled() && validConsent(context?.consent, new Date(clock())) &&
    (scheduled ? context?.request?.version === 2 && ['gentle', 'balanced'].includes(context.request.routine)
      : !context?.request?.routine || context.request.routine === 'manual') &&
    context?.state?.mayBeRunning !== true && context?.state?.temperatureMayBeRunning !== true;

  function boundedOperation(operation) {
    let timer;
    return Promise.race([
      Promise.resolve().then(operation),
      new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('context_unavailable')), CONTEXT_TIMEOUT_MS);
      }),
    ]).finally(() => clearTimeout(timer));
  }
  const boundedContext = () => boundedOperation(readContext);

  function assertTemperatureReady(session, scheduled) {
    if (scheduled) {
      if (typeof temperatureTrial.assertScheduledReady !== 'function' ||
          typeof temperatureTrial.requestScheduled !== 'function') {
        throw new Error('Scheduled temperature support is unavailable.');
      }
      return temperatureTrial.assertScheduledReady({ expectedSession: session });
    }
    return temperatureTrial.assertReady({ expectedSession: session });
  }

  function matches(attempt, session = currentSession()) {
    return Boolean(session && session === attempt.session &&
      session.imei === attempt.sessionImei && session.protocolId === attempt.sessionProtocolId);
  }

  function finish(attempt, reason, outcome = 'temperature_skipped') {
    if (!attempt || attempt.terminal) return;
    attempt.phase = 'skipped';
    attempt.outcome = outcome;
    attempt.reason = reason;
    attempt.terminal = true;
  }

  function refresh() {
    const attempt = sequence;
    if (!attempt) return;
    const at = clock();
    if (at >= attempt.valuesExpireAt) {
      for (const record of Object.values(attempt.optical)) if (record) delete record.values;
    }
    if (attempt.terminal) return;
    if (at < attempt.requestedAt) finish(attempt, 'clock_changed');
    else if (!enabled()) finish(attempt, 'routine_disabled');
    else if (!matches(attempt)) finish(attempt, 'session_changed',
      attempt.temperature ? 'temperature_capture_ended' : 'temperature_skipped');
    else if (attempt.phase !== 'waiting_temperature' && at >= attempt.opticalDeadlineAt) {
      finish(attempt, 'optical_timeout');
    } else if (attempt.phase === 'waiting_temperature' && at >= attempt.lockUntil) {
      finish(attempt, 'temperature_timeout', 'temperature_capture_ended');
    }
  }

  function isBusy() {
    refresh();
    return preparing || clock() < lockUntil || Boolean(sequence && !sequence.terminal);
  }

  function safeSummary(attempt, includeValues = false) {
    if (!attempt) return null;
    const valuesAllowed = includeValues && clock() < attempt.valuesExpireAt;
    const record = value => value ? { receivedAt: value.receivedAt, usable: value.usable,
      ...(valuesAllowed && value.values ? { values: { ...value.values } } : {}) } : null;
    return { attemptId: attempt.attemptId, phase: attempt.phase, outcome: attempt.outcome,
      terminal: attempt.terminal, operatorPosition: attempt.operatorPosition,
      positionBasis: attempt.positionBasis, requestedAt: new Date(attempt.requestedAt).toISOString(),
      opticalDeadlineAt: new Date(attempt.opticalDeadlineAt).toISOString(),
      cooldownUntil: new Date(attempt.lockUntil).toISOString(),
      optical: { heartBloodPressure: record(attempt.optical.heartBloodPressure),
        oxygen: record(attempt.optical.oxygen) },
      temperature: attempt.temperature ? { ...attempt.temperature } : null,
      ...(attempt.reason ? { reason: attempt.reason } : {}),
      temperatureCommand: 'BODYTEMP2', automaticRetry: false,
      readingConfirmed: false, wearingConfirmed: false, scheduleVerified: false,
      timeBasis: 'gateway_receipt', correlationOnly: true };
  }

  async function execute(operation, isCurrent) {
    const scheduled = operation.positionBasis === 'scheduled';
    if (!enabled()) throw new Error('Wellness routine, request and ingestion must be enabled.');
    if (scheduled && clock() >= operation.startDeadlineAt) {
      throw new Error('The scheduled start window has ended; nothing sent.');
    }
    if (isBusy()) throw new Error('A sequence or its capture cooldown is active; inspect it before another request.');
    const session = currentSession();
    if (!session || session.imei !== config.wifiHomePilotImei) {
      throw new Error('One connected configured pilot session is required.');
    }
    assertTemperatureReady(session, scheduled);
    const preparation = ++generation;
    const protocolId = session.protocolId;
    preparing = true;
    try {
      const context = await boundedContext();
      if (scheduled && await boundedOperation(isCurrent) !== true) {
        throw new Error('The scheduled reading is no longer authorized; nothing sent.');
      }
      if (generation !== preparation) throw new Error('The sequence was cancelled; nothing sent.');
      if (!contextAllowed(context, scheduled)) {
        throw new Error('Current consent, enabled routine and an authorized schedule with no possibly running native routine are required.');
      }
      if (currentSession() !== session || session.imei !== config.wifiHomePilotImei || session.protocolId !== protocolId) {
        throw new Error('The pilot session changed; nothing sent.');
      }
      assertTemperatureReady(session, scheduled);
      const at = clock();
      if (scheduled && at >= operation.startDeadlineAt) {
        throw new Error('The scheduled start window has ended; nothing sent.');
      }
      const attempt = { attemptId: uuid(), session, sessionImei: session.imei,
        sessionProtocolId: session.protocolId, operatorPosition: operation.operatorPosition,
        positionBasis: operation.positionBasis, isCurrent,
        requestedAt: at, opticalDeadlineAt: at + OPTICAL_WINDOW_MS,
        lockUntil: at + OPTICAL_WINDOW_MS,
        valuesExpireAt: at + OPTICAL_WINDOW_MS + VALUE_RETENTION_MS,
        phase: 'waiting_optical', outcome: 'awaiting_optical_uploads', terminal: false,
        optical: { heartBloodPressure: null, oxygen: null }, temperature: null,
        handoff: 'pending' };
      sequence = attempt;
      lockUntil = attempt.opticalDeadlineAt;
      let outcome;
      try {
        const result = sendOptical('hrtstart,1');
        outcome = result?.ok === true ? 'optical_request_handed_off' : 'optical_not_sent';
      } catch { outcome = 'optical_handoff_unknown'; }
      attempt.handoff = outcome;
      if (outcome !== 'optical_request_handed_off') finish(attempt, outcome, outcome);
      else queueTemperature(attempt);
      return { outcome, attemptId: attempt.attemptId,
        requestedAt: new Date(at).toISOString(), opticalDeadlineAt: new Date(attempt.opticalDeadlineAt).toISOString(),
        operatorPosition: attempt.operatorPosition, positionBasis: attempt.positionBasis,
        automaticRetry: false, readingConfirmed: false, wearingConfirmed: false, scheduleVerified: false };
    } finally { preparing = false; }
  }

  async function request(payload) {
    return execute({ ...parseConditionalWellnessOperation(payload), positionBasis: 'operator_reported' });
  }

  async function requestScheduled({ isCurrent, startDeadlineAt } = {}) {
    if (typeof isCurrent !== 'function' || typeof startDeadlineAt !== 'number' || !Number.isFinite(startDeadlineAt)) {
      throw new TypeError('A trusted current-schedule guard and finite start deadline are required.');
    }
    return execute({ operatorPosition: 'unknown', positionBasis: 'scheduled', startDeadlineAt }, isCurrent);
  }

  function eligible(attempt) {
    refresh();
    return sequence === attempt && !attempt.terminal && enabled() && matches(attempt) &&
      clock() >= attempt.requestedAt && clock() < attempt.opticalDeadlineAt &&
      attempt.optical.heartBloodPressure?.usable === true && attempt.optical.oxygen?.usable === true;
  }

  async function dispatchTemperature(attempt) {
    try {
      const context = await boundedContext();
      if (!eligible(attempt)) return;
      const scheduled = attempt.positionBasis === 'scheduled';
      if (!contextAllowed(context, scheduled)) { finish(attempt, 'consent_or_routine_changed'); return; }
      assertTemperatureReady(attempt.session, scheduled);
      if (!eligible(attempt)) return;
      const guard = { expectedSession: attempt.session, shouldSend: () => eligible(attempt) };
      const result = scheduled
        ? await temperatureTrial.requestScheduled({ ...guard, isCurrent: attempt.isCurrent })
        : await temperatureTrial.request({ action: 'single',
          operatorPosition: attempt.operatorPosition, commandCase: 'uppercase' }, guard);
      if (sequence !== attempt) return;
      // The helper may have handed off a command. Always retain that fact even
      // if a later observation cancels the sequence; never retry this branch.
      attempt.temperature = { trialId: result.trialId || null, handoff: result.outcome,
        requestedAt: result.requestedAt || null,
        temperatureIngestionSuppressed: result.temperatureIngestionSuppressed === true };
      const temperatureAt = +new Date(result.requestedAt);
      if (Number.isFinite(temperatureAt)) {
        lockUntil = Math.max(lockUntil, temperatureAt + OPTICAL_WINDOW_MS);
        attempt.lockUntil = lockUntil;
        attempt.valuesExpireAt = lockUntil + VALUE_RETENTION_MS;
      }
      if (result.outcome === 'command_handed_off') {
        if (!attempt.terminal) {
          attempt.phase = 'waiting_temperature';
          attempt.outcome = 'temperature_requested';
        }
      } else finish(attempt, result.outcome === 'handoff_unknown' ? 'temperature_handoff_unknown' : 'temperature_not_sent',
        result.outcome === 'handoff_unknown' ? 'temperature_handoff_unknown' : 'temperature_skipped');
    } catch {
      finish(attempt, 'temperature_preflight_failed');
    }
  }

  function queueTemperature(attempt) {
    if (attempt.phase !== 'waiting_optical' || attempt.handoff !== 'optical_request_handed_off' || !eligible(attempt)) return;
    attempt.phase = 'preparing_temperature';
    attempt.outcome = 'checking_temperature_readiness';
    // Never await Firestore or a temperature request in the packet/ACK path.
    void dispatchTemperature(attempt);
  }

  function observe(decoded, session) {
    refresh();
    const attempt = sequence;
    if (!attempt || attempt.terminal || !matches(attempt, session) ||
        !matches(attempt) || !decoded || decoded.imei !== attempt.sessionProtocolId) return;
    const command = decoded.command;
    if (!decoded.error && /^(?:UD(?:_LTE)?|AL(?:_LTE)?)$/.test(command || '') &&
        Array.isArray(decoded.args) && /^[0-9A-Fa-f]{8}$/.test(decoded.args[15] || '') &&
        (parseInt(decoded.args[15], 16) & (1 << 20)) !== 0) {
      finish(attempt, 'removal_reported', attempt.temperature ? 'temperature_capture_ended' : 'temperature_skipped');
      return;
    }
    if (!['waiting_optical', 'preparing_temperature'].includes(attempt.phase) ||
        !['bphrt', 'oxygen'].includes(command)) return;
    const key = command === 'bphrt' ? 'heartBloodPressure' : 'oxygen';
    const values = opticalResult(decoded);
    attempt.optical[key] = { receivedAt: new Date(clock()).toISOString(), usable: values !== null,
      ...(values ? { values } : {}) };
    if (!values) { finish(attempt, command === 'bphrt' ? 'unusable_heart_bp' : 'unusable_oxygen'); return; }
    queueTemperature(attempt);
  }

  function cancel(reason = 'operator_cancelled') {
    generation += 1;
    const allowed = new Set(['operator_cancelled', 'routine_changed', 'removal_setting_changed',
      'gateway_stopping', 'gateway_stopped', 'external_stop_requested']);
    finish(sequence, allowed.has(reason) ? reason : 'operator_cancelled',
      sequence?.temperature ? 'temperature_capture_ended' : 'temperature_skipped');
    return safeSummary(sequence);
  }

  async function status({ includeValues = false } = {}) {
    refresh();
    const attempt = sequence;
    if (!attempt) return { outcome: 'read_only', connected: Boolean(currentSession()), sequence: null };
    let valuesAllowed = false;
    if (includeValues === true && enabled()) {
      try { valuesAllowed = validConsent((await boundedContext())?.consent, new Date(clock())) && enabled(); }
      catch { /* Metadata remains available; health values stay hidden. */ }
    }
    refresh();
    let temperatureStatus = null;
    if (attempt.temperature?.trialId) {
      try {
        const result = await temperatureTrial.status({ includeValues: valuesAllowed });
        if (result?.trial?.trialId === attempt.temperature.trialId) temperatureStatus = result.trial;
      } catch { /* The request is never resent after a status error. */ }
    }
    refresh();
    if ((!attempt.terminal && attempt.phase === 'waiting_temperature') || attempt.reason === 'temperature_timeout') {
      if (temperatureStatus?.outcome === 'upload_observed_after_request') {
        attempt.phase = 'complete'; attempt.outcome = 'temperature_upload_observed'; attempt.terminal = true;
        delete attempt.reason;
      } else if (temperatureStatus?.phase === 'session_changed') finish(attempt, 'session_changed', 'temperature_capture_ended');
      else if (clock() >= attempt.lockUntil || temperatureStatus?.phase === 'capture_timeout') {
        finish(attempt, 'temperature_timeout', 'temperature_capture_ended');
      }
    }
    const summary = safeSummary(attempt, valuesAllowed);
    if (summary.temperature && temperatureStatus) summary.temperature.trial = temperatureStatus;
    return { outcome: 'read_only', connected: Boolean(currentSession()), sequence: summary };
  }

  return { request, requestScheduled, status, observe, isBusy, cancel };
}

module.exports = { createConditionalWellnessTrial, parseConditionalWellnessOperation,
  OPTICAL_WINDOW_MS, VALUE_RETENTION_MS };
