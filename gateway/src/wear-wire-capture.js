'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { validConsent } = require('./care-wellbeing');

const WINDOW_MS = 5 * 60_000;
const MAX_BYTES = 256 * 1024;
const MAX_CHUNKS = 512;
const MAX_SESSIONS = 16;
const CONSENT_TIMEOUT_MS = 3000;

async function readWithTimeout(read) {
  let timer;
  try {
    return await Promise.race([Promise.resolve().then(read), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('consent_timeout')), CONSENT_TIMEOUT_MS);
    })]);
  } finally { clearTimeout(timer); }
}

// Observe TCP bytes BEFORE framing/decoding. TCP chunks are not protocol packets.
// Keep a bounded prefix in memory until the existing gateway binds the socket to
// the exact pilot. Never persist unidentified/other-device bytes. An identity
// change excludes subsequent and still-pending writes for that socket.
function createWearWireCapture({ enabled = false, pilotImei, readConsent, write,
  clock = Date.now, onStatus = () => {} } = {}) {
  const startedAt = clock(), expiresAt = startedAt + WINDOW_MS;
  const configured = enabled === true && /^\d{15}$/.test(pilotImei || '') &&
    typeof readConsent === 'function' && typeof write === 'function';
  const sessions = new Map(), ignored = new WeakSet();
  const pilotSessions = [];
  let nextSession = 0, retainedBytes = 0, retainedChunks = 0;
  let excludedSessions = 0, untrackedSessions = 0, unidentifiedSessions = 0;
  let finished = false, observerFailed = false, pending = Promise.resolve();
  function status(record) {
    try { onStatus(record); } catch { /* Diagnostics never interrupt receipt. */ }
  }
  function failed() {
    observerFailed = true;
    status({ status: 'observer_failed', completeForIdentifiedSessions: false });
  }
  function inWindow() { const now = clock(); return now >= startedAt && now < expiresAt; }
  function drop(s, entry, reason) {
    s.droppedBytes += entry.byteLength;
    s.dropReasons[reason] = (s.dropReasons[reason] || 0) + entry.byteLength;
  }
  function snapshot(s) {
    const socketBytes = Number.isSafeInteger(s.socket.bytesRead) ? s.socket.bytesRead : null;
    const unobservedSocketBytes = socketBytes === null || s.socketBytesAtStart === null
      ? null : Math.max(0, socketBytes - s.socketBytesAtStart - s.observedBytes);
    return { session: s.number, firstReceivedAt: s.firstReceivedAt,
      lastReceivedAt: s.lastReceivedAt, closedAt: s.closedAt,
      observedBytes: s.observedBytes, savedBytes: s.savedBytes,
      droppedBytes: s.droppedBytes, observedChunks: s.observedChunks, savedChunks: s.savedChunks,
      dropReasons: { ...s.dropReasons }, identityChanged: s.excluded,
      socketBytesAtStart: s.socketBytesAtStart, socketBytesAtEnd: socketBytes,
      unobservedSocketBytes };
  }
  function enqueue(s, entry) {
    pending = pending.then(async () => {
      if (s.excluded) { drop(s, entry, 'identity_changed'); return; }
      if (!inWindow()) { drop(s, entry, 'window_ended'); return; }
      let consent;
      try { consent = await readWithTimeout(() => readConsent(pilotImei)); }
      catch { drop(s, entry, 'consent_read_failed'); return; }
      if (s.excluded) { drop(s, entry, 'identity_changed'); return; }
      if (!inWindow()) { drop(s, entry, 'window_ended'); return; }
      if (!validConsent(consent, new Date(clock()))) {
        drop(s, entry, 'consent_required'); return;
      }
      try {
        await write({ version: 1, kind: 'tcp_chunk', session: s.number, ...entry });
        s.savedBytes += entry.byteLength;
        s.savedChunks += 1;
      } catch { drop(s, entry, 'write_failed'); }
    }).catch(() => { drop(s, entry, 'observer_failed'); });
  }
  function identify(s, session) {
    if (!session?.imei) return;
    if (session.imei !== pilotImei) {
      s.excluded = true;
      if (s.pilot) {
        for (const entry of s.prefix) drop(s, entry, 'identity_changed');
      }
      s.prefix = [];
      sessions.delete(s.socket);
      ignored.add(s.socket);
      excludedSessions += 1;
    } else if (!s.pilot) {
      s.pilot = true;
      pilotSessions.push(s);
      for (const entry of s.prefix) enqueue(s, entry);
      s.prefix = [];
    }
  }
  function finish(reason = 'manual_stop') {
    if (finished || !configured) return pending;
    finished = true;
    const stoppedAt = new Date(clock()).toISOString();
    // Snapshot counters now; later socket traffic is outside this capture.
    const counters = new Map(pilotSessions.map(s => [s, snapshot(s)]));
    for (const s of sessions.values()) {
      if (!s.pilot) unidentifiedSessions += 1;
      s.prefix = [];
    }
    pending = pending.then(async () => {
      const summaries = pilotSessions.map(s => ({ ...counters.get(s),
        savedBytes: s.savedBytes, savedChunks: s.savedChunks,
        droppedBytes: s.droppedBytes, dropReasons: { ...s.dropReasons } }));
      const record = { version: 1, kind: 'capture_finished', reason,
        startedAt: new Date(startedAt).toISOString(), stoppedAt,
        expiresAt: new Date(expiresAt).toISOString(), windowComplete: reason === 'window_ended',
        scope: 'inbound_gateway_tcp_bytes_for_identified_pilot_sessions',
        sessions: summaries, unidentifiedSessions, excludedSessions, untrackedSessions, observerFailed,
        completeForIdentifiedSessions: summaries.length > 0 && untrackedSessions === 0 && !observerFailed &&
          summaries.every(s => s.observedBytes === s.savedBytes && s.droppedBytes === 0 &&
            s.unobservedSocketBytes === 0 && !s.identityChanged),
        wearingInferred: false };
      try { await write(record); status({ status: 'finished', ...record }); }
      catch { status({ status: 'summary_write_failed', completeForIdentifiedSessions: false }); }
      sessions.clear();
      pilotSessions.length = 0;
    });
    return pending;
  }
  function observeChunk(socket, session, chunk) {
    try {
      if (!configured || finished || !socket || !Buffer.isBuffer(chunk) || chunk.length === 0) return;
      if (!inWindow()) { void finish(clock() < startedAt ? 'clock_changed' : 'window_ended'); return; }
      if (ignored.has(socket)) return;
      let s = sessions.get(socket);
      if (!s) {
        if (session?.imei && session.imei !== pilotImei) { ignored.add(socket); excludedSessions++; return; }
        if (nextSession >= MAX_SESSIONS) { ignored.add(socket); untrackedSessions++; return; }
        const receivedAt = new Date(clock()).toISOString();
        s = { socket, number: ++nextSession, pilot: false, excluded: false, prefix: [],
          firstReceivedAt: receivedAt, lastReceivedAt: receivedAt, closedAt: null,
          observedBytes: 0, savedBytes: 0, droppedBytes: 0, observedChunks: 0, savedChunks: 0,
          dropReasons: {}, socketBytesAtStart: Number.isSafeInteger(socket.bytesRead)
            ? Math.max(0, socket.bytesRead - chunk.length) : null };
        sessions.set(socket, s);
      }
      identify(s, session);
      if (s.excluded) return;
      const entry = { receivedAt: new Date(clock()).toISOString(), offset: s.observedBytes,
        byteLength: chunk.length, encoding: 'base64' };
      s.observedBytes += chunk.length;
      s.observedChunks += 1;
      s.lastReceivedAt = entry.receivedAt;
      if (retainedBytes + chunk.length > MAX_BYTES || retainedChunks >= MAX_CHUNKS) {
        drop(s, entry, 'capture_limit'); return;
      }
      retainedBytes += chunk.length;
      retainedChunks += 1;
      // Lossless immutable copy, including NUL/non-ASCII bytes and fragments.
      entry.bytes = chunk.toString('base64');
      if (s.pilot) enqueue(s, entry);
      else s.prefix.push(entry);
    } catch { failed(); }
  }
  function observeIdentity(socket, session) {
    try {
      if (finished) return;
      const s = sessions.get(socket);
      if (s) identify(s, session);
    } catch { failed(); }
  }
  function observeClose(socket) {
    try {
      if (finished) return;
      const s = sessions.get(socket);
      if (!s) return;
      s.closedAt = new Date(clock()).toISOString();
      if (!s.pilot) { unidentifiedSessions++; s.prefix = []; }
      sessions.delete(socket);
      ignored.add(socket);
    } catch { failed(); }
  }
  return { observeChunk, observeIdentity, observeClose, finish,
    flush: () => pending, expiresAt, get active() { return configured && !finished && inWindow(); } };
}

