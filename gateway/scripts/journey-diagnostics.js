#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs');
const admin = require('firebase-admin');

const config = require('../src/config');
const {
  DEFAULT_TIME_ZONE,
  formatJourneyDiagnostic,
} = require('../src/journey-diagnostics');

function usage() {
  console.log(`
Guardian Journey Diagnostics (read-only)

Usage:
  node scripts/journey-diagnostics.js <imei> [--limit 10]
  node scripts/journey-diagnostics.js <imei> --id <journeyDocumentId>
  node scripts/journey-diagnostics.js <imei> [--limit 10] --json

Examples:
  node scripts/journey-diagnostics.js 861397052547492 --limit 10
  node scripts/journey-diagnostics.js 861397052547492 --id journey_abcd1234

This tool only READS Firestore. It never modifies or deletes journey data.
`);
}

function parseArgs(argv) {
  const args = [...argv];
  const result = {
    imei: null,
    limit: 10,
    id: null,
    json: false,
    timeZone: DEFAULT_TIME_ZONE,
  };

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    return { ...result, help: true };
  }

  result.imei = args.shift();

  while (args.length > 0) {
    const arg = args.shift();

    if (arg === '--limit') {
      const value = Number(args.shift());
      if (!Number.isInteger(value) || value < 1 || value > 100) {
        throw new Error('--limit must be an integer from 1 to 100');
      }
      result.limit = value;
      continue;
    }

    if (arg === '--id') {
      const value = args.shift();
      if (!value) throw new Error('--id requires a journey document id');
      result.id = value;
      continue;
    }

    if (arg === '--json') {
      result.json = true;
      continue;
    }

    if (arg === '--timezone') {
      const value = args.shift();
      if (!value) throw new Error('--timezone requires an IANA timezone');
      result.timeZone = value;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return result;
}

function initReadOnlyFirestore() {
  if (config.firestoreDisabled) {
    throw new Error(
      'FIRESTORE_DISABLED=true. Diagnostics needs Firestore read access.'
    );
  }

  if (!config.firebaseProjectId) {
    throw new Error('FIREBASE_PROJECT_ID is missing from gateway/.env');
  }

  if (!config.googleApplicationCredentials) {
    throw new Error('GOOGLE_APPLICATION_CREDENTIALS is missing from gateway/.env');
  }

  if (!fs.existsSync(config.googleApplicationCredentials)) {
    throw new Error(
      `Service account file not found: ${config.googleApplicationCredentials}`
    );
  }

  const serviceAccount = JSON.parse(
    fs.readFileSync(config.googleApplicationCredentials, 'utf8')
  );

  const appName = 'guardian-journey-diagnostics';
  const existing = admin.apps.find((app) => app.name === appName);
  const app =
    existing ||
    admin.initializeApp(
      {
        credential: admin.credential.cert(serviceAccount),
        projectId: config.firebaseProjectId,
      },
      appName
    );

  return app.firestore();
}

function docToJourney(doc) {
  return {
    id: doc.id,
    ...(doc.data() || {}),
  };
}

async function fetchJourneys(db, options) {
  const collection = db
    .collection('devices')
    .doc(options.imei)
    .collection('journeys');

  if (options.id) {
    const snap = await collection.doc(options.id).get();
    return snap.exists ? [docToJourney(snap)] : [];
  }

  const snap = await collection
    .orderBy('startAt', 'desc')
    .limit(options.limit)
    .get();

  return snap.docs.map(docToJourney);
}

function jsonSafe(value) {
  if (value == null) return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, jsonSafe(item)])
    );
  }
  return value;
}

async function main() {
  let options;

  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`Error: ${error.message}`);
    usage();
    process.exitCode = 1;
    return;
  }

  if (options.help) {
    usage();
    return;
  }

  const db = initReadOnlyFirestore();
  const journeys = await fetchJourneys(db, options);

  if (journeys.length === 0) {
    console.log(
      options.id
        ? `No journey found: devices/${options.imei}/journeys/${options.id}`
        : `No journeys found for device ${options.imei}`
    );
    return;
  }

  if (options.json) {
    console.log(JSON.stringify(journeys.map(jsonSafe), null, 2));
    return;
  }

  console.log('Guardian Journey Diagnostics');
  console.log('============================');
  console.log(`Device: ${options.imei}`);
  console.log(`Project: ${config.firebaseProjectId}`);
  console.log(`Time zone: ${options.timeZone}`);
  console.log(`Journeys: ${journeys.length}`);
  console.log('Read-only: yes');
  console.log('');

  journeys.forEach((journey, index) => {
    if (index > 0) {
      console.log('');
      console.log('----------------------------------------');
      console.log('');
    }
    console.log(
      formatJourneyDiagnostic(journey, { timeZone: options.timeZone })
    );
  });
}

main()
  .catch((error) => {
    console.error('[journey-diagnostics] failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    const app = admin.apps.find(
      (candidate) => candidate.name === 'guardian-journey-diagnostics'
    );
    if (app) {
      await app.delete().catch(() => {});
    }
  });
