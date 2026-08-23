'use strict';

function readArgument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function buildConsentPatch({ operation, recordedBy, now = new Date() }) {
  if (operation === 'grant') {
    return {
      version: 1,
      status: 'granted',
      managedBy: 'guardian_admin',
      wearerAcknowledgedAt: now,
      recordedBy,
      purpose: 'guardian_care_watch_wellbeing',
      updatedAt: now,
      revokedAt: null,
    };
  }
  if (operation === 'revoke') {
    return {
      version: 1,
      status: 'revoked',
      managedBy: 'guardian_admin',
      recordedBy,
      updatedAt: now,
      revokedAt: now,
    };
  }
  throw new Error('Operation must be grant or revoke');
}

async function deleteDeviceReadings(db, imei) {
  let deleted = 0;
  while (true) {
    const snap = await db
      .collection('devices')
      .doc(imei)
      .collection('wellbeingReadings')
      .limit(400)
      .get();
    if (snap.empty) return deleted;
    const batch = db.batch();
    for (const doc of snap.docs) batch.delete(doc.ref);
    await batch.commit();
    deleted += snap.size;
  }
}

async function main() {
  const grant = hasFlag('grant');
  const revoke = hasFlag('revoke');
  if (grant === revoke) {
    throw new Error('Choose exactly one of --grant or --revoke');
  }
  if (grant && !hasFlag('wearer-confirmed')) {
    throw new Error('--grant requires --wearer-confirmed after explicit wearer agreement');
  }
  const imei = String(readArgument('imei') || '').trim();
  if (!/^\d{15}$/.test(imei)) throw new Error('--imei requires the 15-digit hardware IMEI');
  const recordedBy = String(readArgument('recorded-by') || '').trim().toLowerCase();

  const config = require('../src/config');
  if (!recordedBy || !config.adminEmails.includes(recordedBy)) {
    throw new Error('--recorded-by must match an email configured in ADMIN_EMAILS');
  }
  const { initFirestore, getDb } = require('../src/firestore');
  initFirestore({ startWatchers: false });
  const db = getDb();
  if (!db) throw new Error('Firestore is unavailable');
  const operation = grant ? 'grant' : 'revoke';
  await db.collection('wellbeingConsents').doc(imei).set(
    buildConsentPatch({ operation, recordedBy }),
    { merge: true },
  );
  const readingsDeleted = operation === 'revoke'
    ? await deleteDeviceReadings(db, imei)
    : 0;
  console.log(JSON.stringify({
    ok: true,
    operation,
    imei: `${imei.slice(0, 4)}*******${imei.slice(-4)}`,
    readingsDeleted,
  }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { buildConsentPatch, deleteDeviceReadings };
