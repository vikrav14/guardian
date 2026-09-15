'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { validConsent } = require('./care-wellbeing');

const WINDOW_MS = 10 * 60_000;
const MAX_PACKETS = 10;
const MAX_PAYLOAD_BYTES = 2048;

// Engineering evidence only: btemp2 was observed on the pilot, but its fields,
// units and measurement time are not yet verified. Do not manufacture a reading.
function createTemperatureCapture({ enabled = false, pilotImei, readConsent,
  write, clock = Date.now, onStatus = () => {} } = {}) {
  const startedAt = clock();
  const expiresAt = startedAt + WINDOW_MS;
  const active = enabled === true && /^\d{15}$/.test(pilotImei || '') &&
    typeof readConsent === 'function' && typeof write === 'function';
  let attempted = 0;
  let pending = Promise.resolve();
  function status(reason) {
    try { onStatus(reason); } catch { /* Diagnostics cannot affect packet handling. */ }
  }
  function inWindow() { const at = clock(); return at >= startedAt && at < expiresAt; }

  function observe(decoded, session, receivedAt = new Date(clock())) {
    if (!active || !inWindow() || attempted >= MAX_PACKETS || decoded?.error ||
        decoded?.command !== 'btemp2' || session?.imei !== pilotImei) return;
    const args = decoded.args;
    if (!Array.isArray(args) || args.length > 32 ||
        args.some(arg => typeof arg !== 'string' || arg.length > 256) ||
        typeof decoded.payload !== 'string' ||
        decoded.payload !== ['btemp2', ...args].join(',') ||
        Buffer.byteLength(decoded.payload, 'utf8') > MAX_PAYLOAD_BYTES ||
        !(receivedAt instanceof Date) || !Number.isFinite(+receivedAt)) {
      status('payload_rejected'); return;
    }
    // Bound pending consent reads/writes too, including when Firestore is slow.
    attempted += 1;
    const record = { version: 1, command: 'btemp2', receivedAt: receivedAt.toISOString(),
      timeBasis: 'gateway_receipt', fieldMeaning: 'unverified', args: [...args] };
    pending = pending.then(async () => {
      if (!inWindow()) return;
      const consent = await readConsent(pilotImei);
      // Check again after the await: expired capture/consent cannot retain values.
      if (!inWindow()) return;
      if (!validConsent(consent, new Date(clock()))) { status('consent_required'); return; }
      await write(record);
      status('packet_saved');
    }).catch(() => status('capture_failed'));
  }
  return { observe, flush: () => pending, active, expiresAt };
}

function startTemperatureCapture({ enabled = false, config, db, log = console.log } = {}) {
  if (!enabled) return createTemperatureCapture();
  if (!db || config?.careWellbeingIngestEnabled !== true ||
      !/^\d{15}$/.test(config?.wifiHomePilotImei || '')) {
    throw new Error('Temperature capture needs Firestore, wellbeing ingestion and WIFI_HOME_PILOT_IMEI.');
  }
  const folder = path.join(__dirname, '../data/temperature-captures');
  const savedTo = path.join(folder, `${Date.now()}-${randomUUID()}.jsonl`);
  let fileCreated = false;
  const capture = createTemperatureCapture({ enabled, pilotImei: config.wifiHomePilotImei,
    readConsent: async imei => {
      const snap = await db.collection('wellbeingConsents').doc(imei).get();
      return snap.exists ? snap.data() : null;
    },
    write: async record => {
      await fs.mkdir(folder, { recursive: true, mode: 0o700 });
      await fs.writeFile(savedTo, `${JSON.stringify(record)}\n`, {
        flag: fileCreated ? 'a' : 'wx', mode: 0o600,
      });
      fileCreated = true;
    },
    // Numeric payloads stay out of gateway logs and customer/Firestore records.
    onStatus: status => log(`[temperature-capture] ${JSON.stringify({ status,
      ...(status === 'packet_saved' ? { savedTo } : {}) })}`),
  });
  log(`[temperature-capture] ${JSON.stringify({ status: 'armed', command: 'btemp2',
    expiresAt: new Date(capture.expiresAt).toISOString(), maxPackets: MAX_PACKETS, savedTo })}`);
  const timer = setTimeout(() => log('[temperature-capture] Window ended; gateway continues running.'), WINDOW_MS);
  timer.unref?.();
  return capture;
}

module.exports = { createTemperatureCapture, startTemperatureCapture, WINDOW_MS, MAX_PACKETS };
