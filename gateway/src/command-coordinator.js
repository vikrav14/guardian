'use strict';

// This gate never stores a frame, credential, or action to replay. Callers may
// retry only by resolving a still-authorized intent against the current session.
const { MAX_CAPTURE_WINDOW_MS: CAMERA_WINDOW_MS } = require('./photo-capture-window');
function promptCommand(command, { protocolReply = false, emergency = false } = {}) {
  if (protocolReply || emergency) return true;
  return /^(CR|CALL|MONITOR|FIND)(?:,|$)/i.test(command) ||
    /^TAKEPILLS,\d{2}:\d{2}-0-[123](?:-|,)/i.test(command) ||
    /^(HRTSTART|BODYTEMP|BODYTEMP2|SEDENTARY|REMOVE|FALLDOWN|FON|PEDO),0(?:,|$)/i.test(command);
}

function createCommandCoordinator({ now = Date.now } = {}) {
  const captures = new Map();
  const voices = new Map();
  function active(imei) {
    const lease = captures.get(imei);
    if (lease && (lease.expiresAt <= now() || lease.socket.destroyed)) {
      captures.delete(imei);
      return null;
    }
    return lease || null;
  }
  function decide(imei, command, options = {}) {
    if (options.expiresAt != null && now() >= +options.expiresAt) {
      return { ok: false, status: 'expired', error: 'command_expired' };
    }
    const lease = active(imei);
    if (lease && !promptCommand(command, options)) {
      return { ok: false, status: 'skipped', error: 'camera_busy', expiresAt: lease.expiresAt };
    }
    const voice = voices.get(imei);
    if (voice && (voice.expiresAt <= now() || voice.socket.destroyed)) voices.delete(imei);
    else if (voice && !promptCommand(command, options) && !/^RCAPTURE(?:,|$)/i.test(command)) {
      return { ok: false, status: 'skipped', error: 'voice_busy', expiresAt: voice.expiresAt };
    }
    return { ok: true, status: 'ready' };
  }
  function beginCapture({ imei, id, socket, expiresAt }) {
    if (active(imei)) return { ok: false, error: 'camera_busy' };
    const deadline = Math.min(+expiresAt, now() + CAMERA_WINDOW_MS);
    if (!Number.isFinite(deadline) || deadline <= now() || socket.destroyed || socket.writable === false) {
      return { ok: false, error: 'dispatch_expired_or_disconnected' };
    }
    captures.set(imei, { id, socket, expiresAt: deadline });
    return { ok: true, expiresAt: deadline };
  }
  function finishCapture(imei, id) {
    if (captures.get(imei)?.id === id) captures.delete(imei);
  }
  function disconnect(socket) {
    for (const [imei, lease] of captures) if (lease.socket === socket) captures.delete(imei);
    for (const [imei, lease] of voices) if (lease.socket === socket) voices.delete(imei);
  }
  function beginVoice({ imei, id, socket, expiresAt }) {
    const decision = decide(imei, 'TK', { expiresAt });
    if (!decision.ok) return decision;
    if (socket.destroyed || socket.writable === false) return { ok: false, error: 'watch_offline' };
    voices.set(imei, { id, socket, expiresAt: Math.min(+expiresAt, now() + 10000) });
    return { ok: true };
  }
  function finishVoice(imei, id) { if (voices.get(imei)?.id === id) voices.delete(imei); }
  return { decide, beginCapture, finishCapture, disconnect,
    beginVoice, finishVoice,
    busyUntil: imei => active(imei)?.expiresAt || null };
}
const commandCoordinator = createCommandCoordinator();
module.exports = { createCommandCoordinator, commandCoordinator, promptCommand, CAMERA_WINDOW_MS };
