'use strict';

// Private environment is explicitly supplied, never committed or printed.
// Keep cwd at the existing gateway directory so relative credential paths and
// dotenv still resolve against the operator's established configuration.
const fs = require('node:fs');
const path = require('node:path');
const input = process.argv.slice(2);
if (input.length !== 2 || input[0] !== '--environment') throw Error('Use --environment <private JSON environment path>');
const env = JSON.parse(fs.readFileSync(path.resolve(input[1]), 'utf8'));
for (const [key, value] of Object.entries(env)) {
  if (typeof value !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw Error('Invalid environment entry');
  process.env[key] = value;
}
const snapshot = require('../src/safety-snapshot-runtime').readSafetySnapshotRuntime();
if (!snapshot.deviceDispatchAllowed || process.env.INCIDENT_PHOTOS_ENABLED !== 'true' ||
    process.env.INCIDENT_PHOTOS_TRIAL_ONLY !== 'false' ||
    !process.env.JOURNEY_JOURNAL_DIRECTORY || !path.isAbsolute(process.env.JOURNEY_JOURNAL_DIRECTORY)) {
  throw Error('Combined runtime requires explicit incident activation and the existing absolute journey journal directory');
}
for (const file of ['home-wifi-http', 'incident-photos-live', 'command-coordinator']) require.resolve('../src/' + file);
console.info('[combined-runtime] Home Wi-Fi, incident photos and command coordination present; private configuration loaded');
require('../src/server');
