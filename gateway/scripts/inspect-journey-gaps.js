#!/usr/bin/env node
'use strict';

const { analyzeJourneyGaps } = require('../src/journey-gap-analysis');

function readArg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

function asDate(value) {
  const date = value?.toDate?.() ?? new Date(value);
  return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
}

function formatAt(journey, offsetMs) {
  const start = asDate(journey.startAt);
  if (!start) return 'unknown time';
  return new Date(start.getTime() + offsetMs).toLocaleString('en-GB', {
    timeZone: 'Indian/Mauritius',
    dateStyle: 'medium',
    timeStyle: 'medium',
  });
}

function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder}s`;
}

async function main() {
  const imei = String(readArg('imei') || '').trim();
  const limit = Math.max(1, Number(readArg('limit')) || 2);
  if (!/^\d{10,20}$/.test(imei)) {
    throw new Error(
      'Usage: node scripts/inspect-journey-gaps.js --imei <digits> [--limit 2]'
    );
  }

  const { initFirestore, getDb } = require('../src/firestore');
  initFirestore({ startWatchers: false });
  const db = getDb();
  if (!db) throw new Error('Firestore is unavailable.');

  const deviceRef = db.collection('devices').doc(imei);
  const [deviceSnap, journeySnap, commandSnap] = await Promise.all([
    deviceRef.get(),
    deviceRef.collection('journeys').orderBy('startAt', 'desc').limit(limit).get(),
    db.collection('deviceCommands').where('imei', '==', imei).get(),
  ]);
  const device = deviceSnap.data() || {};
  const commands = commandSnap.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() || {}),
  }));

  console.log('Guardian Journey Gap Investigator');
  console.log('=================================');
  console.log(`Device: ${imei}`);
  console.log(`Journeys inspected: ${journeySnap.size}`);
  console.log('Read-only: yes');
  console.log(
    `Current reporting snapshot: desired=${device.adaptiveReporting?.desiredIntervalSeconds ?? 'unknown'}s ` +
      `applied=${device.adaptiveReporting?.appliedIntervalSeconds ?? 'unknown'}s ` +
      `reason=${device.adaptiveReporting?.reason ?? 'unknown'}`
  );

  for (const doc of journeySnap.docs) {
    const journey = doc.data() || {};
    const analyses = analyzeJourneyGaps(journey);
    console.log(`\nJourney ${doc.id}`);
    console.log(`  Start: ${formatAt(journey, 0)}`);
    console.log(`  Points: ${journey.pointCount || 0}`);
    console.log(`  Gaps: ${analyses.length}`);
    console.log(
      `  Timestamped diagnostics: ${Array.isArray(journey.diagnosticEvents) ? journey.diagnosticEvents.length : 0}`
    );

    for (const gap of analyses) {
      console.log(`  Gap ${gap.index}: ${formatDuration(gap.durationSeconds)}`);
      console.log(`    From: ${formatAt(journey, gap.fromOffsetMs)}`);
      console.log(`    To:   ${formatAt(journey, gap.toOffsetMs)}`);
      console.log(
        `    Assessment: ${gap.cause} (${gap.confidence} confidence)`
      );
      console.log(`    Why: ${gap.explanation}`);
      if (gap.events.length > 0) {
        console.log('    Timeline:');
        for (const event of gap.events) {
          console.log(
            `      - ${formatAt(journey, Number(event.offsetMs) || 0)} ` +
              `${event.type} ${JSON.stringify(event.details || {})}`
          );
        }
      }
    }

    const start = asDate(journey.startAt)?.getTime() || 0;
    const end = asDate(journey.endAt)?.getTime() || 0;
    const relatedCommands = commands.filter((command) => {
      const at = asDate(command.createdAt || command.completedAt)?.getTime();
      return at && at >= start && at <= end;
    });
    console.log(`  Stored device commands during journey: ${relatedCommands.length}`);
    for (const command of relatedCommands) {
      console.log(
        `    - ${command.type || 'unknown'} status=${command.status || 'unknown'} ` +
          `at=${asDate(command.createdAt || command.completedAt)?.toISOString() || 'unknown'}`
      );
    }
  }
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
});
