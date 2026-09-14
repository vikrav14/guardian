#!/usr/bin/env node
'use strict';

require('dotenv').config();
const fs = require('node:fs');
const admin = require('firebase-admin');
const config = require('../src/config');
const { JourneyJournal } = require('../src/journey-journal');
const { recoverGpsHistory, saveRecoveredJourney, millis } = require('../src/journey-history-recovery');

function parseArgs(argv) {
  const args = { apply: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--apply') { args.apply = true; continue; }
    if (!['--imei', '--from', '--to', '--capture'].includes(argv[i]) || !argv[i + 1]) throw new Error('Use --imei, --from, --to, optional --capture and --apply.');
    args[argv[i].slice(2)] = argv[++i];
  }
  if (!/^\d{15}$/.test(args.imei || '') || !/[Zz]|[+-]\d\d:\d\d$/.test(args.from || '') ||
      !/[Zz]|[+-]\d\d:\d\d$/.test(args.to || '') || !Number.isFinite(millis(args.from)) ||
      !Number.isFinite(millis(args.to)) || millis(args.to) <= millis(args.from) ||
      millis(args.to) - millis(args.from) > 86400000 || millis(args.to) > Date.now()) {
    throw new Error('Supply a 15-digit IMEI and past ISO timestamps including timezone, covering at most 24 hours.');
  }
  return args;
}

async function recoverStoredWindow(db, args, { journal = null, capture = null } = {}) {
  const from = new Date(args.from), to = new Date(args.to);
  const device = db.collection('devices').doc(args.imei);
  const [history, zoneSnap, deviceSnap] = await Promise.all([
    device.collection('locations').where('recordedAt', '>=', from).where('recordedAt', '<=', to)
      .orderBy('recordedAt').limit(25001).get(),
    db.collection('geofences').where('imei', '==', args.imei).where('active', '==', true).get(),
    device.get(),
  ]);
  if (history.size > 25000) throw new Error('Window exceeds 25,000 records; use a smaller time range. Nothing was changed.');
  const local = journal?.read(args.imei);
  if (local?.checkpoint?.currentJourney && millis(local.checkpoint.currentJourney.startAt) <= +to &&
      millis(local.checkpoint.currentJourney.points?.at(-1)?.recordedAt) >= +from) {
    return { outcome: 'active_journey_present', changed: false,
      message: 'The gateway still owns an unfinished journey in this range; let it finish before recovery.' };
  }
  const points = history.docs.map(d => d.data());
  const inRange = p => millis(p?.recordedAt) >= +from && millis(p?.recordedAt) <= +to;
  if (capture && (capture.version !== 1 || capture.kind !== 'firestore_document_versions' ||
      capture.imei !== args.imei || capture.projectId !== config.firebaseProjectId || !Array.isArray(capture.points) ||
      capture.points.length > 25000 || capture.points.some(p => !Number.isFinite(millis(p.readTime)) ||
        millis(p.recordedAt) > millis(p.readTime) || !['lastSatelliteLocation', 'lastLocationObservation', 'location'].includes(p.field)))) {
    throw new Error('Capture provenance does not match this device/project or original source times. Nothing was changed.');
  }
  const capturedPoints = (capture?.points || []).filter(inRange);
  const localPoints = Object.values(local?.points || {}).map(p => p.point).filter(inRange);
  const lastGps = deviceSnap.data()?.lastSatelliteLocation;
  if (inRange(lastGps)) points.push(lastGps);
  const result = recoverGpsHistory([...points, ...localPoints, ...capturedPoints], {
    zones: zoneSnap.docs.map(d => ({ id: d.id, ...d.data() })), homeIntervals: local?.homeIntervals || [],
  });
  const writes = [];
  for (const journey of result.journeys) writes.push(await saveRecoveredJourney(db, args.imei, journey, { apply: args.apply }));
  return { outcome: writes.some(w => w.outcome === 'recovered') ? 'recovered' :
    writes.length ? 'review_results' : 'original_timestamps_or_route_evidence_unavailable',
    apply: args.apply, locationDocuments: history.size, journalPoints: localPoints.length, capturedPoints: capturedPoints.length,
    validTimestampedGpsPoints: result.acceptedPoints, rejectedPoints: result.rejectedPoints,
    journeys: writes, currentLocationChanged: false, alertsSent: false,
    ...(!writes.length ? { nextStep: 'Original timestamped GPS records are required. Console coordinates without source timestamps cannot establish a truthful journey.' } : {}) };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!config.firebaseProjectId || !config.googleApplicationCredentials || config.firestoreDisabled) {
    throw new Error('Use the gateway environment with Firestore and its existing service-account path configured.');
  }
  const app = admin.initializeApp({ projectId: config.firebaseProjectId,
    credential: admin.credential.cert(JSON.parse(fs.readFileSync(config.googleApplicationCredentials, 'utf8'))) }, 'journey-history-recovery');
  try {
    const journal = fs.existsSync(config.journeyJournalDirectory) ? new JourneyJournal(config.journeyJournalDirectory) : null;
    const capture = args.capture ? JSON.parse(fs.readFileSync(args.capture, 'utf8').replace(/^\uFEFF/, '')) : null;
    console.log(JSON.stringify(await recoverStoredWindow(app.firestore(), args, { journal, capture }), null, 2));
  } finally { await app.delete(); }
}
if (require.main === module) main().catch(error => { console.error(`Journey recovery failed: ${error.message}`); process.exitCode = 1; });
module.exports = { parseArgs, recoverStoredWindow };
