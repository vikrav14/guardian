'use strict';
const { EventEmitter } = require('node:events');
const { findSocketsForDevice } = require('./sessions');
const { commandCoordinator } = require('./command-coordinator');
const { buildVoiceFrame } = require('./voice-message-codec');
const { VoiceError } = require('./voice-message-policy');
const { noteDeviceWrite } = require('./photo-command-timeline');
const replies = new EventEmitter();
function createVoiceTransport({
  find = findSocketsForDevice,
  coordinator = commandCoordinator,
  events = replies,
  now = Date.now,
  timeoutMs = 10000,
  note = noteDeviceWrite,
} = {}) {
  const active = new Set(),
    uncertain = new Set();
  function ready(imei, deadline) {
    const matches = find(imei);
    if (matches.length !== 1)
      throw new VoiceError(
        matches.length ? 'multiple_sessions' : 'watch_offline',
      );
    const t = matches[0],
      s = t.session;
    if (
      s.imei !== imei ||
      !/^\d{10}$/.test(s.protocolId || '') ||
      t.socket.destroyed ||
      t.socket.writable === false ||
      !Number.isFinite(s.lastPacketAt) ||
      now() - s.lastPacketAt > 300000 ||
      t.socket.writableLength > 65536
    )
      throw new VoiceError('watch_not_ready');
    if (active.has(imei) || uncertain.has(imei))
      throw new VoiceError('delivery_unconfirmed');
    const decision = coordinator.decide(imei, 'TK', { expiresAt: deadline });
    if (!decision.ok) throw new VoiceError(decision.error);
    return t;
  }
  function bind(imei, row) {
    const target = ready(imei, row.dispatchUntilMs),
      protocolId = target.session.protocolId;
    return {
      send(audio) {
        const current = ready(imei, row.dispatchUntilMs);
        if (
          current.socket !== target.socket ||
          current.session !== target.session ||
          target.session.protocolId !== protocolId
        )
          throw new VoiceError('session_changed');
        const frame = buildVoiceFrame(protocolId, audio);
        const lease = coordinator.beginVoice({
          imei,
          id: row.id,
          socket: target.socket,
          expiresAt: row.dispatchUntilMs,
        });
        if (!lease.ok) throw new VoiceError(lease.error);
        active.add(imei);
        return new Promise((resolve) => {
          let done = false;
          const finish = (status, reason = null) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            active.delete(imei);
            coordinator.finishVoice(imei, row.id);
            events.off('reply', reply);
            target.socket.off('close', closed);
            target.socket.off('error', closed);
            if (status === 'unconfirmed') uncertain.add(imei);
            resolve({ status, reason });
          };
          const reply = (e) => {
            if (
              e.socket === target.socket &&
              e.session === target.session &&
              e.protocolId === protocolId &&
              e.session.imei === imei
            )
              finish(
                e.result === 1 ? 'reply_observed' : 'rejected',
                e.result === 1 ? null : 'watch_rejected',
              );
          };
          const closed = () => finish('unconfirmed', 'connection_interrupted');
          const timer = setTimeout(
            () => finish('unconfirmed', 'reply_timeout'),
            Math.min(timeoutMs, Math.max(1, row.dispatchUntilMs - now())),
          );
          events.on('reply', reply);
          target.socket.once('close', closed);
          target.socket.once('error', closed);
          try {
            note(target.socket, target.session, frame, 'voice_message');
            target.socket.write(frame, (error) => {
              if (error) closed();
            });
          } catch {
            closed();
          }
        });
      },
    };
  }
  return {
    bind,
    ready,
    connected: (imei) => {
      try {
        ready(imei, now() + 1);
        return true;
      } catch (e) {
        return ![
          'watch_offline',
          'watch_not_ready',
          'multiple_sessions',
        ].includes(e.code);
      }
    },
    observe: (value, socket, session) => {
      if (value.kind === 'result')
        events.emit('reply', { ...value, socket, session });
    },
  };
}
const voiceTransport = createVoiceTransport();
module.exports = { createVoiceTransport, voiceTransport };
