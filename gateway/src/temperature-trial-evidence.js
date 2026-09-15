'use strict';

const { randomUUID } = require('node:crypto');

const CAPTURE_WINDOW_MS = 120_000;
const VALUE_RETENTION_MS = 10 * 60_000;
const MAX_PACKETS = 10;
const MAX_FIELDS = 8;
const MAX_FIELD_LENGTH = 16;
const MAX_PAYLOAD_BYTES = 160;
const HANDOFF_OUTCOMES = new Set(['command_handed_off', 'handoff_unknown', 'not_sent']);

function timestamp(value) {
  return value instanceof Date && Number.isFinite(+value) ? +value : null;
}

function safePayload(decoded) {
  if (decoded.error) return { accepted: false, reason: 'frame_rejected' };
  if (!Array.isArray(decoded.args)) return { accepted: false, reason: 'arguments_missing' };
  const argumentCount = Math.min(decoded.args.length, MAX_FIELDS + 1);
  if (decoded.args.length > MAX_FIELDS || decoded.args.some(value =>
    typeof value !== 'string' || value.length > MAX_FIELD_LENGTH)) {
    return { accepted: false, reason: 'arguments_exceed_limit', argumentCount };
  }
  if (typeof decoded.payload !== 'string' ||
      Buffer.byteLength(decoded.payload, 'utf8') > MAX_PAYLOAD_BYTES) {
    return { accepted: false, reason: 'payload_exceeds_limit', argumentCount };
  }
  if (decoded.payload !== [decoded.command, ...decoded.args].join(',')) {
    return { accepted: false, reason: 'payload_mismatch', argumentCount };
  }
  if (decoded.command === 'bodytemp2') {
    return decoded.args.length === 0
      ? { accepted: true, reason: 'bare_command_reply', argumentCount: 0 }
      : { accepted: false, reason: 'unexpected_reply_arguments', argumentCount };
  }
  if (!decoded.args.length) return { accepted: false, reason: 'upload_arguments_missing', argumentCount };
  // Preserve short numeric fields (including sentinel values) without deciding
  // their meaning. Arbitrary text, long identifiers and raw frames stay out.
  if (decoded.args.some(value => !/^[+-]?(?:\d{1,6}(?:\.\d{1,6})?|\.\d{1,6})$/.test(value))) {
    return { accepted: false, reason: 'numeric_fields_required', argumentCount };
  }
  return { accepted: true, reason: 'numeric_upload_observed', argumentCount,
    args: [...decoded.args] };
}

