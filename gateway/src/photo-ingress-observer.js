'use strict';

// Metadata only. A recent authorized request scopes observation, not permission
// to accept media. There is no socket write, payload copy or persistent replay.
const LATE_OBSERVATION_MS = 120_000;
const { MAX_CAPTURE_WINDOW_MS } = require('./photo-capture-window');
const MAX_TRACES = 32, MAX_SESSIONS = 12, MAX_EVENTS = 32;
const DISPOSITIONS = new Set(['no_pending_request', 'duplicate_in_flight',
  'different_session', 'identity_mismatch', 'request_expired', 'passed_ingress_guard']);
function photoHeader(bytes) {
  if (!Buffer.isBuffer(bytes)) return null;
  return /^\[[a-z0-9]{2}\*(\d{10,15})\*[a-f0-9]{4}\*img(?:,|$)/i
    .exec(bytes.subarray(0, 48).toString('latin1'));
}
function createPhotoIngressObserver({ now = Date.now, log = () => {},
  schedule = setTimeout, cancel = clearTimeout } = {}) {
  const traces = new Map(), aliases = new WeakMap();
  let nextAlias = 0;
  const safe = fn => (...args) => { try { return fn(...args); } catch { /* Observation cannot affect capture. */ } };
  const alias = socket => {
    if (!aliases.has(socket)) aliases.set(socket, `s${++nextAlias}`);
    return aliases.get(socket);
  };
  function emit(t, kind, details = {}, final = false) {
    if (!final && t.events >= MAX_EVENTS) { t.suppressedEvents++; return; }
    if (!final) t.events++;
    try {
      log(`[photo-ingress] ${JSON.stringify({ version: 1, kind, at: new Date(+now()).toISOString(),
        requestId: t.id, evidence: 'observation_not_capture_correlation', ...details })}`);
    } catch { t.logFailures++; }
  }
  function finish(t, reason) {
    if (traces.get(t.id) !== t) return;
    traces.delete(t.id); cancel(t.timer);
    emit(t, 'observation_finished', { reason, startedAt: new Date(t.startedAt).toISOString(),
      captureExpiresAt: new Date(t.expiresAt).toISOString(), observationEndsAt: new Date(t.endsAt).toISOString(),
      sessions: [...t.sessions.values()].map(s => ({ ...s })),
      untrackedChunks: t.untrackedChunks, untrackedBytes: t.untrackedBytes,
      suppressedEvents: t.suppressedEvents, logFailures: t.logFailures }, true);
  }
  function sweep() {
    const at = +now();
    for (const t of traces.values()) {
      if (at < t.startedAt || at >= t.endsAt) finish(t, at < t.startedAt ? 'clock_changed' : 'observation_deadline');
    }
  }
  function relationship(t, socket, session) {
    if (socket === t.socket) return session?.imei === t.imei && session?.protocolId === t.protocolId
      ? 'capture_connection' : 'capture_identity_changed';
    if (!session?.imei) return 'unidentified_connection';
    return session.imei === t.imei ? 'other_identified_connection' : null;
  }
  function select(t, socket, session, chunkBytes = 0) {
    const relation = relationship(t, socket, session);
    if (!relation) return null; // No observation of another identified device.
    const sessionAlias = alias(socket);
    let s = t.sessions.get(sessionAlias);
    if (!s) {
      if (t.sessions.size >= MAX_SESSIONS) {
        if (chunkBytes) { t.untrackedChunks++; t.untrackedBytes += chunkBytes; }
        return null;
      }
      s = { session: sessionAlias, relation, chunks: 0, bytes: 0, frames: 0,
        photoHeaders: 0, firstDataAt: null, lastDataAt: null, closedAt: null,
        bufferedBytes: 0, maxBufferedBytes: 0, incompletePhotoHeader: false };
      t.sessions.set(sessionAlias, s);
    }
    s.relation = relation;
    return s;
  }
  function each(socket, session, fn, chunkBytes = 0) {
    sweep();
    for (const t of traces.values()) {
      const s = select(t, socket, session, chunkBytes);
      if (s) fn(t, s);
    }
  }
  function begin({ id, imei, protocolId, socket, expiresAt }) {
    sweep();
    const at = +now(), expiry = +expiresAt;
    if (!socket || !Number.isFinite(expiry) || expiry <= at || traces.has(id)) return;
    if (traces.size >= MAX_TRACES) finish(traces.values().next().value, 'trace_limit');
    const t = { id, imei, protocolId, socket, startedAt: at, expiresAt: expiry,
      endsAt: Math.min(expiry, at + MAX_CAPTURE_WINDOW_MS) + LATE_OBSERVATION_MS,
      sessions: new Map(), events: 0, suppressedEvents: 0, logFailures: 0,
      untrackedChunks: 0, untrackedBytes: 0 };
    traces.set(id, t);
    // Reserve the selected connection even if unidentified connections arrive first.
    select(t, socket, { imei, protocolId });
    t.timer = schedule(safe(() => finish(t, 'observation_deadline')), t.endsAt - at);
    t.timer?.unref?.();
    emit(t, 'observation_started', { captureSession: alias(socket),
      captureExpiresAt: new Date(expiry).toISOString(), observationEndsAt: new Date(t.endsAt).toISOString(),
      lateObservationSeconds: LATE_OBSERVATION_MS / 1000 });
  }
  function chunk(socket, session, bytes) {
    if (!Number.isSafeInteger(bytes) || bytes <= 0) return;
    each(socket, session, (t, s) => {
      const first = s.chunks === 0;
      s.chunks++; s.bytes += bytes;
      s.firstDataAt ??= new Date(+now()).toISOString(); s.lastDataAt = new Date(+now()).toISOString();
      if (first) emit(t, 'ingress_seen', { session: s.session, relation: s.relation,
        chunkBytes: bytes, afterCaptureExpiry: +now() >= t.expiresAt });
    }, bytes);
  }
  function frames(socket, session, { frames: values, rest }) {
    each(socket, session, (t, s) => {
      s.frames += values.length;
      s.bufferedBytes = rest.length; s.maxBufferedBytes = Math.max(s.maxBufferedBytes, rest.length);
      const incomplete = photoHeader(rest);
      if (incomplete && !s.incompletePhotoHeader) emit(t, 'photo_header', {
        session: s.session, relation: s.relation, form: 'incomplete_frame',
        headerMatchesRequest: incomplete[1] === t.protocolId, afterCaptureExpiry: +now() >= t.expiresAt });
      s.incompletePhotoHeader = Boolean(incomplete);
      for (const frame of values) {
        const header = photoHeader(frame);
        if (!header) continue;
        s.photoHeaders++;
        emit(t, 'photo_header', { session: s.session, relation: s.relation, form: 'complete_frame',
          frameBytes: frame.length, headerMatchesRequest: header[1] === t.protocolId,
          receiverRecognizesHeader: frame.subarray(20, 24).equals(Buffer.from('img,')),
          afterCaptureExpiry: +now() >= t.expiresAt });
      }
    });
  }
  function disposition(socket, session, reason, pendingRequestId) {
    if (!DISPOSITIONS.has(reason)) return;
    each(socket, session, (t, s) => emit(t, 'photo_disposition', {
      session: s.session, relation: s.relation, reason,
      pendingRequest: !pendingRequestId ? 'none' : pendingRequestId === t.id ? 'this_observation' : 'another_request',
      afterCaptureExpiry: +now() >= t.expiresAt }));
  }
  function close(socket) {
    sweep();
    for (const t of traces.values()) {
      const s = t.sessions.get(aliases.get(socket));
      if (!s) continue;
      s.closedAt = new Date(+now()).toISOString();
      emit(t, 'connection_closed', { session: s.session, relation: s.relation,
        observedBytes: s.bytes, observedChunks: s.chunks });
    }
  }
  return { begin: safe(begin), chunk: safe(chunk), frames: safe(frames),
    disposition: safe(disposition), close: safe(close), sweep: safe(sweep),
    getStatus: () => ({ version: 1, enabled: true, metadataOnly: true,
      lateObservationSeconds: LATE_OBSERVATION_MS / 1000, activeObservations: traces.size,
      maxObservations: MAX_TRACES, maxSessionsPerObservation: MAX_SESSIONS,
      maxEventsPerObservation: MAX_EVENTS, restartResumesObservations: false }) };
}
module.exports = { createPhotoIngressObserver, LATE_OBSERVATION_MS, MAX_TRACES, MAX_SESSIONS, MAX_EVENTS };
