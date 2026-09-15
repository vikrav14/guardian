'use strict';

const { parseTemperatureMode } = require('./wellness-routine');

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
    firmwareEvidence: { version: null, source: null, receivedAt: null,
      requestedAt: null, replyAt: null, replyState: 'no_version_reply' },
  };
}

function createHardwareEvidence() {
  const sessions = new WeakMap();
  function state(session) {
    if (!sessions.has(session)) sessions.set(session, emptyEvidence());
    return sessions.get(session);
  }
  function observe(decoded, session, at = new Date()) {
    if (!session || decoded?.error || !Array.isArray(decoded?.args) ||
        !['CONFIG', 'VERNO'].includes(decoded.command)) return;
    const current = state(session), receivedAt = at.toISOString();
    let version;
    if (decoded.command === 'CONFIG') {
      const mode = parseTemperatureMode(decoded);
      const btField = fieldStatus(decoded.args, 'BT'), tmField = fieldStatus(decoded.args, 'TM');
      current.configurationEvidence = {
        state: btField !== 'valid' ? `bt_field_${btField}` : mode.bt === 2 ? 'bt2_reported' : 'other_bt_reported',
        packets: Math.min(current.configurationEvidence.packets + 1, Number.MAX_SAFE_INTEGER),
        lastReceivedAt: receivedAt, btField, tmField,
      };
      const versions = decoded.args.filter(value => typeof value === 'string' && value.startsWith('VR:'));
      version = versions.length === 1 ? firmwareLabel(versions[0].slice(3)) : null;
    } else {
      version = decoded.args.length === 1 ? firmwareLabel(decoded.args[0]) : null;
      Object.assign(current.firmwareEvidence, { replyAt: receivedAt,
        replyState: version ? 'version_received' : decoded.args.length ? 'unsupported_reply' : 'empty_reply' });
    }
    if (version) Object.assign(current.firmwareEvidence,
      { version, source: decoded.command, receivedAt });
  }
  function requestVersion(session, at = new Date()) {
    Object.assign(state(session).firmwareEvidence,
      { requestedAt: at.toISOString(), replyAt: null, replyState: 'awaiting_reply' });
  }
  function current(session) {
    const value = session && sessions.get(session) || emptyEvidence();
    return { configurationEvidence: { ...value.configurationEvidence },
      firmwareEvidence: { ...value.firmwareEvidence } };
  }
  return { observe, requestVersion, current };
}

module.exports = { createHardwareEvidence };
