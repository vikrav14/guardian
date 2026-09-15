'use strict';

const fs = require('node:fs/promises');
const { normalizeWellbeingEvent, createWellbeingStore } = require('../src/care-wellbeing');

const MAX_BYTES = 64 * 1024;

function parseArguments(args) {
  let file, apply = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--apply' && !apply) apply = true;
    else if (args[i] === '--file' && !file) file = args[++i];
    else if (args[i].startsWith('--file=') && !file) file = args[i].slice(7);
    else throw new Error('Usage: npm run temperature:import -- --file <capture.jsonl> [--apply]');
  }
  if (!file || file.startsWith('--')) throw new Error('A temperature capture file is required.');
  return { file, apply };
}

function parseCapture(text, imei, { now = new Date(), retentionDays = 30 } = {}) {
  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) throw new Error('Capture file is too large.');
  const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  if (!lines[0] || lines.length > 10) throw new Error('Expected one to ten captured packets.');
  const days = Math.min(365, Math.max(1, Number(retentionDays) || 30));
  return lines.map(line => {
    let record;
    try { record = JSON.parse(line); } catch { throw new Error('Invalid capture JSON.'); }
    if (!record || record.version !== 1 || record.command !== 'btemp2' ||
        record.timeBasis !== 'gateway_receipt' || record.fieldMeaning !== 'unverified' ||
        typeof record.receivedAt !== 'string') throw new Error('Unsupported capture record.');
    const observedAt = new Date(record.receivedAt);
    if (!Number.isFinite(+observedAt) || observedAt.toISOString() !== record.receivedAt ||
        observedAt > now || observedAt <= new Date(+now - days * 86400_000)) {
      throw new Error('Capture receipt time is invalid or outside retention.');
    }
    const event = { type: 'health_reading', imei, metric: 'skin_temperature',
      sourceCommand: 'btemp2', args: record.args };
    if (!normalizeWellbeingEvent(event, observedAt).ok) throw new Error('Unsupported temperature packet shape.');
    return { event, observedAt };
  });
}

async function importCapture(text, { db, imei, enabled, retentionDays = 30,
  apply = false, now = () => new Date() } = {}) {
  // Validate the entire file before any write; never stamp old data as new.
  const packets = parseCapture(text, imei, { now: now(), retentionDays });
  if (!apply) return { outcome: 'dry_run', packets: packets.length,
    receiptTimes: packets.map(p => p.observedAt.toISOString()), privatePreviewOnly: true };
  const store = createWellbeingStore({ db, enabled, temperaturePilotImei: imei,
    deviceMode: 'unverified', customerEnabled: false, retentionDays, now });
  const results = [];
  for (const { event, observedAt } of packets) {
    const result = await store.ingest(event, observedAt);
    results.push({ status: result.status });
    if (!result.ok) return { outcome: 'stopped', results, privatePreviewOnly: true };
  }
  return { outcome: 'imported', results, privatePreviewOnly: true };
}

async function main() {
  const { file, apply } = parseArguments(process.argv.slice(2));
  const config = require('../src/config');
  const imei = config.wifiHomePilotImei;
  if (!/^\d{15}$/.test(imei || '')) throw new Error('Set WIFI_HOME_PILOT_IMEI for the watch that produced this capture.');
  const handle = await fs.open(file, 'r');
  let text;
  try {
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_BYTES) throw new Error('Capture file is too large.');
    text = buffer.subarray(0, bytesRead).toString('utf8');
  } finally { await handle.close(); }
  let db;
  if (apply) {
    const firestore = require('../src/firestore');
    firestore.initFirestore({ startWatchers: false });
    db = firestore.getDb();
  }
  const result = await importCapture(text, { db, imei, apply,
    enabled: config.careWellbeingIngestEnabled, retentionDays: config.careWellbeingRetentionDays });
  console.log(JSON.stringify(result, null, 2));
  if (result.outcome === 'stopped') process.exitCode = 1;
}

if (require.main === module) main().catch(error => {
  // JSON parser and Firestore errors can contain private input. Keep these generic.
  console.error(error.code ? 'Temperature import failed; check file access and Firestore connectivity.' : error.message);
  process.exitCode = 1;
});

module.exports = { parseArguments, parseCapture, importCapture };
