'use strict';

const path = require('node:path');
const fs = require('node:fs');

function options(args) {
  const result = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--imei', '--env', '--uid'].includes(args[i]) || !args[i + 1]
        || Object.hasOwn(result, args[i].slice(2))) throw Error('Use --imei <15 digits> --env <existing gateway .env> [--uid <signed-in user ID>]');
    result[args[i].slice(2)] = args[i + 1];
  }
  if (!/^\d{15}$/.test(result.imei || '') || !result.env) throw Error('Both --imei and --env are required.');
  return result;
}

async function selectPilotUid(db, imei, explicitUid) {
  if (explicitUid) return explicitUid;
  const users = await db.collection('users').where('linkedImeis', 'array-contains', imei).get();
  const owners = users.docs.filter(doc => !doc.data().serviceOwnerUid || doc.data().serviceOwnerUid === doc.id);
  if (owners.length !== 1) {
    throw Error('Could not identify one linked service owner. Use --uid with the Firebase UID of the account used in the app.');
  }
  return owners[0].id;
}

async function main(args = process.argv.slice(2)) {
  const input = options(args);
  const envFile = path.resolve(input.env);
  if (!fs.existsSync(envFile)) throw Error('The existing gateway .env file was not found.');
  // Resolve the existing credential/journal paths in their original directory.
  // Nothing is copied, persisted to .env, or written to the subscription.
  process.chdir(path.dirname(envFile));
  require('dotenv').config({ path: envFile });
  const { initFirestore } = require('../src/firestore');
  const { authorizeMovement } = require('../src/movement-reminder-policy');
  const db = initFirestore({ startWatchers: false });
  if (!db) throw Error('Firestore is required for the supervised pilot.');
  let started = false;
  try {
    const uid = await selectPilotUid(db, input.imei, input.uid);
    await authorizeMovement({ db, uid, imei: input.imei, runtime: { enabled: true, uid, imei: input.imei } });
    process.env.MOVEMENT_REMINDER_PILOT_ENABLED = 'true';
    process.env.MOVEMENT_REMINDER_PILOT_IMEI = input.imei;
    process.env.MOVEMENT_REMINDER_PILOT_UID = uid;
    console.log(JSON.stringify({ event: 'movement_reminder_pilot_ready', imei: input.imei,
      account: 'linked_service_account', automaticCommands: false, customerRolloutEnabled: false,
      intervalMinutes: 20, physicalReminderVerified: false,
      note: 'Only Save in the signed-in pilot app sends commands. Send Off and check Close / 20 before stopping.' }));
    require('../src/server');
    started = true;
  } finally {
    if (!started) await db.terminate();
  }
}

if (require.main === module) main().catch(error => {
  console.error(`Movement pilot did not start: ${error.message}`);
  process.exitCode = 1;
});
module.exports = { options, selectPilotUid };
