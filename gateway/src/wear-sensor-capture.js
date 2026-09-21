'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { validConsent } = require('./care-wellbeing');

const WINDOW_MS = 10 * 60_000;
const MAX_PACKETS = 10;
const MAX_PAYLOAD_BYTES = 2048;

// Preserve the complete response from the two observed V52 optical measurement
// uploads, including empty/error/trailing fields. No field is a wearing signal
// until its meaning and exact-device behaviour have been independently verified.
// This observer never issues a measurement request or changes decoded events.
function createWearSensorCapture({ enabled = false, pilotImei, readConsent,
  write, clock = Date.now, onStatus = () => {} } = {}) {
  const startedAt = clock();
  const expiresAt = startedAt + WINDOW_MS;
  const configured = enabled === true && /^\d{15}$/.test(pilotImei || '') &&
    typeof readConsent === 'function' && typeof write === 'function';
  const sessions = new WeakMap();
  let sessionNumber = 0, attempted = 0;
  let pending = Promise.resolve();
  function status(reason) {
    try { onStatus(reason); } catch { /* Diagnostics cannot affect the gateway. */ }
  }
  function inWindow() {
    const now = clock();
    return now >= startedAt && now < expiresAt;
  }
  function active() { return configured && inWindow() && attempted < MAX_PACKETS; }

  function observe(decoded, session, receivedAt = new Date(clock()), frame) {
    try {
      if (!active() || decoded?.error || session?.imei !== pilotImei ||
          !/^(?:bphrt|oxygen)$/i.test(decoded?.command || '')) return;
      const args = decoded.args;
      if (!Array.isArray(args) || args.length > 32 ||
          args.some(arg => typeof arg !== 'string' || arg.length > 256) ||
          typeof decoded.payload !== 'string' ||
          decoded.payload !== [decoded.command, ...args].join(',') ||
          Buffer.byteLength(decoded.payload, 'utf8') > MAX_PAYLOAD_BYTES ||
          !(receivedAt instanceof Date) || !Number.isFinite(+receivedAt) ||
          +receivedAt < startedAt || +receivedAt >= expiresAt) {
        status('payload_rejected'); return;
      }
      // Bound queued reads too: a slow/offline consent store cannot accumulate
      // unbounded sensitive values. Freeze the packet before any async work.
      attempted += 1;
      if (!sessions.has(session)) sessions.set(session, ++sessionNumber);
      const header = Buffer.isBuffer(frame) ? frame.subarray(0, 64).toString('ascii')
        .match(/^\[([A-Za-z0-9]{2})\*(\d{10,15})\*([0-9a-fA-F]{4})\*/) : null;
      const record = { version: 1, packet: attempted, session: sessions.get(session),
        command: decoded.command, receivedAt: receivedAt.toISOString(),
        timeBasis: 'gateway_receipt', fieldMeaning: 'unverified', wearingInferred: false,
        argumentCount: args.length, args: [...args],
        frameBytes: Buffer.isBuffer(frame) ? frame.length : null,
        payloadLengthMatches: header
          ? parseInt(header[3], 16) === frame.length - header[0].length - 1 : null };
      pending = pending.then(async () => {
        if (!inWindow()) return;
        const consent = await readConsent(pilotImei);
        if (!inWindow()) return;
        if (!validConsent(consent, new Date(clock()))) { status('consent_required'); return; }
        await write(record);
        status('packet_saved');
      }).catch(() => status('capture_failed'));
    } catch { status('capture_failed'); }
  }
  return { observe, flush: () => pending, get active() { return active(); }, expiresAt };
}

function startWearSensorCapture({ enabled = false, config, db,
  directory = path.join(__dirname, '../data/wear-sensor-captures'), log = console.log } = {}) {
  if (!enabled) return createWearSensorCapture();
  if (!db || config?.careWellbeingIngestEnabled !== true ||
      !/^\d{15}$/.test(config?.wifiHomePilotImei || '')) {
    throw new Error('Wear sensor capture needs Firestore, wellbeing ingestion and WIFI_HOME_PILOT_IMEI.');
  }
  const savedTo = path.join(directory, `${Date.now()}-${randomUUID()}.jsonl`);
  let fileCreated = false;
  const safeLog = record => {
    try { log(`[wear-sensor-capture] ${JSON.stringify(record)}`); } catch { /* Observer only. */ }
  };
  const capture = createWearSensorCapture({ enabled, pilotImei: config.wifiHomePilotImei,
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
    // Values stay in the consent-gated private file, never ordinary logs.
    onStatus: status => safeLog({ status, ...(status === 'packet_saved' ? { savedTo } : {}) }),
  });
  safeLog({ status: 'armed', commands: ['bphrt', 'oxygen'],
    expiresAt: new Date(capture.expiresAt).toISOString(), maxPackets: MAX_PACKETS,
    savedTo, changesWatchSettings: false, sendsMeasurementRequests: false });
  const timer = setTimeout(() => safeLog({ status: 'window_ended', gatewayContinues: true }), WINDOW_MS);
  timer.unref?.();
  return capture;
}

module.exports = { createWearSensorCapture, startWearSensorCapture, WINDOW_MS, MAX_PACKETS };
