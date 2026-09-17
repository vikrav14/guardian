'use strict';

const { randomUUID } = require('node:crypto');
const { extractV52TrackerState } = require('./protocol/gt06');
const FRESH_MS = 120_000;
const DEBOUNCE_MS = 60_000;
const ACCEPTED_MODE = 'v52_bit3_worn';
const TRACE_LIMIT = 120;
const TRACE_DEVICE_LIMIT = 128;

function date(value) {
  if (value == null) return null;
  const result = value?.toDate?.() || new Date(value);
  return Number.isFinite(+result) ? result : null;
}

function unknown(reason = 'no_wearing_evidence') {
  return { version: 1, state: 'unknown', reason, eligible: false,
    observedAt: null, expiresAt: null, continuityId: null };
}

// This is a data-quality contract, not a clinical or safety verdict. Receipt of
// a heartbeat, GPS fix, steps or plausible vitals cannot satisfy it.
function wearAt(evidence, at) {
  const observed = date(evidence?.observedAt), expires = date(evidence?.expiresAt);
  if (evidence?.version !== 1 || !date(at) || !observed || !expires ||
      +observed > +date(at) || +expires <= +date(at) ||
      +expires - +observed > FRESH_MS || evidence.deviceAccepted !== true ||
      !['worn', 'removed'].includes(evidence.state)) {
    return unknown(evidence?.reason === 'device_unverified' ? 'device_unverified' : 'wearing_unconfirmed');
  }
  const eligible = evidence.state === 'worn' && typeof evidence.continuityId === 'string' &&
    evidence.continuityId.length > 0;
  return { ...evidence, eligible };
}

// Annex I labels bit 3 wearing; the companion Example p5 calls it unused.
// Keep this conflicting mapping unverified without exact-firmware evidence.
// Fixed field 15, bit 20 is a removal ALARM, not positive wearing proof.
// UD2 is buffered history. Never use it (or a variable LTE tail) for current wear.
function parseWearSignal(decoded) {
  const command = decoded?.command || '';
  if (!/^(UD|AL)(?:_(?:LTE|WCDMA))?$/.test(command)) return undefined;
  const args = decoded.args, trackerState = extractV52TrackerState(args);
  if (!trackerState || !/^\d{6}$/.test(args[0] || '') || !/^\d{6}$/.test(args[1] || '')) return null;
  const [d, m, y] = args[0].match(/../g).map(Number);
  const [h, minute, second] = args[1].match(/../g).map(Number);
  const observedAt = new Date(Date.UTC(2000 + y, m - 1, d, h, minute, second));
  if (observedAt.getUTCMonth() !== m - 1 || observedAt.getUTCDate() !== d ||
      h > 23 || minute > 59 || second > 59) return null;
  const bits = parseInt(trackerState, 16);
  return { command, trackerState, observedAt, wearBit: (bits & (1 << 3)) !== 0,
    removalAlarmBit: (bits & (1 << 20)) !== 0 };
}

function bitmapBits(value) {
  if (!value) return [];
  const bits = Number.parseInt(value, 16) >>> 0;
  return Array.from({ length: 32 }, (_, bit) => bit).filter(bit => (bits >>> bit) & 1);
}

function traceDecision(decoded, signal, lastDeviceAt, at) {
  if (/^UD2(?:_|$)/i.test(decoded.command)) return 'buffered_history';
  if (signal === undefined) return 'unsupported_status_command';
  if (signal === null) return 'invalid_status_packet';
  if (+signal.observedAt > +at) return 'future_device_time';
  if (+at - +signal.observedAt > FRESH_MS) return 'stale_device_time';
  if (lastDeviceAt && +signal.observedAt === +lastDeviceAt) return 'duplicate_device_time';
  if (lastDeviceAt && +signal.observedAt < +lastDeviceAt) return 'out_of_order_device_time';
  return 'live_status_sample';
}

// Receipt diagnostics deliberately precede the eligibility filters. A delayed
// alarm, same-second status change or buffered packet is useful for protocol
// investigation even though it must not establish present wearing status.
function statusTrace(decoded, signal, state, diagnostic, at) {
  if (typeof decoded?.command !== 'string' || decoded.command.length > 32 ||
      !/^(?:UD|AL)[A-Z0-9_]*$/i.test(decoded.command)) return null;
  const trackerState = extractV52TrackerState(decoded.args);
  const previous = diagnostic.lastBitmap;
  const changed = trackerState && previous
    ? ((Number.parseInt(trackerState, 16) ^ Number.parseInt(previous, 16)) >>> 0)
      .toString(16).padStart(8, '0') : null;
  if (trackerState) diagnostic.lastBitmap = trackerState;
  // Reuse the fixed-layout timestamp validator for history/other variants;
  // its result is diagnostic only and never goes into the wear state machine.
  const timestamp = signal || parseWearSignal({ ...decoded, command: 'UD' });
  return { kind: 'status', session: diagnostic.sessionNumber, command: decoded.command,
    receivedAt: at, deviceObservedAt: timestamp?.observedAt || null,
    trackerState, setBits: bitmapBits(trackerState), changedBits: bitmapBits(changed),
    previousTrackerState: previous || null,
    decision: traceDecision(decoded, signal, state.lastDeviceAt, at) };
}

