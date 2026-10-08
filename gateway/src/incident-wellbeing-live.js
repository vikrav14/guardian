'use strict';

const { createIncidentWellbeing } = require('./incident-wellbeing');
const { validConsent } = require('./care-wellbeing');
const { can, serviceEntitlements } = require('./family-policy');

let live;
async function incidentAccess(db, imei, expectedOwner, now = new Date()) {
  const [serviceDoc, consentDoc] = await Promise.all([
    db.collection('familyServices').doc(imei).get(),
    db.collection('wellbeingConsents').doc(imei).get(),
  ]);
  const service = serviceDoc.data(), ownerUid = service?.ownerUid;
  const entitlement = serviceEntitlements(service, +now);
  return { ownerUid: ownerUid || null, ok: !!ownerUid &&
    (!expectedOwner || expectedOwner === ownerUid) && can(service, ownerUid, 'wellbeing', +now) &&
    entitlement.serviceActive && ['family', 'care'].includes(entitlement.plan) && validConsent(consentDoc.data(), now) };
}

function startIncidentWellbeing({ db, config, wellness }) {
  if (!db || !config.incidentWellbeingEnabled || !wellness) return null;
  const enabled = () => config.incidentWellbeingEnabled && config.wellnessRoutineEnabled &&
    config.careWellbeingRequestEnabled && config.careWellbeingIngestEnabled && config.careWellbeingCustomerEnabled;
  live = createIncidentWellbeing({ db, enabled,
    authorize: (imei, ownerUid) => incidentAccess(db, imei, ownerUid),
    availability: async job => {
      // Let the initial photo finish before requesting optical measurements.
      // No await or sensor command is added to the initial alert/ACK path.
      const alert = (await db.collection('alerts').doc(job.id).get()).data();
      const photosEnabled = require('./incident-photos-live').getIncidentPhotos()?.getStatus().enabled;
      if (photosEnabled && alert?.incidentPhotoPending) return 'incident_photo_pending';
      if (photosEnabled && alert?.photoIncidentId) {
        const photo = (await db.collection('incidentPhotos').doc(alert.photoIncidentId).get()).data();
        if (photo?.state === 'collecting') return 'incident_photo_pending';
      }
      return wellness.incidentAvailability(job.imei);
    },
    request: args => wellness.requestIncidentWellness(args),
    status: args => wellness.wellnessSequenceStatus(args),
  });
  const run = () => live.sweep().catch(() => console.warn('[incident-wellbeing] work deferred; values omitted'));
  const timer = setInterval(run, 3000); timer.unref(); run();
  // Incident snapshots have a bounded 24-hour lifetime, independent of routine
  // history. Revocation also removes them via manage-wellbeing-consent.
  const cleanup = async () => {
    const expired = await db.collection('incidentWellbeing').where('expiresAt', '<=', new Date()).limit(100).get();
    const batch = db.batch();
    for (const doc of expired.docs) batch.delete(doc.ref);
    if (!expired.empty) await batch.commit();
  };
  const cleanupTimer = setInterval(() => cleanup().catch(() =>
    console.warn('[incident-wellbeing] cleanup deferred')), 60_000);
  cleanupTimer.unref();
  return live;
}

module.exports = { startIncidentWellbeing, incidentAccess, getIncidentWellbeing: () => live };
