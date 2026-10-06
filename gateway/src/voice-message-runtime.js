'use strict';
const { isVoiceFrame, decodeVoiceFrame } = require('./voice-message-codec');
const { voiceRuntime, authorizeVoice } = require('./voice-message-policy');
const { createVoiceStore } = require('./voice-message-store');
const { voiceTransport } = require('./voice-message-transport');
const { convertVoice } = require('./voice-message-audio');
const { buildAckFrame } = require('./protocol/gt06');
const { noteDeviceWrite } = require('./photo-command-timeline');
function createVoiceReceiver({
  getDb,
  runtime = voiceRuntime(),
  transport = voiceTransport,
  storeFactory = createVoiceStore,
  authorize = authorizeVoice,
  convert = convertVoice,
  note = noteDeviceWrite,
} = {}) {
  const busy = new Set();
  function observe(frame, socket, session) {
    if (!isVoiceFrame(frame)) return false;
    // Always keep TK private, including disabled or malformed media. Never let
    // binary payloads enter ASCII logging, raw command events or ACK fallbacks.
    if (
      !runtime.enabled ||
      session.imei !== runtime.imei ||
      !/^\d{10}$/.test(session.protocolId || '')
    )
      return true;
    let value;
    try {
      value = decodeVoiceFrame(frame);
    } catch {
      return true;
    }
    if (value.protocolId !== session.protocolId) return true;
    if (value.kind !== 'audio') {
      transport.observe(value, socket, session);
      return true;
    }
    if (busy.has(session.imei) || busy.size >= 2) return true;
    const imei = session.imei,
      protocolId = session.protocolId;
    busy.add(imei);
    const ack = (result) => {
      if (
        socket.destroyed ||
        socket.writable === false ||
        session.imei !== imei ||
        session.protocolId !== protocolId
      )
        return;
      const response = buildAckFrame(protocolId, `TK,${result}`);
      note(socket, session, response, 'protocol_ack');
      try {
        socket.write(response);
      } catch {
        /* Receipt is already durable; no replay. */
      }
    };
    void (async () => {
      try {
        const db = getDb();
        if (!db) throw Error('unavailable');
        await authorize({ db, uid: runtime.uid, imei, runtime });
        const pcm = await convert(value.audio, 'decode');
        const access = await authorize({ db, uid: runtime.uid, imei, runtime });
        const store = storeFactory(db);
        await store.put({
          access,
          id: store.incomingId(imei, value.audio),
          direction: 'incoming',
          audio: value.audio,
          pcm,
          durationMs: value.durationMs,
        });
        ack(1); // Only after durable private media + metadata transaction commits.
      } catch {
        ack(0);
      } finally {
        busy.delete(imei);
      }
    })();
    return true;
  }
  let cleaning = false;
  async function cleanup() {
    if (!runtime.enabled || cleaning) return;
    cleaning = true;
    try {
      const db = getDb();
      if (db) await storeFactory(db).cleanup();
    } catch {
      /* Retry cleanup only; never resend media. */
    } finally {
      cleaning = false;
    }
  }
  function startCleanup() {
    if (!runtime.enabled) return null;
    void cleanup();
    const timer = setInterval(() => void cleanup(), 60000);
    timer.unref();
    return timer;
  }
  return { observe, startCleanup };
}
module.exports = { createVoiceReceiver };
