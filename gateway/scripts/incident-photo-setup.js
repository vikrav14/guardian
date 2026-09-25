'use strict';
const { CONSENT_VERSION } = require('../src/incident-photo-policy');
const { assessSnapshotAccess } = require('../src/safety-snapshot-requests');
const argument = name => process.argv[process.argv.indexOf(`--${name}`) + 1];
const flag = name => process.argv.includes(`--${name}`);

async function main() {
  const imei = flag('imei') ? argument('imei') : '';
  if (!/^\d{15}$/.test(imei)) throw Error('Supply --imei with the watch IMEI.');
  if (flag('enable') === flag('disable')) throw Error('Choose --enable or --disable.');
  if (flag('enable') && !flag('wearer-confirmed')) throw Error('Enable requires --wearer-confirmed after agreement to automatic SOS/fall photos.');
  const config = require('../src/config');
  const recordedBy = flag('recorded-by') ? argument('recorded-by').trim().toLowerCase() : '';
  if (!config.adminEmails.includes(recordedBy)) throw Error('--recorded-by must be in ADMIN_EMAILS.');
  const { initFirestore } = require('../src/firestore');
  const db = initFirestore({ startWatchers: false });
  if (!db) throw Error('Firestore unavailable.');
  const ref = db.collection('incidentPhotoSettings').doc(imei);
  if (flag('disable')) {
    await ref.set({ enabled: false, aiConsentConfirmed: false, recordedBy, updatedAt: new Date() }, { merge: true });
    console.log('Incident photo capture and AI disabled. Existing private photos retain their expiry.');
    return;
  }
  const users = await db.collection('users').where('linkedImeis', 'array-contains', imei).get();
  const candidates = users.docs.filter(doc => (!doc.data().serviceOwnerUid || doc.data().serviceOwnerUid === doc.id) &&
    (!flag('owner') || argument('owner') === doc.id));
  if (candidates.length !== 1) throw Error('A unique owner could not be verified; supply --owner with the correct household UID.');
  const user = candidates[0];
  const subscription = (await db.collection('serviceSubscriptions').doc(user.id).get()).data();
  const decision = assessSnapshotAccess({ requesterUid: user.id, user: user.data(), owner: user.data(), subscription, imei });
  if (!decision.ok) throw Error(`Access not available: ${decision.reason}`);
  await ref.set({ ownerUid: user.id, enabled: true, consentConfirmed: true,
    aiConsentConfirmed: flag('ai-confirmed'), consentVersion: CONSENT_VERSION,
    recordedBy, updatedAt: new Date() });
  console.log(`Household incident capture consent recorded. AI analysis: ${flag('ai-confirmed') ? 'enabled' : 'disabled'}. Gateway runtime flags still apply.`);
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
