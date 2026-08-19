#!/usr/bin/env node
'use strict';

const admin = require('firebase-admin');
const fs = require('fs');
const config = require('../src/config');
const {
  reverseGeocodeToPlaceName,
} = require('../src/geolocate/google');
const {
  enrichJourneyPointPlaceNames,
} = require('../src/journey-place-labels');

function parseArgs(argv) {
  const args = { write: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--write') {
      args.write = true;
    } else if (token === '--imei' || token === '--limit') {
      args[token.slice(2)] = argv[index + 1];
      index += 1;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.imei) throw new Error('--imei is required');

  const serviceAccount = JSON.parse(
    fs.readFileSync(config.googleApplicationCredentials, 'utf8')
  );
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: config.firebaseProjectId,
  });
  const db = admin.firestore();
  let query = db
    .collection('devices')
    .doc(String(args.imei))
    .collection('journeys')
    .orderBy('startAt', 'desc');
  const limit = Number(args.limit);
  if (Number.isInteger(limit) && limit > 0) query = query.limit(limit);

  const snapshot = await query.get();
  let changedJourneys = 0;
  let addedLabels = 0;
  for (const doc of snapshot.docs) {
    const journey = doc.data() || {};
    const before = Array.isArray(journey.pointEvidence)
      ? journey.pointEvidence
      : [];
    if (!args.write) {
      const missing = before.filter(
        (point) => !String(point?.placeName || '').trim()
      ).length;
      if (missing > 0) {
        changedJourneys += 1;
        addedLabels += missing;
        console.log(
          `[journey-place-backfill] ${doc.id}: ${missing} labels need lookup`
        );
      }
      continue;
    }
    const pointEvidence = await enrichJourneyPointPlaceNames(
      journey,
      (lat, lng) =>
        reverseGeocodeToPlaceName(lat, lng, {
          respectFirestoreDisabled: false,
        })
    );
    const added = pointEvidence.filter(
      (point, index) =>
        !String(before[index]?.placeName || '').trim() &&
        Boolean(String(point.placeName || '').trim())
    ).length;
    if (added === 0) continue;
    changedJourneys += 1;
    addedLabels += added;
    console.log(`[journey-place-backfill] ${doc.id}: +${added} labels`);
    if (args.write) await doc.ref.set({ pointEvidence }, { merge: true });
  }

  console.log(
    `[journey-place-backfill] ${args.write ? 'wrote' : 'found'} ` +
      `${addedLabels} labels across ${changedJourneys}/${snapshot.size} journeys`
  );
  if (!args.write) {
    console.log(
      '[journey-place-backfill] dry run made no geocoding requests; add --write to enrich'
    );
  }
}

main().catch((error) => {
  console.error('[journey-place-backfill]', error.message);
  process.exitCode = 1;
});
