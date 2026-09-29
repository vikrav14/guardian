'use strict';

const crypto = require('node:crypto');
const { MovementError, movementAction } = require('./movement-reminder-policy');
const LEASE_MS = 60_000;

function publicMovementState(data, nowMs = Date.now()) {
  const value = data || {};
  const expired = value.status === 'sending' && value.leaseUntilMs <= nowMs;
  return { version: value.version || 0, requestId: value.requestId || null,
    action: value.action || (value.desired ? 'legacy_combined' : null),
    desired: value.desired || null, status: expired ? 'unconfirmed' : value.status || 'not_checked',
    reason: expired ? 'gateway_interrupted' : value.reason || null,
    evidence: value.evidence || [], requestedAt: value.requestedAt || null,
    appliedStateVerified: false, reminderBehaviourVerified: false };
}

function createMovementStore(db) {
  const settingsRef = imei => db.collection('movementReminderSettings').doc(imei);
  const requestRef = requestId => db.collection('movementReminderRequests').doc(requestId);
  async function read(imei, nowMs = Date.now()) {
    return publicMovementState((await settingsRef(imei).get()).data(), nowMs);
  }
  async function claim({ uid, imei, ownerUid, requestId, expectedVersion, settings, action, nowMs = Date.now() }) {
    movementAction(action);
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify({ uid, imei, settings, action })).digest('hex');
    return db.runTransaction(async tx => {
      const [previous, current] = await Promise.all([tx.get(requestRef(requestId)), tx.get(settingsRef(imei))]);
      if (previous.exists) {
        if (previous.data().fingerprint !== fingerprint) throw new MovementError('request_id_conflict');
        return { replay: true, state: publicMovementState(previous.data(), nowMs) };
      }
      const value = current.data() || {};
      if ((value.version || 0) !== expectedVersion) throw new MovementError('settings_changed');
      if (value.status === 'sending' && value.leaseUntilMs > nowMs) throw new MovementError('change_in_progress');
      // A crash may have sent some frames. The next enable must be preceded by
      // an explicit Off request; no background replay or delayed enable exists.
      if (!(action === 'switch' && !settings.enabled) && ['sending', 'unconfirmed'].includes(value.status)) {
        throw new MovementError('turn_off_before_retry');
      }
      // Preserve the other control's last requested values, not unsaved fields
      // from the current form. Missing fields mean never requested by Guardian.
      const desired = { ...(value.desired || {}), ...(action === 'switch'
        ? { enabled: settings.enabled, intervalMinutes: settings.intervalMinutes }
        : { start: settings.start, end: settings.end, timezone: settings.timezone }) };
      const state = { uid, imei, ownerUid, requestId, fingerprint, action, requestSettings: settings,
        version: (value.version || 0) + 1, desired, status: 'sending', reason: null,
        requestedAt: new Date(nowMs).toISOString(), leaseUntilMs: nowMs + LEASE_MS,
        evidence: [], appliedStateVerified: false, reminderBehaviourVerified: false };
      tx.set(requestRef(requestId), state);
      tx.set(settingsRef(imei), state);
      return { replay: false, state: publicMovementState(state, nowMs) };
    });
  }
  async function update({ imei, requestId, patch }) {
    return db.runTransaction(async tx => {
      const [current, request] = await Promise.all([tx.get(settingsRef(imei)), tx.get(requestRef(requestId))]);
      if (!request.exists || current.data()?.requestId !== requestId) throw new MovementError('operation_superseded');
      if (patch.nextCommand && current.data().leaseUntilMs <= Date.now()) {
        throw new MovementError('dispatch_window_expired');
      }
      tx.set(requestRef(requestId), patch, { merge: true });
      tx.set(settingsRef(imei), patch, { merge: true });
      return publicMovementState({ ...current.data(), ...patch });
    });
  }
  return { read, claim, update };
}

module.exports = { LEASE_MS, publicMovementState, createMovementStore };
