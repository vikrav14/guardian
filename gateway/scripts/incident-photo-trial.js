'use strict';
const { consentAllows } = require('../src/incident-photo-policy');
async function main() {
  const index = process.argv.indexOf('--imei');
  const imei = index < 0 ? '' : process.argv[index + 1];
  if (!/^\d{15}$/.test(imei) || !process.argv.includes('--confirm')) {
    throw Error('Use --imei <watch IMEI> --confirm to request one supervised sequence of up to five photos.');
  }
  const { initFirestore } = require('../src/firestore');
  const db = initFirestore({ startWatchers: false });
  if (!db) throw Error('Firestore unavailable.');
  const settings = (await db.collection('incidentPhotoSettings').doc(imei).get()).data();
  if (!consentAllows(settings, settings?.ownerUid)) throw Error('Record household photo consent first.');
  const ref = await db.collection('alerts').add({ imei, type: 'sos', severity: 'info',
    message: 'Supervised incident photo trial — no emergency notification', resolved: true, resolvedAt: new Date(),
    createdAt: new Date(), eventAt: new Date(), notifyStatus: 'skipped', incidentPhotoTrial: true,
    incidentPhotoEligible: true, incidentPhotoPending: true });
  console.log(`Trial queued once. Incident ID: ${ref.id}`);
  console.log('Open the app with ?incident=' + ref.id + ' or use its alert history. No emergency message is sent for this trial.');
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
