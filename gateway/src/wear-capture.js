'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const WINDOW_MS = 30 * 60 * 1000;
const MAX_RECORDS = 1200;
const COMMAND = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const iso = value => Number.isFinite(value) ? new Date(value).toISOString() : null;
const code = value => /^[A-Z0-9_]{1,40}$/.test(value || '') ? value : null;

// An opt-in engineering trace, not wearing evidence or a command sender.
// No raw location/health/configuration payloads enter the trace. The one raw
// frame retained is a bare AL acknowledgement (including its protocol ID).
function createWearCapture({ enabled = false, pilotImei, write,
  clock = Date.now, onStop = () => {} } = {}) {
  const startedAt = clock();
  const expiresAt = startedAt + WINDOW_MS;
  const configured = enabled === true && /^\d{15}$/.test(pilotImei || '') &&
    typeof write === 'function';
  const sockets = new WeakMap();
  const tokens = new WeakSet();
  let stopped = false, count = 0, sessionNumber = 0, packetNumber = 0;

  function stop(reason = 'stopped') {
    if (!configured || stopped) return;
    stopped = true;
    try { onStop({ reason, records: count }); } catch { /* observer only */ }
  }
  function active() {
    if (!configured || stopped) return false;
    if (clock() >= expiresAt) { stop('window_ended'); return false; }
    if (count >= MAX_RECORDS) { stop('record_limit'); return false; }
    return true;
  }
  function emit(record) {
    try {
      if (!active()) return false;
      count += 1;
      write({ version: 1, recordedAt: iso(clock()), ...record });
      return true;
    } catch { stop('capture_failed'); return false; }
  }
  function sessionFor(socket, session) {
    if (!active() || session?.imei !== pilotImei || !socket) return null;
    if (!sockets.has(socket)) sockets.set(socket, ++sessionNumber);
    return sockets.get(socket);
  }

  function observePacket({ socket, session, frame, decoded, receivedAt }) {
    try {
      const sessionId = sessionFor(socket, session);
      if (!sessionId || !Buffer.isBuffer(frame) || decoded?.error) return null;
      const command = COMMAND.test(decoded?.command || '') ? decoded.command : 'unrecognized';
      const header = frame.subarray(0, 64).toString('ascii')
        .match(/^\[([A-Za-z0-9]{2})\*(\d{10,15})\*([0-9a-fA-F]{4})\*/);
      const declaredPayloadBytes = header ? parseInt(header[3], 16) : null;
      const actualPayloadBytes = header ? frame.length - header[0].length - 1 : null;
      const positioning = /^(?:AL|UD|WT)(?:_[A-Z0-9]+|2(?:_[A-Z0-9]+)?)?$/.test(command);
      const args = Array.isArray(decoded.args) ? decoded.args : [];
      const trackerState = positioning && /^[0-9a-fA-F]{8}$/.test(args[15] || '')
        ? args[15].toUpperCase() : null;
      const state = trackerState === null ? null : parseInt(trackerState, 16);
      const packet = ++packetNumber;
      if (!emit({ kind: 'packet_received', session: sessionId, packet, command,
        receivedAt: receivedAt instanceof Date && Number.isFinite(+receivedAt)
          ? receivedAt.toISOString() : null,
        frameBytes: frame.length, factory: header?.[1] || null,
        protocolIdMatchesSession: header ? header[2] === session.protocolId : null,
        declaredPayloadBytes, actualPayloadBytes,
        payloadLengthMatches: header ? declaredPayloadBytes === actualPayloadBytes : null,
        argumentCount: args.length,
        deviceDate: positioning && /^\d{6}$/.test(args[0] || '') ? args[0] : null,
        deviceTime: positioning && /^\d{6}$/.test(args[1] || '') ? args[1] : null,
        trackerState, setBits: state === null ? null :
          Array.from({ length: 32 }, (_, bit) => bit).filter(bit => (state >>> bit) & 1),
      })) return null;
      if (!command.startsWith('AL')) return null;
      const token = Object.freeze({ packet, session: sessionId,
        protocolId: header?.[2] || null });
      tokens.add(token);
      return token;
    } catch { stop('capture_failed'); return null; }
  }

  // Exactly one native write with exactly the original bytes. Neither false
  // (backpressure) nor an error can cause a diagnostic retry or another ACK.
  function writeAlarmAck(socket, ack, token) {
    let details = null;
    try {
      if (token && tokens.has(token) && active()) {
        const bytes = Buffer.isBuffer(ack) ? ack : Buffer.from(ack);
        const match = bytes.length <= 64 && bytes.toString('ascii')
          .match(/^\[([A-Za-z0-9]{2})\*(\d{10,15})\*([0-9a-fA-F]{4})\*AL\]$/);
        details = { session: token.session, packet: token.packet, ackBytes: bytes.length,
          ackFrame: match ? bytes.toString('ascii') : null,
          ackFrameRecognized: Boolean(match),
          protocolIdMatchesPacket: match ? match[2] === token.protocolId : null,
          payloadLengthMatches: match ? parseInt(match[3], 16) === 2 : null,
          deliveryConfirmed: false };
      }
    } catch { stop('capture_failed'); }
    if (!details) return socket.write(ack);
    emit({ kind: 'alarm_ack_write_attempt', ...details });
    let writable;
    try {
      writable = socket.write(ack, error => emit({
        kind: 'alarm_ack_write_completed', ...details,
        localWriteCompleted: !error, errorCode: error ? code(error.code) || 'UNKNOWN' : null,
      }));
    } catch (error) {
      emit({ kind: 'alarm_ack_write_threw', ...details, errorCode: code(error.code) || 'UNKNOWN' });
      throw error;
    }
    emit({ kind: 'alarm_ack_write_returned', ...details, backpressure: writable === false });
    return writable;
  }

  function observeSocket(kind, socket, session, evidence = {}) {
    try {
      if (!['peer_end', 'socket_error', 'socket_closed'].includes(kind)) return;
      const sessionId = sessionFor(socket, session);
      if (!sessionId) return;
      const record = { kind, session: sessionId };
      for (const key of ['connectedAt', 'lastDataAt', 'peerEndAt', 'localCloseRequestedAt']) {
        const value = evidence[key];
        record[key] = typeof value === 'string' &&
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ? value : null;
      }
      record.errorCode = code(evidence.socketErrorCode);
      record.hadError = evidence.hadError === true;
      record.localCloseReason = evidence.localCloseReason === 'packet_idle_timeout'
        ? 'packet_idle_timeout' : evidence.localCloseReason ? 'other' : null;
      for (const key of ['bytesRead', 'bytesWritten']) {
        record[key] = Number.isSafeInteger(evidence[key]) && evidence[key] >= 0 ? evidence[key] : null;
      }
      emit(record);
    } catch { stop('capture_failed'); }
  }
  return { observePacket, writeAlarmAck, observeSocket, stop,
    get active() { return active(); }, expiresAt };
}

function startWearCapture({ enabled = false, pilotImei,
  directory = path.join(__dirname, '../data/wear-captures'), log = console.log } = {}) {
  if (!enabled) return createWearCapture();
  if (!/^\d{15}$/.test(pilotImei || '')) {
    throw new Error('Wear capture requires the configured WIFI_HOME_PILOT_IMEI.');
  }
  const safeLog = record => { try { log(`[wear-capture] ${JSON.stringify(record)}`); } catch { /* diagnostic only */ } };
  fs.mkdirSync(directory, { recursive: true });
  const savedTo = path.join(directory, `${Date.now()}-${randomUUID()}.jsonl`);
  // Fail before starting the gateway if the private file cannot be opened.
  const fd = fs.openSync(savedTo, 'wx', 0o600);
  const stream = fs.createWriteStream(savedTo, { fd, autoClose: true });
  let timer;
  const capture = createWearCapture({ enabled, pilotImei,
    write: record => stream.write(`${JSON.stringify(record)}\n`),
    onStop: status => {
      clearTimeout(timer);
      if (!stream.destroyed) stream.end(`${JSON.stringify({ version: 1,
        kind: 'capture_finished', recordedAt: new Date().toISOString(), ...status })}\n`);
      safeLog({ status: 'finished', ...status, savedTo, gatewayContinues: true });
    },
  });
  stream.on('error', () => {
    capture.stop('file_write_failed');
    safeLog({ status: 'file_write_failed', evidenceIncomplete: true, savedTo });
  });
  stream.write(`${JSON.stringify({ version: 1, kind: 'capture_started',
    recordedAt: new Date().toISOString(), expiresAt: iso(capture.expiresAt), maxRecords: MAX_RECORDS,
    deliveryConfirmed: false, changesWatchSettings: false })}\n`);
  timer = setTimeout(() => capture.stop('window_ended'), WINDOW_MS);
  timer.unref?.();
  safeLog({ status: 'armed', expiresAt: iso(capture.expiresAt), maxRecords: MAX_RECORDS,
    savedTo, changesWatchSettings: false });
  return { ...capture, get active() { return capture.active; },
    savedTo, closed: new Promise(resolve => stream.once('close', resolve)) };
}

module.exports = { createWearCapture, startWearCapture, WINDOW_MS, MAX_RECORDS };
