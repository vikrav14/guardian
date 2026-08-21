'use strict';

const CONFIRMATION = 'CHANGE_SOS_MODE';

function readArgument(argv, name) {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : null;
}

function parseAlarmMode(value) {
  if (value == null || String(value).trim() === '') {
    throw new Error('--mode must be 0, 1, 2, or 3');
  }
  const mode = Number(value);
  if (!Number.isInteger(mode) || mode < 0 || mode > 3) {
    throw new Error('--mode must be 0, 1, 2, or 3');
  }
  return mode;
}

function buildAlarmModeCommandDocument({ imei, mode, now = new Date() }) {
  return {
    imei,
    type: 'set_alarm_mode',
    params: { mode },
    status: 'pending',
    result: null,
    error: null,
    createdBy: 'operator:queue-v52-alarm-mode',
    createdAt: now,
    completedAt: null,
  };
}

async function main(argv = process.argv.slice(2)) {
  const imei = String(readArgument(argv, 'imei') || '').trim();
  if (!/^\d{15}$/.test(imei)) {
    throw new Error('--imei must be the watch\'s exact 15-digit hardware IMEI');
  }
  const mode = parseAlarmMode(readArgument(argv, 'mode'));
  if (readArgument(argv, 'confirm') !== CONFIRMATION) {
    throw new Error(
      `This changes physical SOS behaviour. Re-run with --confirm ${CONFIRMATION}`
    );
  }

  const { initFirestore, getDb } = require('../src/firestore');
  initFirestore({ startWatchers: false });
  const db = getDb();
  if (!db) throw new Error('Firestore is unavailable. Check the gateway environment.');

  const device = await db.collection('devices').doc(imei).get();
  if (!device.exists) throw new Error(`devices/${imei} was not found`);

  const ref = db.collection('deviceCommands').doc();
  await ref.set(buildAlarmModeCommandDocument({ imei, mode }));
  console.log(JSON.stringify({
    commandId: ref.id,
    imei,
    mode,
    status: 'pending',
    warning:
      'Pending means queued only. Verify gateway delivery and the physical V52 behaviour before relying on this mode.',
  }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  CONFIRMATION,
  readArgument,
  parseAlarmMode,
  buildAlarmModeCommandDocument,
};