function createTemperatureTrialEvidence({ clock = Date.now } = {}) {
  let trial = null;

  function expireValues(at) {
    if (!trial || at < trial.valuesExpireAt) return;
    for (const packet of trial.packets) delete packet.args;
    trial.keys.clear();
    trial.valuesExpired = true;
  }

  function sameSession(session) {
    return session === trial?.session && session?.imei === trial?.sessionImei &&
      session?.protocolId === trial?.sessionProtocolId;
  }

  function phase(at) {
    if (!trial) return 'idle';
    if (trial.handoff === 'not_sent') return 'not_sent';
    if (trial.sessionChangedAt !== null) return 'session_changed';
    if (at >= trial.captureExpiresAt) return 'capture_timeout';
    return trial.packets.length ? 'observing' : 'waiting';
  }

  function current(session, { includeValues = false, at = new Date(clock()) } = {}) {
    const atMs = timestamp(at);
    if (atMs === null) throw new TypeError('A valid evidence inspection time is required.');
    // A caller supplying an older inspection timestamp cannot extend access
    // beyond the process clock's retention deadline.
    const checkedAt = Math.max(atMs, clock());
    expireValues(checkedAt);
    if (!trial) return { version: 1, phase: 'idle', outcome: 'no_trial', trialId: null,
      settingsConfirmed: false, wearingConfirmed: false, scheduleVerified: false };
    if (!sameSession(session) && trial.sessionChangedAt === null &&
        checkedAt < trial.captureExpiresAt && trial.handoff !== 'not_sent') {
      trial.sessionChangedAt = checkedAt;
    }
    const valuePhase = phase(checkedAt);
    let outcome = 'awaiting_reply_or_upload';
    if (trial.counts.uploads) outcome = 'upload_observed_after_request';
    else if (valuePhase === 'not_sent' || valuePhase === 'session_changed') outcome = valuePhase;
    else if (valuePhase === 'capture_timeout') outcome = trial.counts.replies ? 'reply_without_upload' : 'no_reply_or_upload';
    else if (trial.counts.replies) outcome = 'reply_received_awaiting_upload';
    const valuesIncluded = includeValues === true && !trial.valuesExpired &&
      checkedAt < trial.valuesExpireAt;
    return {
      version: 1, trialId: trial.trialId, phase: valuePhase, outcome,
      command: 'bodytemp2', handoff: trial.handoff,
      requestedAt: new Date(trial.requestedAt).toISOString(),
      captureExpiresAt: new Date(trial.captureExpiresAt).toISOString(),
      valuesExpireAt: new Date(trial.valuesExpireAt).toISOString(),
      sessionMatches: sameSession(session),
      sessionChangedAt: trial.sessionChangedAt === null ? null : new Date(trial.sessionChangedAt).toISOString(),
      operatorPosition: 'worn', operatorPositionIsManual: true,
      modeBtAtRequest: trial.modeBt, fieldMeaning: 'unverified', timeBasis: 'gateway_receipt',
      settingsConfirmed: false, wearingConfirmed: false, scheduleVerified: false,
      measurementConfirmed: false, requestCausedUpload: false,
      valuesIncluded, valuesExpired: trial.valuesExpired,
      counts: { ...trial.counts },
      packets: trial.packets.map(packet => {
        const { args, ...metadata } = packet;
        return { ...metadata, ...(valuesIncluded && args ? { args: [...args] } : {}) };
      }),
      interpretation: 'An upload received after the request is correlation only. Compare the watch result and timing; a bare reply does not prove measurement support or success.',
    };
  }

  function start(session, { requestedAt = new Date(clock()), trialId = randomUUID(),
    operatorPosition, modeBt = null } = {}) {
    const atMs = timestamp(requestedAt), now = clock();
    if (!session || typeof session !== 'object' || atMs === null || atMs > now ||
        operatorPosition !== 'worn' || ![null, 2].includes(modeBt) ||
        typeof trialId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(trialId)) {
      throw new TypeError('A session, valid request time, trial identifier and manually confirmed worn position are required.');
    }
    expireValues(now);
    if (trial && !['capture_timeout', 'session_changed', 'not_sent'].includes(phase(now))) {
      throw new Error('A temperature trial is already observing this request.');
    }
    trial = { session, sessionImei: session.imei, sessionProtocolId: session.protocolId,
      requestedAt: atMs, trialId, modeBt, captureExpiresAt: atMs + CAPTURE_WINDOW_MS,
      valuesExpireAt: atMs + CAPTURE_WINDOW_MS + VALUE_RETENTION_MS,
      handoff: 'pending', sessionChangedAt: null, valuesExpired: false,
      packets: [], keys: new Set(), counts: { replies: 0, uploads: 0, rejected: 0, duplicates: 0, dropped: 0 } };
    return current(session, { at: new Date(now) });
  }

  function markHandoff(outcome) {
    if (!trial || !HANDOFF_OUTCOMES.has(outcome)) throw new TypeError('A known temperature handoff outcome is required.');
    if (trial.handoff !== 'pending') throw new Error('The temperature handoff outcome was already recorded.');
    trial.handoff = outcome;
  }

  function observe(decoded, session, at = new Date(clock())) {
    const now = clock(), atMs = timestamp(at);
    expireValues(now);
    if (!trial || !sameSession(session) || trial.sessionChangedAt !== null ||
        trial.handoff === 'not_sent' || atMs === null || atMs > now ||
        atMs < trial.requestedAt || atMs >= trial.captureExpiresAt ||
        now >= trial.captureExpiresAt || !['bodytemp2', 'btemp2'].includes(decoded?.command)) return;
    const safe = safePayload(decoded);
    const key = JSON.stringify([atMs, decoded.command, safe.reason, safe.args || null]);
    if (trial.keys.has(key)) {
      trial.counts.duplicates = Math.min(trial.counts.duplicates + 1, Number.MAX_SAFE_INTEGER);
      return;
    }
    if (trial.packets.length >= MAX_PACKETS) {
      trial.counts.dropped = Math.min(trial.counts.dropped + 1, Number.MAX_SAFE_INTEGER);
      return;
    }
    trial.keys.add(key);
    trial.packets.push({ command: decoded.command,
      kind: decoded.command === 'bodytemp2' ? 'command_reply' : 'temperature_upload',
      receivedAt: at.toISOString(), timeBasis: 'gateway_receipt', fieldMeaning: 'unverified',
      ...safe });
    if (!safe.accepted) trial.counts.rejected += 1;
    else if (decoded.command === 'bodytemp2') trial.counts.replies += 1;
    else trial.counts.uploads += 1;
  }

  return { start, observe, markHandoff, current };
}

module.exports = { createTemperatureTrialEvidence, CAPTURE_WINDOW_MS, VALUE_RETENTION_MS,
  MAX_PACKETS, MAX_FIELDS, MAX_FIELD_LENGTH, MAX_PAYLOAD_BYTES };
