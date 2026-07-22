/**
 * Clear speedKmh when it was mis-parsed from course (pre gt06 field-order fix).
 * Usage: node scripts/fix-stale-speed.js [imei] [--apply]
 */
const admin = require('firebase-admin');
const config = require('../src/config');

const IMEI = process.argv[2] || '861397053141170';
const APPLY = process.argv.includes('--apply');

function init() {
  const credPath =
    config.googleApplicationCredentials ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credPath) {
    throw new Error('Set GOOGLE_APPLICATION_CREDENTIALS in gateway/.env');
  }
  const sa = require(credPath);
  admin.initializeApp({
    credential: admin.credential.cert(sa),
    projectId: config.firebaseProjectId || sa.project_id,
  });
  return admin.firestore();
}

async function main() {
  const db = init();
  const ref = db.collection('devices').doc(IMEI);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`devices/${IMEI} not found`);

  const before = snap.data() || {};
  const speedKmh = before.speedKmh;
  const course = before.course;

  console.log(`[devices/${IMEI}] before:`, {
    speedKmh,
    course,
    online: before.online,
    batteryPercent: before.batteryPercent,
    updatedAt: before.updatedAt?.toDate?.() || before.updatedAt,
  });

  // Heuristic: course was written into speedKmh when course field is 0/null
  // but speed looks like a heading (common mis-parse before field-order fix).
  const looksMisParsed =
    speedKmh != null &&
    speedKmh > 0 &&
    speedKmh <= 360 &&
    (course == null || course === 0);

  if (!looksMisParsed) {
    console.log('No stale speed detected — nothing to do.');
    return;
  }

  const patch = {
    speedKmh: 0,
    course: speedKmh,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  console.log('Would apply patch:', patch);

  if (!APPLY) {
    console.log('\nDry run — pass --apply to write.');
    return;
  }

  await ref.set(patch, { merge: true });
  console.log('[devices] speedKmh cleared, course restored from stale speed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
