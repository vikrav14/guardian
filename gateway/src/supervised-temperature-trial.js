'use strict';

const { randomUUID } = require('node:crypto');
const { validConsent } = require('./care-wellbeing');
const { createTemperatureTrialEvidence } = require('./temperature-trial-evidence');

function parseTemperatureTrialOperation(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
      Object.keys(payload).some(key => !['action', 'operatorPosition', 'commandCase'].includes(key)) ||
      payload.action !== 'single' ||
      (Object.hasOwn(payload, 'commandCase') && !['lowercase', 'uppercase'].includes(payload.commandCase)) ||
      payload.operatorPosition !== 'worn') {
    throw new Error('Use action single with operatorPosition worn; optional commandCase must be lowercase or uppercase.');
  }
  return { action: 'single', operatorPosition: 'worn',
    ...(Object.hasOwn(payload, 'commandCase') ? { commandCase: payload.commandCase } : {}) };
}

// Separate strict-admin experiment. CONFIG is not a required handshake in the
// supplier's single-measurement example. Missing BT permits this explicit probe,
// never a customer routine or a stored claim that BT=2 / worn was established.
function createSupervisedTemperatureTrial({ config, readContext, currentSession,
  send, clock = Date.now }) {
  const evidence = createTemperatureTrialEvidence({ clock });
  let busy = false, lastAttemptAt = null;
  const enabled = () => config.wellnessRoutinePilotEnabled === true &&
    config.careWellbeingRequestEnabled === true && config.careWellbeingIngestEnabled === true;

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

  async function request(payload) {
    const operation = parseTemperatureTrialOperation(payload);
    // Uppercase is an explicitly selected protocol-family comparison. Never
    // fall back between spellings or change customer routine command builders.
    const command = operation.commandCase === 'uppercase' ? 'BODYTEMP2' : 'bodytemp2';
    if (!enabled()) throw new Error('Pilot, wellbeing request and ingestion must be enabled.');
    if (busy) throw new Error('A temperature test is already being prepared.');
    if (lastAttemptAt !== null && clock() - lastAttemptAt < 120_000) {
      throw new Error('Wait two minutes before another temperature test; inspect the existing result first.');
    }
    const initialSession = preflightSession();
    busy = true;
    try {
      const { consent, request: routineRequest, state } = await readContext();
      if (!enabled() || !validConsent(consent, new Date(clock()))) {
        throw new Error('Current wearer consent and enabled pilot ingestion are required.');
      }
      if ((routineRequest?.routine && routineRequest.routine !== 'manual') ||
          state?.mayBeRunning === true || state?.temperatureMayBeRunning === true) {
        throw new Error('Select Manual and resolve any possibly running routine before this test.');
      }
      const session = preflightSession();
      if (session !== initialSession) throw new Error('The watch session changed during preparation; nothing sent.');
      const requestedAt = new Date(clock()), trialId = randomUUID();
      lastAttemptAt = +requestedAt;
      evidence.start(session, { requestedAt, trialId, operatorPosition: 'worn', command,
        modeBt: session.wellnessTemperatureMode?.bt ?? session.wellnessLastReportedTemperatureBt ?? null });
      let outcome;
      try {
        const result = send(command);
        outcome = result?.ok === true ? 'command_handed_off' : 'not_sent';
      } catch {
        // A failed response is not permission to send the measurement again.
        outcome = 'handoff_unknown';
      }
      evidence.markHandoff(outcome);
      return { outcome, trialId, command, requestedAt: requestedAt.toISOString(),
        operatorPosition: 'worn', positionBasis: 'operator_reported',
        captureWindowSeconds: 120, automaticRetry: false,
        readingConfirmed: false, wearingConfirmed: false, scheduleVerified: false };
    } finally { busy = false; }
  }

  async function status({ includeValues = false } = {}) {
    // Metadata is always available to strict admin; health values require
    // explicit opt-in and a fresh consent read, including after revocation.
    let valuesAllowed = false;
    if (includeValues === true && enabled()) {
      const { consent } = await readContext();
      valuesAllowed = validConsent(consent, new Date(clock()));
    }
    const session = currentSession();
    const trial = evidence.current(session, { includeValues: valuesAllowed });
    return { outcome: 'read_only', connected: Boolean(session),
      trial, ...(includeValues ? { valuesIncluded: trial.valuesIncluded === true } : {}) };
  }

  return { request, status, observe: evidence.observe };
}

module.exports = { createSupervisedTemperatureTrial, parseTemperatureTrialOperation };
