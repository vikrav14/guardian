'use strict';

const { prepareCapturedAnswerTrial } = require('./captured-answer-mode-trial');
const { findSocketsForDevice } = require('./sessions');
const { buildAckFrame } = require('./protocol/gt06');
const { phonebookContactCommand } = require('./commands');

const pending = new Map();
const activeDevices = new Set();
const REPLY_COMMANDS = new Set(['APPLOCK', 'ACALL', 'PHBX']);

/** Called synchronously after decoding/identity binding, before Firestore awaits.
 * Only an active exchange on this exact socket sees the packet. Nothing is
 * retained from unsolicited traffic or private command arguments.
 */
function observeWatchCallPacket(socket, decoded, session) {
  const exchange = pending.get(socket);
  if (!exchange || decoded?.error || decoded?.imei !== exchange.protocolId ||
      session?.imei !== exchange.imei || session?.protocolId !== exchange.protocolId) return;
  exchange.observe(decoded);
}

function exchangeOnSocket(candidate, input, protocolId, bytes, commands, timeoutMs, probe) {
  const { socket } = candidate;
  return new Promise(resolve => {
    const replies = new Set();
    let finished = false, armed = false;
    const finish = reason => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (pending.get(socket) === exchange) pending.delete(socket);
      for (const event of ['close', 'end', 'error']) socket.off(event, closed);
      resolve({ reason, receivedReplies: [...replies] });
    };
    const closed = () => finish('connection_lost');
    const exchange = { imei: input.imei, protocolId, observe: decoded => {
      if (!armed || !commands.includes(decoded.command) || !Array.isArray(decoded.args)) return;
      // VERNO is a documented, pilot-observed read-only query. A bare echo
      // is insufficient: require a returned firmware label, without storing it.
      if (probe ? decoded.args.length < 1 || decoded.args.length > 2 ||
          !decoded.args.every(arg => typeof arg === 'string' && /^C403H_[A-Za-z0-9_.-]{1,160}$/.test(arg))
        : decoded.args.length !== 0) return;
      replies.add(decoded.command);
      if (commands.every(command => replies.has(command))) finish(null);
    } };
    const timer = setTimeout(() => finish('reply_timeout'), timeoutMs);
    pending.set(socket, exchange);
    for (const event of ['close', 'end', 'error']) socket.on(event, closed);
    armed = true;
    try {
      socket.write(bytes, error => { if (error) finish('write_error'); });
      // false is buffered/backpressured, not failure. Wait for device replies.
    } catch { finish('write_error'); }
  });
}

/** Read-only preflight, then ONE exact captured write; never replay mode bytes.
 * Up to two different sockets can be probed during a handover, before any
 * setting is sent. The request/lease deadline also fences the post-probe write.
 * Bare replies demonstrate receipt only, never applied settings or call audio.
 */
