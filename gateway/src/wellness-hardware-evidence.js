'use strict';

const { parseTemperatureMode } = require('./wellness-routine');
const REPLY_WINDOW_MS = 120_000;

function replyDetails(args) {
  // Inspect only the requested VERNO reply, never CONFIG, health or location
  // payloads. Bound and redact before keeping anything in session memory.
  const values = args.slice(0, 8).map(value => String(value).slice(0, 1024)
    .replace(/\b(?:imei|imsi|iccid|phone|pw|password|apn|ip|server|token|key)\s*[:=].*/gi, '[redacted field]')
    .replace(/\b(?:https?|tcp):\/\/[^\s,]+/gi, '[redacted address]')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[redacted email]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, '[redacted address]')
    .replace(/\+?\d{10,}/g, '[redacted identifier]')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '[control]')
    .slice(0, 256));
  return { argumentCount: args.length, arguments: values,
    truncated: args.length > 8 || args.some(value => String(value).length > 256) };
}

function fieldStatus(args, key) {
  const fields = args.filter(value => typeof value === 'string')
    .map(value => value.trim()).filter(value => value.startsWith(`${key}:`));
  if (!fields.length) return 'missing';
  if (fields.length > 1) return 'duplicate';
  return new RegExp(`^${key}:[0-9]$`).test(fields[0]) ? 'valid' : 'invalid';
}

function firmwareLabel(value) {
  // Only a bounded version label, never an arbitrary CONFIG field or payload.
  return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_.+-]{1,159}$/.test(value) &&
    !/\d{10,}/.test(value) ? value : null;
}

function emptyEvidence() {
  return {
    configurationEvidence: { state: 'no_config_received', packets: 0, lastReceivedAt: null,
      btField: 'not_observed', tmField: 'not_observed' },
    firmwareEvidence: { version: null, versionLabels: [], source: null, receivedAt: null,
      requestedAt: null, replyAt: null, replyState: 'no_version_reply' },
  };
}

function createHardwareEvidence() {
  const sessions = new WeakMap();
  const captures = new WeakMap();
  function state(session) {
    if (!sessions.has(session)) sessions.set(session, emptyEvidence());
    return sessions.get(session);
  }
  function observe(decoded, session, at = new Date()) {
    if (!session || decoded?.error || !Array.isArray(decoded?.args) ||
        !['CONFIG', 'VERNO'].includes(decoded.command)) return;
    const current = state(session), receivedAt = at.toISOString();
    let versionLabels = [];
    if (decoded.command === 'CONFIG') {
      const mode = parseTemperatureMode(decoded);
      const btField = fieldStatus(decoded.args, 'BT'), tmField = fieldStatus(decoded.args, 'TM');
      current.configurationEvidence = {
        state: btField !== 'valid' ? `bt_field_${btField}` : mode.bt === 2 ? 'bt2_reported' : 'other_bt_reported',
        packets: Math.min(current.configurationEvidence.packets + 1, Number.MAX_SAFE_INTEGER),
        lastReceivedAt: receivedAt, btField, tmField,
      };
      const versions = decoded.args.filter(value => typeof value === 'string' && value.startsWith('VR:'));
      const version = versions.length === 1 ? firmwareLabel(versions[0].slice(3)) : null;
      if (version) versionLabels = [version];
    } else {
      // The real V52 VERNO reply contains two labels. Preserve wire order;
      // neither label is assumed to mean modem/application or to establish BT.
      if (decoded.args.length >= 1 && decoded.args.length <= 2 && decoded.args.every(firmwareLabel)) {
        versionLabels = [...decoded.args];
      }
      Object.assign(current.firmwareEvidence, { replyAt: receivedAt,
        replyState: versionLabels.length ? 'version_received' : decoded.args.length ? 'unsupported_reply' : 'empty_reply' });
      const capture = captures.get(session);
      if (capture && +at >= capture.startedAt && +at < capture.expiresAt && !capture.details) {
        capture.details = { receivedAt, ...replyDetails(decoded.args),
          parserReason: versionLabels.length ? 'accepted_version_labels' : decoded.args.length === 0 ? 'no_arguments'
            : decoded.args.length > 2 ? 'expected_one_or_two_arguments' : 'version_label_format_rejected' };
      } else if (capture && +at >= capture.expiresAt) captures.delete(session);
    }
    if (versionLabels.length) Object.assign(current.firmwareEvidence,
      { version: versionLabels.length === 1 ? versionLabels[0] : null,
        versionLabels, source: decoded.command, receivedAt });
  }
  function requestVersion(session, at = new Date(), { includeReply = false } = {}) {
    captures.delete(session);
    if (includeReply === true) captures.set(session,
      { startedAt: +at, expiresAt: +at + REPLY_WINDOW_MS, details: null });
    Object.assign(state(session).firmwareEvidence,
      { requestedAt: at.toISOString(), replyAt: null, replyState: 'awaiting_reply' });
  }
  function current(session, at = new Date()) {
    const value = session && sessions.get(session) || emptyEvidence();
    let capture = session && captures.get(session);
    if (capture && +at >= capture.expiresAt) { captures.delete(session); capture = null; }
    return { configurationEvidence: { ...value.configurationEvidence },
      firmwareEvidence: { ...value.firmwareEvidence,
        versionLabels: [...value.firmwareEvidence.versionLabels],
        ...(capture ? { replyCaptureExpiresAt: new Date(capture.expiresAt).toISOString(),
          replyDetails: capture.details ? { ...capture.details, arguments: [...capture.details.arguments] } : null } : {}) } };
  }
  return { observe, requestVersion, current };
}

module.exports = { createHardwareEvidence };
