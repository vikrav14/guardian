'use strict';
const { EventEmitter } = require('node:events');
const { findSocketsForDevice } = require('./sessions');
const { buildMedicationSettingsFrame } = require('./medication-voice-codec');
const { MedicationError } = require('./medication-settings-policy');
const events = new EventEmitter();
function observeMedicationReply(decoded, socket, session) {
  if (!decoded.error && decoded.command === 'TAKEPILLS' && decoded.args?.length === 1
      && ['0', '1'].includes(decoded.args[0])) events.emit('reply', { decoded, socket, session });
}
function optionalCoordination() {
  // This PR is also reviewable on main. Runtime sending requires the combined
  // coordinator; never create a second gate unaware of an active camera lease.
  try { return require('./command-coordinator').commandCoordinator; }
  catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; return null; }
}
function createMedicationTransport({ find = findSocketsForDevice, replies = events,
  coordinator = optionalCoordination(), now = Date.now, timeoutMs = 10000, noteWrite } = {}) {
  const busy = new Set(), uncertain = new WeakSet();
  function select(imei) {
    const matches = find(imei);
    if (matches.length !== 1) throw new MedicationError(matches.length ? 'multiple_sessions' : 'watch_offline');
    const target = matches[0], s = target.session;
    if (s.imei !== imei || !/^\d{10}$/.test(s.protocolId || '') || target.socket.destroyed
        || target.socket.writable === false || !Number.isFinite(s.lastPacketAt)
        || now() - s.lastPacketAt > 300000) throw new MedicationError('watch_session_not_ready');
    return target;
  }
  function ready(imei, value) {
    const target = select(imei);
    if (!coordinator) throw new MedicationError('coordination_unavailable');
    if (busy.has(imei)) throw new MedicationError('change_in_progress');
    if (uncertain.has(target.socket) && value.enabled) throw new MedicationError('reconnect_required');
    const decision = coordinator.decide(imei, `TAKEPILLS,${value.time}-${value.enabled ? 1 : 0}-${value.frequency},${value.slot}`,
      { expiresAt: value.leaseUntilMs });
    if (!decision.ok) throw new MedicationError(decision.error);
    return target;
  }
  function bind(imei, value) {
    const target = select(imei), protocolId = target.session.protocolId;
    return { send(audio) {
      const current = ready(imei, value);
      if (current.socket !== target.socket || current.session !== target.session
          || target.session.protocolId !== protocolId) throw new MedicationError('session_changed');
      const frame = buildMedicationSettingsFrame({ ...value, protocolId, audio });
      const quarantine = uncertain.has(target.socket);
      busy.add(imei);
      return new Promise(resolve => {
        let done = false;
        const sentAt = new Date(now()).toISOString();
        const finish = (status, reason, reply = null) => {
          if (done) return; done = true; clearTimeout(timer); busy.delete(imei);
          replies.off('reply', onReply); target.socket.off('close', closed); target.socket.off('error', closed);
          if (status === 'unconfirmed') uncertain.add(target.socket);
          resolve({ status, reason, sentAt, replyAt: reply ? new Date(now()).toISOString() : null,
            replyCode: reply, bytes: frame.length, playbackVerified: false });
        };
        const closed = () => finish('unconfirmed', 'connection_interrupted');
        const onReply = e => {
          if (e.socket === target.socket && e.session === target.session && e.decoded.imei === protocolId
              && e.session.imei === imei && e.session.protocolId === protocolId) {
            // After an ambiguous command, a bare reply cannot identify an Off.
            if (quarantine) return;
            finish(e.decoded.args[0] === '1' ? 'reply_observed' : 'rejected',
              e.decoded.args[0] === '1' ? null : 'watch_rejected', e.decoded.args[0]);
          }
        };
        const timer = setTimeout(() => finish('unconfirmed', 'reply_timeout'), timeoutMs);
        replies.on('reply', onReply); target.socket.once('close', closed); target.socket.once('error', closed);
        try {
          if (noteWrite) noteWrite(target.socket, target.session, frame, 'medication_settings');
          target.socket.write(frame, error => { if (error) closed(); });
        } catch { closed(); }
      });
    } };
  }
  return { bind, ready, available: !!coordinator, connected: imei => { try { select(imei); return true; } catch { return false; } } };
}
let noteWrite;
try { noteWrite = require('./photo-command-timeline').noteDeviceWrite; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
const medicationTransport = createMedicationTransport({ noteWrite });
module.exports = { observeMedicationReply, createMedicationTransport, medicationTransport };
