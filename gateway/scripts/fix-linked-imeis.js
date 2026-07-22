/**
 * One-off: normalize users/{uid}.linkedImeis to 15-digit only and clean stale device docs.
 * Usage: node scripts/fix-linked-imeis.js [--apply]
 */
const admin = require('firebase-admin');
const config = require('../src/config');
const {
  isFullImei,
  isProtocolId,
  fullImeiFromProtocolId,
} = require('../src/imei');

const UID = 'GIGI1yfpNsXXTqvF0hrNpjc0lWg1';
const TARGET_FULL = '861397053141170';
const LEGACY_PROTO = '9705314117';
const DEMO_IMEI = '359633100123456';
const SETUP_DEMO_IMEI = '861397053139877';
const REMOVE_IMEIS = new Set([DEMO_IMEI, SETUP_DEMO_IMEI]);
const APPLY = process.argv.includes('--apply');

function init() {
  const sa = require(config.googleApplicationCredentials);
  admin.initializeApp({
    credential: admin.credential.cert(sa),
    projectId: config.firebaseProjectId,
  });
  return admin.firestore();
}

function normalizeLinkedEntry(entry) {
  const id = String(entry || '').replace(/\D/g, '');
  if (isFullImei(id)) return id;
  if (isProtocolId(id)) return fullImeiFromProtocolId(id) || null;
  return id.length ? id : null;
}

async function main() {
  const db = init();
  const userRef = db.collection('users').doc(UID);
  const userSnap = await userRef.get();
  if (!userSnap.exists) throw new Error(`users/${UID} not found`);

  const before = (userSnap.data().linkedImeis || []).map(String);
  const normalized = [...new Set(before.map(normalizeLinkedEntry).filter(Boolean))];
  if (!normalized.includes(TARGET_FULL)) normalized.unshift(TARGET_FULL);
  const after = normalized.filter((id) => isFullImei(id) && !REMOVE_IMEIS.has(id));

  console.log('[linkedImeis] before:', JSON.stringify(before));
  console.log('[linkedImeis] after: ', JSON.stringify(after));

  const fullRef = db.collection('devices').doc(TARGET_FULL);
  const legacyRef = db.collection('devices').doc(LEGACY_PROTO);
  const [fullSnap, legacySnap] = await Promise.all([fullRef.get(), legacyRef.get()]);

  console.log(`[devices/${TARGET_FULL}] exists=${fullSnap.exists}`);
  if (fullSnap.exists) {
    const d = fullSnap.data();
    console.log('  online:', d.online, 'heartbeat:', d.lastHeartbeatAt?.toDate?.() || d.lastHeartbeatAt);
  }
  console.log(`[devices/${LEGACY_PROTO}] exists=${legacySnap.exists}`);
  if (legacySnap.exists) {
    const d = legacySnap.data();
    console.log('  imei:', d.imei, 'online:', d.online);
  }

  const demoRef = db.collection('devices').doc(DEMO_IMEI);
  const demoSnap = await demoRef.get();
  console.log(`[devices/${DEMO_IMEI}] exists=${demoSnap.exists}`);
  if (demoSnap.exists) {
    const d = demoSnap.data();
    console.log('  battery:', d.batteryPercent, 'online:', d.online);
    if (!after.includes(DEMO_IMEI)) {
      console.log(`  stale simulator doc — would delete on --apply`);
    }
  }

  if (!APPLY) {
    console.log('\nDry run — pass --apply to write changes.');
    return;
  }

  await userRef.set(
    { linkedImeis: after, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );
  console.log('[linkedImeis] updated');

  if (legacySnap.exists) {
    const legacyData = legacySnap.data() || {};
    if (!fullSnap.exists) {
      await fullRef.set(
        {
          ...legacyData,
          imei: TARGET_FULL,
          protocolId: LEGACY_PROTO,
          migratedFrom: LEGACY_PROTO,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      console.log(`[devices] migrated ${LEGACY_PROTO} → ${TARGET_FULL}`);
    }
    await legacyRef.delete();
    console.log(`[devices/${LEGACY_PROTO}] deleted`);
  }

  for (const staleImei of REMOVE_IMEIS) {
    const staleRef = db.collection('devices').doc(staleImei);
    const staleSnap =
      staleImei === DEMO_IMEI ? demoSnap : await staleRef.get();
    if (staleSnap.exists && !after.includes(staleImei)) {
      await staleRef.delete();
      console.log(`[devices/${staleImei}] deleted (stale demo doc)`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
