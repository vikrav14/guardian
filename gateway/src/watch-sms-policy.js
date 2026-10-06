'use strict';

// Fixed product policy, not a user setting. The supplier's on/off comparison
// verified this switch and its bare reply; neither proves carrier SMS suppression.
const SMS_OFF_COMMAND = 'SMSONOFF,0';
const INTENT_MS = 300_000;
const FRESH_MS = 30_000;
const CHECK_MS = 5_000;

function disallowedSmsCommand(command) {
  return /^SMSONOFF(?:\s|,|$)/i.test(String(command).trim()) && command !== SMS_OFF_COMMAND;
}

function matchingIdentity(decoded, session) {
  if (!decoded || decoded.error || !['3G', 'SG', 'CS'].includes(decoded.factory)) return false;
  if (!/^\d{15}$/.test(session?.imei) || !/^\d{10}$/.test(session?.protocolId)) return false;
  return session.imei.slice(4, 14) === session.protocolId &&
    (decoded.imei === session.protocolId || decoded.imei === session.imei);
}

function createWatchSmsPolicy({
  now = Date.now,
  findSessions = id => require('./sessions').findSocketsForDevice(id),
  getSession = socket => require('./sessions').getSession(socket),
  send = (...args) => require('./downlink').sendDownlinkCommand(...args),
  schedule = setTimeout, cancel = clearTimeout,
  log = value => console.info('[watch-sms-policy] ' + JSON.stringify(value)),
} = {}) {
  const entries = new WeakMap();
  let nextSession = 0;
  function update(entry, status, reason = null) {
    const previous = entry.session.watchSmsPolicy;
    entry.session.watchSmsPolicy = { desired: 'off', status, reason,
      startedAt: entry.startedAt, expiresAt: entry.expiresAt,
      handedOffAt: entry.handedOffAt || null, replyAt: entry.replyAt || null,
      suppressionVerified: false };
    if (previous?.status !== status || previous?.reason !== reason) {
      log({ at: new Date(now()).toISOString(), session: entry.alias, status, reason });
    }
  }
  function clear(entry) {
    if (entry.timer != null) cancel(entry.timer);
    entry.timer = null;
  }
  function finish(entry, status, reason) {
    entry.terminal = true;
    clear(entry);
    update(entry, status, reason);
  }
  function later(entry, delay = 0) {
    if (entry.terminal || entry.timer != null) return;
    entry.timer = schedule(() => { entry.timer = null; reconcile(entry); }, delay);
    entry.timer?.unref?.();
  }
  function reconcile(entry) {
    if (entry.terminal) return;
    const { socket, session } = entry;
    if (getSession(socket) !== session || socket.destroyed || socket.writable === false) {
      return finish(entry, 'skipped', 'session_closed');
    }
    if (session.imei !== entry.imei || session.protocolId !== entry.protocolId) {
      return finish(entry, 'skipped', 'identity_changed');
    }
    if (now() >= entry.expiresAt) return finish(entry, 'expired', 'intent_expired');
    const matches = findSessions(entry.imei).filter(row => !row.socket.destroyed && row.socket.writable !== false);
    let deferred = matches.length !== 1 ? 'ambiguous_session' : null;
    if (!deferred && (matches[0].socket !== socket || matches[0].session !== session)) {
      return finish(entry, 'skipped', 'session_changed');
    }
    if (!deferred && (now() < entry.freshAt || now() - entry.freshAt > FRESH_MS)) deferred = 'awaiting_fresh_telemetry';
    if (!deferred) {
      // The sender is synchronous. Any thrown/ambiguous outcome ends this intent.
      let result;
      try { result = send(entry.imei, SMS_OFF_COMMAND, { expectedSocket: socket, expiresAt: entry.expiresAt }); }
      catch { return finish(entry, 'uncertain', 'write_error_no_retry'); }
      if (result?.ok) {
        entry.handedOffAt = now();
        return finish(entry, 'handed_off', 'reply_pending');
      }
      // These results are guaranteed pre-write refusals by the shared sender.
      if (['camera_busy', 'ambiguous_session'].includes(result?.error)) {
        deferred = result.error;
      } else {
        return finish(entry, 'skipped', result?.error === 'command_expired' ? 'intent_expired' : 'dispatch_refused');
      }
    }
    update(entry, 'deferred', deferred);
    later(entry, Math.min(CHECK_MS, entry.expiresAt - now()));
  }
  function observe(decoded, events, socket, session) {
    let entry = entries.get(socket);
    if (entry && (entry.session !== session || entry.imei !== session?.imei || entry.protocolId !== session?.protocolId)) {
      return finish(entry, 'skipped', 'identity_changed');
    }
    if (!matchingIdentity(decoded, session) || getSession(socket) !== session) return;
    if (entry?.handedOffAt != null && decoded.command === 'SMSONOFF' && decoded.args?.length === 0) {
      entry.replyAt ??= now();
      finish(entry, 'reply_observed', 'suppression_unverified');
      return;
    }
    // Do not treat arbitrary bytes, command echoes or buffered locations as
    // readiness, and let the alarm path run independently of routine settings.
    if (events.some(e => e.type === 'alarm') || !events.some(e =>
      e.type === 'heartbeat' || (e.type === 'location' && !e.blindSpotReupload))) return;
    if (!entry) {
      entry = { socket, session, imei: session.imei, protocolId: session.protocolId,
        alias: ++nextSession, startedAt: now(), expiresAt: now() + INTENT_MS,
        freshAt: now(), timer: null, terminal: false };
      entries.set(socket, entry);
      update(entry, 'pending');
    }
    entry.freshAt = now();
    // Scheduling rather than writing here keeps ACK/event handling synchronous
    // and does not await Firestore or hold up initial SOS/fall notifications.
    later(entry);
  }
  function disconnect(socket) {
    const entry = entries.get(socket);
    if (entry) finish(entry, 'disconnected', 'session_closed');
  }
  return { observe, disconnect };
}

module.exports = { createWatchSmsPolicy, disallowedSmsCommand, SMS_OFF_COMMAND, INTENT_MS, FRESH_MS };
