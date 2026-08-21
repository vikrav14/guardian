#!/usr/bin/env node
'use strict';

require('dotenv').config();

const config = require('../src/config');
const { initFirestore, getDb } = require('../src/firestore');
const {
  buildJourneyGooglePresentation,
} = require('../src/journey-google-presentation');

function readArg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

async function loadJourney(db, imei, journeyId) {
  const journeys = db.collection('devices').doc(imei).collection('journeys');
  if (journeyId) {
    const snapshot = await journeys.doc(journeyId).get();
    if (!snapshot.exists) {
      throw new Error(`Journey ${journeyId} was not found for ${imei}.`);
    }
    return snapshot;
  }
  const latest = await journeys.orderBy('startAt', 'desc').limit(1).get();
  if (latest.empty) throw new Error(`No journeys were found for ${imei}.`);
  return latest.docs[0];
}

async function main() {
  const imei = String(readArg('imei') || '').trim();
  const journeyId = String(readArg('journey-id') || '').trim() || null;
  const apply = hasFlag('apply');
  if (!/^\d{10,20}$/.test(imei)) {
    throw new Error(
      'Usage: node scripts/enrich-journey-presentation.js --imei <digits> ' +
      '[--journey-id <id>] [--apply]'
    );
  }
  if (!config.googleRoadsApiKey &&
      !config.googleRoutesApiKey &&
      !config.googlePlacesApiKey) {
    throw new Error(
      'Configure at least one server-restricted Google Roads, Routes, or ' +
      'Places key in gateway/.env.'
    );
  }

  initFirestore({ startWatchers: false });
  const db = getDb();
  if (!db) throw new Error('Firestore is unavailable.');
  const journeySnapshot = await loadJourney(db, imei, journeyId);
  const journey = journeySnapshot.data() || {};
  const presentation = await buildJourneyGooglePresentation(journey, {
    roadsApiKey: config.googleRoadsApiKey,
    routesApiKey: config.googleRoutesApiKey,
    placesApiKey: config.googlePlacesApiKey,
  });
  if (!presentation) {
    throw new Error('This journey did not produce a usable presentation.');
  }

  console.log('Guardian Journey Presentation');
  console.log('=============================');
  console.log(`Device:  ${imei}`);
  console.log(`Journey: ${journeySnapshot.id}`);
  console.log(`GPS sections:    ${presentation.coverage.gpsSegmentCount}`);
  console.log(`Google sections: ${presentation.coverage.googleSegmentCount}`);
  console.log(`Nearby places:   ${presentation.stopPlaces.length}`);
  for (const place of presentation.stopPlaces) {
    console.log(`  - ${place.label}`);
  }
  console.log(`Expires: ${presentation.expiresAt.toISOString()}`);

  if (!apply) {
    console.log('Dry-run: yes (add --apply to write the presentation document)');
    return;
  }
  await journeySnapshot.ref
    .collection('presentations')
    .doc('google_v1')
    .set(presentation);
  console.log('Written: presentations/google_v1');
  console.log('Raw journey changed: no');
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
});