async function sendCheckedFrames(input, prepared, expectedReplies, {
  deadlineAt = Date.now() + 25_000, now = Date.now, findSessions = findSocketsForDevice,
  probeTimeoutMs = 4000, replyTimeoutMs = 8000, log = console.log,
} = {}) {
  const { bytes, metadata } = prepared;
  const result = (outcome, reason, receivedReplies = []) => ({
    outcome, reason, expectedReplies, receivedReplies: receivedReplies.filter(command => REPLY_COMMANDS.has(command)),
    deviceReplyObserved: outcome === 'device_replied', appliedStateVerified: false,
  });
  if (activeDevices.has(input.imei)) return result('not_sent', 'transport_busy');
  activeDevices.add(input.imei);
  let selected;
  const trace = (stage, extra = {}) => {
    try { log(`[${input.operation || 'watch-calls'}-transport] ${JSON.stringify({ at: new Date(now()).toISOString(),
      mode: input.mode, stage, connectionId: selected?.session.connectionId ?? null,
      peerPort: Number.isInteger(selected?.socket.remotePort) ? selected.socket.remotePort : null,
      ...extra })}`); } catch { /* diagnostics cannot change delivery */ }
  };
  const candidates = () => findSessions(input.imei).filter(({ socket, session }) =>
    session.imei === input.imei && !socket.destroyed && !socket.writableEnded && socket.writable !== false &&
    Number.isFinite(session.lastPacketAt) && now() >= session.lastPacketAt && now() - session.lastPacketAt <= 120_000
  ).sort((a, b) => (b.session.connectionId || 0) - (a.session.connectionId || 0) ||
    b.session.lastPacketAt - a.session.lastPacketAt);
  const usable = rows => rows.length && rows.every(row => row.session.protocolId === metadata.protocolId);
  try {
    const attempted = new Set();
    for (let attempt = 0; attempt < 2; attempt++) {
      if (now() >= deadlineAt) return result('not_sent', 'expired_before_handoff');
      const rows = candidates();
      if (!rows.length) return result('not_sent', 'no_fresh_identified_session');
      if (!usable(rows)) return result('not_sent', 'capture_device_mismatch');
      selected = rows[0];
      if (attempted.has(selected.socket) || pending.has(selected.socket)) return result('not_sent', 'connection_unconfirmed');
      attempted.add(selected.socket);
      trace('checking_connection');
      const probe = await exchangeOnSocket(selected, input, metadata.protocolId,
        buildAckFrame(metadata.protocolId, 'VERNO'), ['VERNO'], Math.max(1, Math.min(probeTimeoutMs, deadlineAt - now())), true);
      if (now() >= deadlineAt) return result('not_sent', 'expired_before_handoff');
      const latest = candidates();
      if (!usable(latest)) return result('not_sent', 'connection_unconfirmed');
      // A new identified connection supersedes the earlier one even when a
      // delayed old packet gives the older socket a more recent packet time.
      if (latest[0].socket !== selected.socket) { trace('connection_changed'); continue; }
      if (probe.reason) {
        trace('connection_unconfirmed', { reason: probe.reason });
        return result('not_sent', 'connection_unconfirmed');
      }
      trace('connection_checked');
      // Check again immediately before the synchronous write. No mode-setting
      // fallback, rebroadcast or retry is allowed after this point.
      if (now() >= deadlineAt) return result('not_sent', 'expired_before_handoff');
      trace('awaiting_watch_replies', { expectedReplies, frameCount: metadata.frameCount });
      const delivery = await exchangeOnSocket(selected, input, metadata.protocolId, bytes,
        expectedReplies, Math.max(1, Math.min(replyTimeoutMs, deadlineAt - now())), false);
      trace(delivery.reason ? 'receipt_unconfirmed' : 'watch_replied', {
        receivedReplies: delivery.receivedReplies, reason: delivery.reason,
      });
      return result(delivery.reason ? 'handoff_unknown' : 'device_replied',
        delivery.reason ? 'watch_reply_missing' : null, delivery.receivedReplies);
    }
    return result('not_sent', 'connection_changed');
  } finally { activeDevices.delete(input.imei); }
}

function sendWatchCallWithReplies(input, options) {
  return sendCheckedFrames(input, prepareCapturedAnswerTrial(input),
    input.mode === 'manual' ? ['APPLOCK', 'ACALL'] : ['ACALL'], options);
}

function sendPhonebookWithReplies(input, options) {
  if (!/^\d{15}$/.test(input.imei) || !/^\d{10}$/.test(input.protocolId)) throw new Error('invalid_identity');
  const command = phonebookContactCommand(input);
  return sendCheckedFrames({ ...input, operation: 'watch-contacts' }, {
    bytes: buildAckFrame(input.protocolId, command),
    metadata: { protocolId: input.protocolId, frameCount: 1 },
  }, ['PHBX'], options);
}

module.exports = { observeWatchCallPacket, sendWatchCallWithReplies, sendPhonebookWithReplies };
