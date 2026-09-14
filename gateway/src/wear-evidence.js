'use strict';

const { randomUUID } = require('node:crypto');
const { extractV52TrackerState } = require('./protocol/gt06');
const FRESH_MS = 120_000;
const DEBOUNCE_MS = 60_000;
const ACCEPTED_MODE = 'v52_bit3_worn';

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

// Annex I: fixed field 15, bit 3 wearing status, bit 20 removal ALARM.
// Polarity/behaviour must be accepted on the exact firmware before interpretation.
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

function createWearEvidence({ db, enabled = false, deviceMode = 'unverified', acceptedImeis = [],
  onError = () => {} } = {}) {
  const devices = new Map(), pending = new Map();
  const allowlist = new Set(acceptedImeis);

  function persist(imei, state, at) {
    if (!db) return;
    const summary = { ...state.evidence, updatedAt: at };
    delete summary.continuityId;
    const diagnostic = { version: 1, updatedAt: at, deviceMode,
      deviceAccepted: state.accepted, status: summary, samples: state.samples };
    // Coalesce pending writes: slow Firestore never queues unlimited heartbeats
    // or delays ACKs/SOS. Retained raw status samples are capped at 120.
    const work = pending.get(imei) || { next: null, running: false };
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
            tx.set(statusRef, item.summary);
            tx.set(device.collection('wearDiagnostics').doc('current'), item.diagnostic);
          });
        }
      } catch (error) { onError(error); }
      finally { pending.delete(imei); }
    })();
  }

  function capture(decoded, events, session, at) {
    const imei = events.find(event => event.imei)?.imei;
    if (!enabled || !imei) return;
    let state = devices.get(imei);
    if (!state || state.session !== session) {
      state = { session, accepted: deviceMode === ACCEPTED_MODE && allowlist.has(imei),
        evidence: unknown('new_session'), candidate: null, lastDeviceAt: null, samples: [] };
      devices.set(imei, state);
      persist(imei, state, at);
    }
    const signal = parseWearSignal(decoded);
    if (state.evidence.state !== 'unknown' && !wearAt(state.evidence, at).expiresAt) {
      state.evidence = unknown('wearing_evidence_expired'); state.candidate = null;
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
    }
    // Snapshot before any remote await or location queue. A later packet cannot
    // retroactively lend its wearing proof to an earlier counter/health upload.
    for (const event of events) event.wearEvidence = Object.freeze(wearAt(state.evidence, at));
  }

  function disconnect(imei, session, at = new Date()) {
    const state = devices.get(imei);
    if (state?.session !== session) return;
    state.evidence = unknown('watch_disconnected'); state.candidate = null;
    persist(imei, state, at); devices.delete(imei);
  }
  return { capture, disconnect };
}

module.exports = { createWearEvidence, parseWearSignal, wearAt, unknown, ACCEPTED_MODE, FRESH_MS };
