'use strict';

const { buildDeviceAcceptanceReport } = require('../src/device-acceptance');

function readArgument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function parseSince(value, now = new Date()) {
  if (!value) return new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const duration = String(value).match(/^(\d+)(m|h|d)$/i);
  if (duration) {
    const unitMs = { m: 60000, h: 3600000, d: 86400000 }[duration[2].toLowerCase()];
    return new Date(now.getTime() - Number(duration[1]) * unitMs);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('--since must be an ISO timestamp or a duration such as 30m, 12h or 2d.');
  }
  return parsed;
}

function docsWithIds(snapshot) {
  return snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
}

async function loadEvidence(db, imei) {
  const deviceRef = db.collection('devices').doc(imei);
  const [device, alerts, commands, logs, reminders] = await Promise.all([
    deviceRef.get(),
    db.collection('alerts').where('imei', '==', imei).get(),
    db.collection('deviceCommands').where('imei', '==', imei).get(),
    db.collection('notificationLogs').where('imei', '==', imei).get(),
    db.collection('medicationReminders').where('imei', '==', imei).get(),
  ]);
  if (!device.exists) throw new Error(`devices/${imei} was not found.`);
  return {
    device: device.data() || {},
    alerts: docsWithIds(alerts),
    deviceCommands: docsWithIds(commands),
    notificationLogs: docsWithIds(logs),
    reminders: docsWithIds(reminders),
  };
}

async function main() {
  const imei = String(readArgument('imei') || '').trim();
  if (!/^\d{10,20}$/.test(imei)) {
    throw new Error(
      'Usage: node scripts/inspect-device-acceptance.js --imei <digits> [--since 24h] [--require-complete]'
    );
  }
  const now = new Date();
  const since = parseSince(readArgument('since'), now);
  const { initFirestore, getDb } = require('../src/firestore');
  initFirestore({ startWatchers: false });
  const db = getDb();
  if (!db) throw new Error('Firestore is unavailable.');

  const evidence = await loadEvidence(db, imei);
  const report = buildDeviceAcceptanceReport(evidence, { since, now });
  console.log(JSON.stringify({ imei, ...report }, null, 2));
  if (hasFlag('require-complete') && !report.machineEvidenceComplete) {
    process.exitCode = 2;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  docsWithIds,
  loadEvidence,
  parseSince,
};
