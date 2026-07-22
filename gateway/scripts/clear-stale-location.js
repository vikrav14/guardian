/**
 * Clear stale location/speed fields on a device doc (e.g. after simulator wrote
 * demo coordinates to a real IMEI).
 *
 * Usage:
 *   node scripts/clear-stale-location.js 861397053141170
 *   node scripts/clear-stale-location.js 861397053141170 --apply
 */
const admin = require('firebase-admin');
const config = require('../src/config');

const APPLY = process.argv.includes('--apply');
const imeiArg = process.argv.find((a) => /^\d{10,15}$/.test(a));

function init() {
  const sa = require(config.googleApplicationCredentials);
  admin.initializeApp({
    credential: admin.credential.cert(sa),
    projectId: config.firebaseProjectId,
  });
  return admin.firestore();
}

async function main() {
  if (!imeiArg) {
    console.error('Usage: node scripts/clear-stale-location.js <imei> [--apply]');
    process.exit(1);
  }

  const db = init();
  const ref = db.collection('devices').doc(imeiArg);
  const snap = await ref.get();
  if (!snap.exists) {
    console.error(`devices/${imeiArg} not found`);
    process.exit(1);
  }

  const d = snap.data() || {};
  const fmt = (v) => (v?.toDate ? v.toDate().toISOString() : v);
  console.log('[before] location:', d.location ? {
    lat: d.location.lat,
    lng: d.location.lng,
    recordedAt: fmt(d.location.recordedAt),
  } : null);
  console.log('[before] speedKmh:', d.speedKmh);
  console.log('[before] lastHeartbeatAt:', fmt(d.lastHeartbeatAt));

  if (!APPLY) {
    console.log('\nDry run — pass --apply to delete location + speedKmh fields.');
    return;
  }

  await ref.update({
    location: admin.firestore.FieldValue.delete(),
    speedKmh: admin.firestore.FieldValue.delete(),
    course: admin.firestore.FieldValue.delete(),
    accuracySource: admin.firestore.FieldValue.delete(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log(`[devices/${imeiArg}] cleared stale location and speed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