function startWearWireCapture({ enabled = false, config, db,
  directory = path.join(__dirname, '../data/wear-wire-captures'), log = console.log } = {}) {
  if (!enabled) return createWearWireCapture();
  if (!db || config?.careWellbeingIngestEnabled !== true ||
      !/^\d{15}$/.test(config?.wifiHomePilotImei || '')) {
    throw new Error('Wear wire capture needs Firestore, wellbeing ingestion and WIFI_HOME_PILOT_IMEI.');
  }
  const savedTo = path.join(directory, `${Date.now()}-${randomUUID()}.jsonl`);
  let fileCreated = false, timer;
  const safeLog = record => {
    try { log(`[wear-wire-capture] ${JSON.stringify(record)}`); } catch { /* Observer only. */ }
  };
  const capture = createWearWireCapture({ enabled, pilotImei: config.wifiHomePilotImei,
    readConsent: async imei => {
      const snap = await db.collection('wellbeingConsents').doc(imei).get();
      return snap.exists ? snap.data() : null;
    },
    write: async record => {
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      await fs.writeFile(savedTo, `${JSON.stringify(record)}\n`, {
        flag: fileCreated ? 'a' : 'wx', mode: 0o600,
      });
      fileCreated = true;
    },
    onStatus: record => {
      if (record.status === 'finished' || record.status === 'summary_write_failed') clearTimeout(timer);
      // Counts/times only. No raw values, device IDs, consent details or error messages.
      safeLog({ ...record, savedTo, gatewayContinues: true });
    },
  });
  safeLog({ status: 'armed', savedTo, expiresAt: new Date(capture.expiresAt).toISOString(),
    maxBytes: MAX_BYTES, maxChunks: MAX_CHUNKS, maxSessions: MAX_SESSIONS,
    scope: 'before_protocol_decoder', changesWatchSettings: false, sendsCommands: false });
  timer = setTimeout(() => { void capture.finish('window_ended'); }, WINDOW_MS);
  timer.unref?.();
  return capture;
}

module.exports = { createWearWireCapture, startWearWireCapture, WINDOW_MS, MAX_BYTES,
  MAX_CHUNKS, MAX_SESSIONS };
