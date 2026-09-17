'use strict';

const { evaluateSubscription } = require('../src/entitlements');
const { validConsent } = require('../src/care-wellbeing');

async function enablePreview(db, imei, viewerUid, now = new Date()) {
  const userRef = db.collection('users').doc(viewerUid);
  return db.runTransaction(async tx => {
    const user = (await tx.get(userRef)).data();
    if (!user?.linkedImeis?.includes(imei)) throw new Error('Viewer must be linked to the pilot watch.');
    const ownerUid = user.serviceOwnerUid || viewerUid;
    const owner = ownerUid === viewerUid ? user : (await tx.get(db.collection('users').doc(ownerUid))).data();
    if (ownerUid !== viewerUid && !owner?.memberUids?.includes(viewerUid)) {
      throw new Error('Service membership is not confirmed.');
    }
    const sub = await tx.get(db.collection('serviceSubscriptions').doc(ownerUid));
    const access = evaluateSubscription(sub.exists ? sub.data() : null, { ownerUid, now });
    if (!access.serviceActive) throw new Error('An active service plan is required.');
    const consent = await tx.get(db.collection('wellbeingConsents').doc(imei));
    if (!validConsent(consent.data(), now)) throw new Error('Existing wearer consent is required; preview does not grant consent.');
    const expiresAt = new Date(Math.min(+now + 86_400_000, access.accessUntil?.getTime() ?? Infinity));
    tx.set(db.collection('wellnessPilots').doc(imei), {
      version: 1, managedBy: 'guardian_admin', enabled: true,
      viewerUid, createdAt: now, expiresAt,
    });
    return { outcome: 'preview_enabled', expiresAt: expiresAt.toISOString(),
      scope: 'one_linked_account_and_watch', sourceRecordsChanged: false };
  });
}

async function main() {
  const args = process.argv.slice(2);
  const enable = args.includes('--enable');
  const disable = args.includes('--disable');
  if (enable === disable || args.some(a => !['--enable', '--disable'].includes(a) && !a.startsWith('--viewer-email='))) {
    throw new Error('Usage: npm run wellness:preview -- --enable [--viewer-email=YOUR_LOGIN] or --disable');
  }
  const config = require('../src/config');
  const imei = config.wifiHomePilotImei;
  if (!/^\d{15}$/.test(imei || '')) throw new Error('WIFI_HOME_PILOT_IMEI must identify the pilot watch.');
  const { initFirestore } = require('../src/firestore');
  const db = initFirestore({ startWatchers: false });
  if (!db) throw new Error('Firestore is unavailable.');
  if (disable) {
    await db.collection('wellnessPilots').doc(imei).delete();
    console.log(JSON.stringify({ outcome: 'preview_disabled', sourceRecordsChanged: false }));
    return;
  }
  const email = args.find(a => a.startsWith('--viewer-email='))?.slice(15).trim();
  let viewerUid;
  if (email) {
    viewerUid = (await require('firebase-admin').auth().getUserByEmail(email)).uid;
  } else {
    const linked = await db.collection('users').where('linkedImeis', 'array-contains', imei).limit(2).get();
    if (linked.size !== 1) throw new Error('Specify --viewer-email=YOUR_APP_LOGIN to select one linked account.');
    viewerUid = linked.docs[0].id;
  }
  console.log(JSON.stringify(await enablePreview(db, imei, viewerUid), null, 2));
}

if (require.main === module) main().catch(error => {
  // SDK failures can contain account identifiers. Report their code only.
  console.error(error.code ? `preview_failed: ${error.code}` : error.message);
  process.exitCode = 1;
});
module.exports = { enablePreview };
