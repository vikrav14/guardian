'use strict';

function iso(value) {
  const date = value?.toDate?.() || (value == null ? null : new Date(value));
  return date && Number.isFinite(+date) ? date.toISOString() : null;
}

async function loadWearReport(db, imei, now = new Date()) {
  const doc = await db.collection('devices').doc(imei).collection('wearDiagnostics').doc('current').get();
  const data = doc.exists ? doc.data() : null;
  const status = data?.status;
  const expires = iso(status?.expiresAt), observed = iso(status?.observedAt);
  const fresh = !!expires && !!observed && +new Date(observed) <= +now && +new Date(expires) > +now;
  return { outcome: 'read_only', asOf: now.toISOString(),
    configurationSource: 'persisted_running_gateway',
    gatewayUpdatedAt: iso(data?.updatedAt), deviceMode: data?.deviceMode || 'no_capture_yet',
    deviceAccepted: data?.deviceAccepted === true,
    wearingStatus: fresh && data?.deviceAccepted === true ? status.state : 'unknown',
    reason: !data ? 'no_capture_yet' : fresh ? status.reason : 'wearing_unconfirmed',
    observedAt: observed, expiresAt: expires,
    samples: (data?.samples || []).slice(-120).map(sample => ({
      command: sample.command, observedAt: iso(sample.observedAt), receivedAt: iso(sample.receivedAt),
      trackerState: sample.trackerState, wearBit: sample.wearBit, removalAlarmBit: sample.removalAlarmBit,
    })),
    interpretation: 'Raw bits require exact-watch comparison. No watch command or notification is sent. Online does not prove worn.',
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length && !/^--save=[a-z0-9_-]{1,40}$/.test(args[0]))) {
    throw new Error('Usage: npm run wear:check [-- --save=removed]');
  }
  const config = require('../src/config');
  const imei = String(config.wifiHomePilotImei || '').trim();
  if (!/^\d{15}$/.test(imei)) throw new Error('Set WIFI_HOME_PILOT_IMEI to the pilot watch.');
  const { initFirestore, getDb } = require('../src/firestore');
  initFirestore({ startWatchers: false });
  const db = getDb();
  if (!db) throw new Error('Firestore is unavailable.');
  const report = await loadWearReport(db, imei);
  if (args.length) report.manualMarker = { label: args[0].slice(7), at: report.asOf };
  const output = JSON.stringify(report, null, 2); console.log(output);
  if (args.length) {
    const fs = require('node:fs'), path = require('node:path');
    const folder = path.join(__dirname, '../data/wear-checks');
    fs.mkdirSync(folder, { recursive: true });
    const savedTo = path.join(folder, `${Date.now()}-${args[0].slice(7)}.json`);
    fs.writeFileSync(savedTo, output + '\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ savedTo }));
  }
}

if (require.main === module) main().catch(error => { console.error(`ERROR: ${error.message}`); process.exitCode = 1; });
module.exports = { loadWearReport };
