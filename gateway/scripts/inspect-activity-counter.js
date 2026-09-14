'use strict';

const { localDateKey } = require('../src/activity-steps');
const { summarizeActivityDay, summarizeActivityState, summarizeActivityInterval } = require('../src/activity-counter-diagnostics');

async function loadActivityReport(db, imei, config, now = new Date()) {
  const device = db.collection('devices').doc(imei);
  const timeZone = config.activityStepsTimeZone || 'Indian/Mauritius';
  const dates = [now, new Date(+now - 86_400_000)].map(at => localDateKey(at, timeZone));
  const [state, intervals, ...days] = await Promise.all([
    device.collection('activityState').doc('counter').get(),
    device.collection('activityIntervals').orderBy('to', 'desc').limit(8).get(),
    ...dates.map(day => device.collection('activityDays').doc(day).get()),
  ]);
  return {
    outcome: 'read_only', asOf: now.toISOString(), localDate: dates[0], timeZone,
    configurationSource: 'this_command_environment_not_running_gateway',
    configuration: { ingestEnabled: config.activityStepsIngestEnabled === true,
      counterMode: config.activityStepsCounterMode || 'unverified',
      customerEnabled: config.activityStepsCustomerEnabled === true },
    persistedGatewayState: summarizeActivityState(state.exists ? state.data() : null),
    days: days.filter(day => day.exists).map(day => summarizeActivityDay(day.data())),
    recentIntervals: intervals.docs.map(doc => summarizeActivityInterval(doc.data())),
    interpretation: 'recordedSteps counts observed increases only; unallocated steps and missing periods are not zero activity',
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length && !/^--save=[a-z0-9_-]{1,40}$/.test(args[0]))) {
    throw new Error('Usage: npm run activity:check [-- --save=before-midnight]');
  }
  const config = require('../src/config');
  const imei = String(config.wifiHomePilotImei || '').trim();
  if (!/^\d{15}$/.test(imei)) throw new Error('Set WIFI_HOME_PILOT_IMEI to the pilot watch.');
  const { initFirestore, getDb } = require('../src/firestore');
  initFirestore({ startWatchers: false });
  const db = getDb();
  if (!db) throw new Error('Firestore is unavailable.');
  const report = await loadActivityReport(db, imei, config);
  const output = JSON.stringify(report, null, 2);
  console.log(output);
  if (args.length) {
    const fs = require('node:fs');
    const path = require('node:path');
    const folder = path.join(__dirname, '../data/activity-checks');
    fs.mkdirSync(folder, { recursive: true });
    const savedTo = path.join(folder, `${Date.now()}-${args[0].slice(7)}.json`);
    fs.writeFileSync(savedTo, output + '\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ savedTo }));
  }
}

if (require.main === module) main().catch(error => { console.error(`ERROR: ${error.message}`); process.exitCode = 1; });
module.exports = { loadActivityReport };
