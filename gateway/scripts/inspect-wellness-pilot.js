'use strict';

const { localDateKey } = require('../src/activity-steps');
const { summarizeActivityDay, summarizeActivityState } = require('../src/activity-counter-diagnostics');
const { validConsent, METRIC_SET } = require('../src/care-wellbeing');

const WINDOW_MS = 25 * 60 * 60 * 1000;
const READING_LIMIT = 500;

function asDate(value) {
  if (value == null) return null;
  const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function iso(value) { return asDate(value)?.toISOString() || null; }
function age(value, now) {
  const date = asDate(value);
  return date ? Math.floor((now - date) / 1000) : null;
}

async function loadEvidence(db, imei, now = new Date(), timeZone = 'Indian/Mauritius') {
  const deviceRef = db.collection('devices').doc(imei);
  const consentRef = db.collection('wellbeingConsents').doc(imei);
  const dates = [now, new Date(now - 86400000)].map(date => localDateKey(date, timeZone));
  const [device, consent, activityState, ...days] = await Promise.all([
    deviceRef.get(), consentRef.get(),
    deviceRef.collection('activityState').doc('counter').get(),
    ...dates.map(date => deviceRef.collection('activityDays').doc(date).get()),
  ]);
  if (!device.exists) throw new Error('Configured watch was not found in Firestore.');
  let currentConsent = consent.exists ? consent.data() : null;
  let readings = [];
  let truncated = false;
  if (validConsent(currentConsent, now)) {
    const snap = await deviceRef.collection('wellbeingReadings')
      .where('observedAt', '>=', new Date(now - WINDOW_MS))
      .orderBy('observedAt', 'desc').limit(READING_LIMIT + 1).get();
    truncated = snap.docs.length > READING_LIMIT;
    readings = snap.docs.slice(0, READING_LIMIT).map(doc => doc.data());
    // Do not summarize readings if consent changed during the query.
    const latest = await consentRef.get();
    currentConsent = latest.exists ? latest.data() : null;
    if (!validConsent(currentConsent, now)) { readings = []; truncated = false; }
  }
  return { device: device.data(), consent: currentConsent,
    activityState: activityState.exists ? activityState.data() : null,
    activityDays: days.filter(day => day.exists).map(day => day.data()), readings, truncated };
}

function buildReport(evidence, config, now = new Date(), { includeReadingValues = false } = {}) {
  const device = evidence.device || {};
  const consentValid = validConsent(evidence.consent, now);
  const readings = consentValid ? (evidence.readings || []).filter(reading => {
    const at = asDate(reading.observedAt);
    return at && at <= now && at >= new Date(now - WINDOW_MS);
  }) : [];
  const heartbeatAge = age(device.lastHeartbeatAt, now);
  return {
    outcome: 'read_only', asOf: now.toISOString(),
    configurationSource: 'this_command_environment_not_running_gateway',
    configuration: {
      activityIngestEnabled: config.activityStepsIngestEnabled === true,
      activityCounterMode: config.activityStepsCounterMode || 'unverified',
      activityCustomerEnabled: config.activityStepsCustomerEnabled === true,
      wellbeingIngestEnabled: config.careWellbeingIngestEnabled === true,
      wellbeingDeviceMode: config.careWellbeingDeviceMode || 'unverified',
      wellbeingCustomerEnabled: config.careWellbeingCustomerEnabled === true,
      wellbeingRequestEnabled: config.careWellbeingRequestEnabled === true,
    },
    watch: {
      backendOnline: device.online === true,
      lastHeartbeatAt: iso(device.lastHeartbeatAt), heartbeatAgeSeconds: heartbeatAge,
      freshHeartbeat: device.online === true && heartbeatAge != null && heartbeatAge >= 0 && heartbeatAge <= 300,
      batteryPercent: Number.isInteger(device.batteryPercent) ? device.batteryPercent : null,
      batteryUpdatedAt: iso(device.batteryUpdatedAt),
    },
    activity: {
      rawCounter: Number.isInteger(device.stepsRaw) ? device.stepsRaw : null,
      counterUpdatedAt: iso(device.activityUpdatedAt),
      counterAgeSeconds: age(device.activityUpdatedAt, now),
      persistedGatewayState: summarizeActivityState(evidence.activityState),
      days: (evidence.activityDays || []).map(summarizeActivityDay),
      acceptance: 'manual_watch_comparison_midnight_and_reboot_still_required',
    },
    wellbeing: {
      consentValid, windowHours: 25, readingsTruncated: consentValid && evidence.truncated === true,
      metrics: Object.values(METRIC_SET).map(metricSet => {
        const samples = readings.filter(reading => reading.metricSet === metricSet)
          .sort((a, b) => asDate(a.observedAt) - asDate(b.observedAt));
        const gaps = samples.slice(1).map((reading, index) =>
          Math.round((asDate(reading.observedAt) - asDate(samples[index].observedAt)) / 1000));
        const valueKeys = metricSet === METRIC_SET.SPO2
          ? ['spo2Percent'] : ['heartRateBpm', 'systolicMmHg', 'diastolicMmHg'];
        return { metricSet, uploads: samples.length,
          displayableUploads: samples.filter(reading => reading.displayable === true).length,
          firstUploadAt: iso(samples[0]?.observedAt), lastUploadAt: iso(samples.at(-1)?.observedAt),
          lastUploadAgeSeconds: age(samples.at(-1)?.observedAt, now),
          maximumGapSeconds: gaps.length ? Math.max(...gaps) : null,
          ...(includeReadingValues ? { latestReadings: samples.slice(-3).reverse().map(reading => ({
            observedAt: iso(reading.observedAt), quality: reading.quality || 'unverified',
            displayable: reading.displayable === true,
            values: Object.fromEntries(valueKeys.filter(key => Number.isFinite(reading.values?.[key]))
              .map(key => [key, reading.values[key]])),
          })) } : {}),
        };
      }),
      scheduleState: 'not_proven_by_uploads',
      skinTemperature: 'not_available_pending_exact_device_validation',
      acceptance: 'manual_reliability_battery_and_consent_tests_still_required',
    },
  };
}

async function main() {
  const supplied = process.argv.slice(2);
  const includeReadingValues = supplied.includes('--include-reading-values');
  const args = supplied.filter(arg => arg !== '--include-reading-values');
  if (args.length && (args.length !== 2 || args[0] !== '--imei')) {
    throw new Error('Usage: npm run wellness:check [-- --imei <15 digits> --include-reading-values]');
  }
  const config = require('../src/config');
  const imei = String(args[1] || config.wifiHomePilotImei || '').trim();
  if (!/^\d{15}$/.test(imei)) throw new Error('Set WIFI_HOME_PILOT_IMEI or pass --imei <15 digits>.');
  const { initFirestore, getDb } = require('../src/firestore');
  initFirestore({ startWatchers: false });
  const db = getDb();
  if (!db) throw new Error('Firestore is unavailable.');
  const now = new Date();
  const evidence = await loadEvidence(db, imei, now, config.activityStepsTimeZone);
  console.log(JSON.stringify(buildReport(evidence, config, now, { includeReadingValues }), null, 2));
}

if (require.main === module) main().catch(error => {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
});

module.exports = { loadEvidence, buildReport };
