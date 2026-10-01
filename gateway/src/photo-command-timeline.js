'use strict';

// Observation only. Never delay, retry, change or acknowledge a device write.
// A write attempt is not proof of delivery or execution by the watch.
const LOOKBACK_MS = 120_000;
const BEFORE_LIMIT = 16;
const DURING_LIMIT = 48;
const SOURCES = new Set(['downlink', 'protocol_ack', 'photo_capture', 'movement_settings', 'wifi_fence_trial']);
const COMMANDS = new Set(('CR UPLOAD RCAPTURE CONFIG ICCID RYIMEI APPCONTACTTEL APPANDFNREPORT ' +
  'LK TKQ TK EICARD AL AL_LTE UD UD_LTE SEDENTARY SEDENTARYWORKTIME HRTSTART BODYTEMP BODYTEMP2 ' +
  'REMOVE VERNO FIND MONITOR CALL CENTER SOS1 SOS2 SOS3 PHBX WIFIFENCE FALLDOWN LSSET TAKEPILLS HSW REMIND').split(' '));
const END_REASONS = new Set(['image_received', 'failed', 'disconnected', 'expired']);
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const iso = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) ? value : null;

// Apply the same allowlist again on inspection. Stored data is not permission
// to print a raw frame, a phone number, radio identifier or unknown command.
function safeCommandTimeline(value) {
  if (value?.version !== 1) return null;
  return { version: 1, observationOnly: true, evidence: 'write_attempt_not_delivery',
    lookbackScope: 'capture_socket_since_gateway_start',
    startedAt: iso(value.startedAt), endedAt: iso(value.endedAt),
    endReason: END_REASONS.has(value.endReason) ? value.endReason : null,
    beforeTruncated: value.beforeTruncated === true,
    duringWriteAttempts: count(value.duringWriteAttempts),
    duringDropped: count(value.duringDropped),
    events: (Array.isArray(value.events) ? value.events : []).slice(0, BEFORE_LIMIT + DURING_LIMIT)
      .filter(row => row && Number.isSafeInteger(row.afterMs) && row.afterMs >= -LOOKBACK_MS && row.afterMs <= LOOKBACK_MS)
      .map(row => ({ phase: row.phase === 'before' ? 'before' : 'during', afterMs: row.afterMs,
        source: SOURCES.has(row.source) ? row.source : 'other',
        command: COMMANDS.has(row.command) ? row.command : 'OTHER',
        bytes: count(row.bytes), sameSession: row.sameSession === true,
        ...(Number.isInteger(row.reportingIntervalSeconds) && row.command === 'UPLOAD' &&
          row.reportingIntervalSeconds >= 1 && row.reportingIntervalSeconds <= 86400
          ? { reportingIntervalSeconds: row.reportingIntervalSeconds } : {}) })),
  };
}

function createPhotoCommandObserver() {
  const recent = new WeakMap();
  const activeBySocket = new WeakMap();
  const activeByDevice = new Map();
  const identity = session => /^\d{15}$/.test(session?.imei || '') && /^\d{10,15}$/.test(session?.protocolId || '')
    ? `${session.imei}:${session.protocolId}` : null;

  function noteWrite(socket, session, frame, source, at = Date.now()) {
    // Diagnostics must never prevent a protocol reply, emergency action or
    // camera command, including if this observer itself fails.
    try {
      if (!socket || !Buffer.isBuffer(frame) || !Number.isFinite(+at)) return;
      const time = +at;
      // Only a bounded ASCII command header is inspected. Payloads are never
      // retained; unknown headers/commands become OTHER.
      const header = frame.subarray(0, 96).toString('latin1');
      const match = /^\[[a-z0-9]{2}\*\d{10,15}\*[a-f0-9]{4}\*([a-z0-9_]+)(?=[,\]])/i.exec(header);
      const name = match?.[1].toUpperCase();
      const interval = /^\[[a-z0-9]{2}\*\d{10,15}\*[a-f0-9]{4}\*UPLOAD,(\d{1,5})\]$/i.exec(header);
      const row = { source: SOURCES.has(source) ? source : 'other',
        command: COMMANDS.has(name) ? name : 'OTHER', bytes: frame.length,
        ...(interval && +interval[1] >= 1 && +interval[1] <= 86400
          ? { reportingIntervalSeconds: +interval[1] } : {}) };
      const history = recent.get(socket) || { events: [], droppedAt: -Infinity };
      history.events = history.events.filter(item => item.time >= time - LOOKBACK_MS);
      history.events.push({ time, row });
      if (history.events.length > BEFORE_LIMIT) history.droppedAt = history.events.shift().time;
      recent.set(socket, history);
      // Look up only this socket/device, rather than scanning every family's
      // active captures for each packet acknowledgement.
      const candidates = new Set([...(activeBySocket.get(socket) || []),
        ...(activeByDevice.get(identity(session)) || [])]);
      for (const trace of candidates) {
        if (time >= trace.expiresAt) { trace.stop('expired', trace.expiresAt); continue; }
        if (time < trace.startedAt) continue;
        const data = trace.data;
        data.duringWriteAttempts++;
        if (data.duringWriteAttempts > DURING_LIMIT) { data.duringDropped++; continue; }
        data.events.push({ ...row, phase: 'during', afterMs: time - trace.startedAt,
          sameSession: socket === trace.socket && session === trace.session });
      }
    } catch { /* Observation failure must not change the original write. */ }
  }

  function begin({ socket, session, startedAt, expiresAt }) {
    const start = +startedAt, end = Math.min(+expiresAt, start + LOOKBACK_MS);
    const history = recent.get(socket);
    const prior = (history?.events || []).filter(row => row.time >= start - LOOKBACK_MS && row.time <= start);
    const data = { version: 1, startedAt: new Date(start).toISOString(), endedAt: null, endReason: null,
      beforeTruncated: history?.droppedAt >= start - LOOKBACK_MS,
      duringWriteAttempts: 0, duringDropped: 0,
      events: prior.map(({ time, row }) => ({ ...row, phase: 'before', afterMs: time - start, sameSession: true })) };
    let timer;
    const key = identity(session);
    const trace = { socket, session,
      startedAt: start, expiresAt: end, data,
      stop(reason, at = Date.now()) {
        if (data.endedAt) return;
        clearTimeout(timer);
        activeBySocket.get(socket)?.delete(trace);
        const deviceTraces = activeByDevice.get(key);
        deviceTraces?.delete(trace);
        if (deviceTraces?.size === 0) activeByDevice.delete(key);
        data.endedAt = new Date(Math.min(end, Math.max(start, +at))).toISOString();
        data.endReason = END_REASONS.has(reason) ? reason : 'failed';
      } };
    if (!activeBySocket.has(socket)) activeBySocket.set(socket, new Set());
    activeBySocket.get(socket).add(trace);
    if (key) {
      if (!activeByDevice.has(key)) activeByDevice.set(key, new Set());
      activeByDevice.get(key).add(trace);
    }
    // Relative duration supports an injected controller clock in tests. This
    // timer only bounds observer memory; it never touches a socket or request.
    timer = setTimeout(() => trace.stop('expired', end), Math.max(0, end - start));
    timer.unref?.();
    return { snapshot: () => safeCommandTimeline(data), stop: trace.stop };
  }
  return { noteWrite, begin };
}

const observer = createPhotoCommandObserver();
module.exports = { createPhotoCommandObserver, safeCommandTimeline,
  noteDeviceWrite: observer.noteWrite, beginPhotoCommandTimeline: observer.begin };
