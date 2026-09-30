'use strict';

const { EventEmitter } = require('node:events');
const { findSocketsForDevice } = require('./sessions');
const { MovementError, movementFrame } = require('./movement-reminder-policy');

const replies = new EventEmitter();
// Observe decoded packets synchronously, before unrelated Firestore work.
function observeMovementReply(decoded, socket, session) {
  if (!decoded.error && ['SEDENTARY', 'SEDENTARYWORKTIME'].includes(decoded.command)
      && Array.isArray(decoded.args) && decoded.args.length === 0) {
    replies.emit('reply', { decoded, socket, session });
  }
}

function createMovementTransport({ find = findSocketsForDevice, events = replies,
  timeoutMs = 8000, now = Date.now } = {}) {
  function select(imei) {
    const matches = find(imei);
    if (matches.length !== 1) throw new MovementError(matches.length ? 'multiple_sessions' : 'watch_offline');
    const target = matches[0];
    if (target.session.imei !== imei || !/^\d{10}$/.test(target.session.protocolId || '')
        || target.socket.destroyed || target.socket.writable === false
        || now() - target.session.lastPacketAt > 5 * 60_000) {
      throw new MovementError('watch_session_not_ready');
    }
    return target;
  }
  function connected(imei) { try { select(imei); return true; } catch { return false; } }
  function bind(imei) {
    const target = select(imei);
    const protocolId = target.session.protocolId;
    return {
      send(command) {
        // Never move a partly-applied operation to a reconnected socket.
        const current = select(imei);
        if (current.socket !== target.socket || current.session !== target.session
            || current.session.protocolId !== protocolId) throw new MovementError('session_changed');
        const frame = movementFrame(protocolId, command);
        return new Promise(resolve => {
          const sentAt = new Date(now()).toISOString();
          let settled = false;
          let timer;
          function finish(result) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            events.off('reply', onReply);
            target.socket.off('close', onClose);
            target.socket.off('error', onError);
            // Persist the exact bounded setting bytes used at the socket,
            // alongside the body. This is handoff evidence, never readback.
            resolve({ command, sentAt, protocolId, frameHex: frame.toString('hex'),
              appliedStateVerified: false, ...result });
          }
          function onReply(event) {
            if (event.socket === target.socket && event.session === target.session
                && event.session.imei === imei && event.session.protocolId === protocolId
                && event.decoded.imei === protocolId
                && event.decoded.command === command.split(',')[0]) {
              finish({ handoff: true, replyObserved: true, replyAt: new Date(now()).toISOString() });
            }
          }
          function onClose() { finish({ handoff: true, replyObserved: false, reason: 'session_closed' }); }
          function onError() { finish({ handoff: null, replyObserved: false, reason: 'write_unconfirmed' }); }
          events.on('reply', onReply);
          target.socket.once('close', onClose);
          target.socket.once('error', onError);
          timer = setTimeout(() => finish({ handoff: true, replyObserved: false, reason: 'reply_timeout' }), timeoutMs);
          try { target.socket.write(frame, error => { if (error) onError(); }); }
          catch { onError(); }
        });
      },
    };
  }
  return { connected, bind };
}

const movementTransport = createMovementTransport();
module.exports = { observeMovementReply, createMovementTransport, movementTransport };