function createWearEvidence({ db, enabled = false, deviceMode = 'unverified', acceptedImeis = [],
  onError = () => {} } = {}) {
  const devices = new Map(), pending = new Map(), diagnostics = new Map();
  const allowlist = new Set(acceptedImeis);

  function diagnosticFor(imei) {
    let diagnostic = diagnostics.get(imei);
    if (!diagnostic) diagnostic = { sessionNumber: 0, lastBitmap: null,
      receivedStatusPackets: 0, droppedEntries: 0, entries: [] };
    // Retain the most recently observed devices only. Traces survive socket
    // reconnects, while production wearing evidence still starts from unknown.
    diagnostics.delete(imei); diagnostics.set(imei, diagnostic);
    if (diagnostics.size > TRACE_DEVICE_LIMIT) diagnostics.delete(diagnostics.keys().next().value);
    return diagnostic;
  }
  function appendTrace(diagnostic, entry) {
    if (entry.kind === 'status') diagnostic.receivedStatusPackets += 1;
    diagnostic.entries.push(entry);
    if (diagnostic.entries.length > TRACE_LIMIT) {
      diagnostic.entries.shift(); diagnostic.droppedEntries += 1;
    }
  }

  function persist(imei, state, at) {
    if (!db) return;
    const summary = { ...state.evidence, updatedAt: at,
      lastRemovalReportedAt: state.lastRemovalReportedAt || null };
    delete summary.continuityId;
    const trace = diagnostics.get(imei);
    const diagnostic = { version: 1, updatedAt: at, deviceMode,
      deviceAccepted: state.accepted, status: summary, samples: state.samples };
    if (trace) diagnostic.receivedStatusTrace = { version: 1, maxEntries: TRACE_LIMIT,
      receivedStatusPackets: trace.receivedStatusPackets, droppedEntries: trace.droppedEntries,
      entries: [...trace.entries] };
    // Coalesce pending writes: slow Firestore never queues unlimited heartbeats
    // or delays ACKs/SOS. Retained raw status samples are capped at 120.
    const work = pending.get(imei) || { next: null, running: false };
    const queuedRemoval = date(work.next?.summary.lastRemovalReportedAt);
    if (queuedRemoval && (!summary.lastRemovalReportedAt ||
        +queuedRemoval > +summary.lastRemovalReportedAt)) {
      summary.lastRemovalReportedAt = queuedRemoval;
    }
    work.next = { summary, diagnostic }; pending.set(imei, work);
    if (work.running) return;
    work.running = true;
    void (async () => {
      try {
        while (work.next) {
          const item = work.next; work.next = null;
          const device = db.collection('devices').doc(imei);
          const statusRef = device.collection('wearStatus').doc('current');
          await db.runTransaction(async tx => {
            const prior = await tx.get(statusRef);
            if (prior.exists && +date(prior.data().updatedAt) > +item.summary.updatedAt) return;
            // This is dated event history, independent of wearing eligibility.
            // Preserve it across zero-bit packets, disconnects and restarts.
            const previousRemoval = prior.exists ? date(prior.data().lastRemovalReportedAt) : null;
            const currentRemoval = date(item.summary.lastRemovalReportedAt);
            const summary = { ...item.summary, lastRemovalReportedAt:
              previousRemoval && +previousRemoval <= +item.summary.updatedAt &&
              (!currentRemoval || +previousRemoval > +currentRemoval)
                ? previousRemoval : currentRemoval };
            tx.set(statusRef, summary);
            tx.set(device.collection('wearDiagnostics').doc('current'),
              { ...item.diagnostic, status: summary });
          });
        }
      } catch (error) { onError(error); }
      finally { pending.delete(imei); }
    })();
  }

  function capture(decoded, events, session, at) {
    const imei = events.find(event => event.imei)?.imei;
    if (!enabled || !imei) return;
    const diagnostic = diagnosticFor(imei);
    let state = devices.get(imei);
    if (!state || state.session !== session) {
      state = { session, accepted: deviceMode === ACCEPTED_MODE && allowlist.has(imei),
        evidence: unknown('new_session'), candidate: null, lastDeviceAt: null, samples: [],
        lastRemovalReportedAt: state?.lastRemovalReportedAt || null };
      devices.set(imei, state);
      diagnostic.sessionNumber += 1; diagnostic.lastBitmap = null;
      appendTrace(diagnostic, { kind: 'session_started', session: diagnostic.sessionNumber,
        receivedAt: at });
      persist(imei, state, at);
    } else if (diagnostic.sessionNumber === 0) {
      // This device's older trace may have been evicted by the bounded cache.
      // Starting a new trace must not reset the still-live wearing state.
      diagnostic.sessionNumber = 1;
      appendTrace(diagnostic, { kind: 'trace_resumed', session: diagnostic.sessionNumber,
        receivedAt: at });
    }
    const signal = parseWearSignal(decoded);
    const trace = statusTrace(decoded, signal, state, diagnostic, at);
    if (trace) appendTrace(diagnostic, trace);
    // AL bit 20 reports a removal event even on an unverified firmware. A
    // later zero bitmap cannot establish that the watch is back on the wrist.
    // Use the device observation time, not delayed receipt time, for history.
    if (signal?.removalAlarmBit && /^AL(?:_|$)/.test(signal.command) &&
        +signal.observedAt <= +at && +at - +signal.observedAt <= FRESH_MS &&
        (!state.lastRemovalReportedAt || +signal.observedAt > +state.lastRemovalReportedAt)) {
      state.lastRemovalReportedAt = signal.observedAt;
    }
    if (state.evidence.state !== 'unknown' && !wearAt(state.evidence, at).expiresAt) {
      state.evidence = unknown('wearing_evidence_expired'); state.candidate = null;
      persist(imei, state, at);
    }
    if (state.accepted && signal?.removalAlarmBit && state.lastDeviceAt &&
        +signal.observedAt === +state.lastDeviceAt &&
        +signal.observedAt <= +at && +at - +signal.observedAt <= FRESH_MS &&
        (state.evidence.state === 'worn' || state.candidate?.target === 'worn')) {
      // Firmware timestamps have one-second resolution. An alarm in the same
      // second as the latest position is still contradictory evidence: revoke
      // qualification now, but keep strict ordering for positive confirmation.
      // Older/history packets cannot enter this path or erase newer proof.
      state.evidence = unknown('same_timestamp_removal_alarm'); state.candidate = null;
      if (trace) trace.decision = 'same_timestamp_removal_invalidated_wearing';
      persist(imei, state, at);
    }
    if (signal && +at - +signal.observedAt <= FRESH_MS && +signal.observedAt <= +at &&
        (!state.lastDeviceAt || +signal.observedAt > +state.lastDeviceAt)) {
      const gap = state.lastDeviceAt && +signal.observedAt - +state.lastDeviceAt >= FRESH_MS;
      state.lastDeviceAt = signal.observedAt;
      state.samples = [...state.samples, { ...signal, receivedAt: at }].slice(-120);
      const target = signal.wearBit && signal.removalAlarmBit ? 'unknown' : signal.wearBit ? 'worn' : 'removed';
      if (!state.accepted || target === 'unknown') {
        state.evidence = unknown(!state.accepted ? 'device_unverified' : 'conflicting_wear_signals');
        state.candidate = null;
      } else {
        if (gap) { state.evidence = unknown('wearing_evidence_expired'); state.candidate = null; }
        if (state.evidence.state === target) {
          state.evidence = { ...state.evidence, observedAt: signal.observedAt,
            expiresAt: new Date(+signal.observedAt + FRESH_MS) };
        } else {
          // A contradictory observation immediately stops eligibility, while
          // status confirmation waits for distinct observations over 60 s.
          state.evidence = unknown('confirming_wearing_status');
          if (state.candidate?.target !== target ||
              +signal.observedAt - +state.candidate.lastAt >= FRESH_MS) {
            state.candidate = { target, since: signal.observedAt, lastAt: signal.observedAt };
          } else if (+signal.observedAt - +state.candidate.since >= DEBOUNCE_MS) {
            state.evidence = { version: 1, state: target, reason: 'repeated_wear_observations',
              deviceAccepted: true, eligible: target === 'worn',
              continuityId: target === 'worn' ? randomUUID() : null,
              observedAt: signal.observedAt, expiresAt: new Date(+signal.observedAt + FRESH_MS) };
            state.candidate = null;
          } else state.candidate.lastAt = signal.observedAt;
        }
      }
      persist(imei, state, at);
    } else if (signal === null) {
      state.evidence = unknown('invalid_wearing_packet'); state.candidate = null;
      persist(imei, state, at);
    } else if (trace) {
      // Preserve the rejected receipt without changing wearing evidence,
      // candidates, timestamps or the accepted live-sample collection.
      persist(imei, state, at);
    }
    // Snapshot before any remote await or location queue. A later packet cannot
    // retroactively lend its wearing proof to an earlier counter/health upload.
    for (const event of events) event.wearEvidence = Object.freeze(wearAt(state.evidence, at));
  }

  function disconnect(imei, session, at = new Date()) {
    const state = devices.get(imei);
    if (state?.session !== session) return;
    const diagnostic = diagnosticFor(imei);
    appendTrace(diagnostic, { kind: 'session_disconnected', session: diagnostic.sessionNumber,
      receivedAt: at });
    state.evidence = unknown('watch_disconnected'); state.candidate = null;
    persist(imei, state, at); devices.delete(imei);
  }
  return { capture, disconnect, current: (imei, at = new Date()) =>
    wearAt(devices.get(imei)?.evidence, at) };
}

module.exports = { createWearEvidence, parseWearSignal, wearAt, unknown, ACCEPTED_MODE, FRESH_MS,
  TRACE_LIMIT, TRACE_DEVICE_LIMIT };
