'use strict';
const { loadEntitlementsForUser } = require('./entitlements');

// Called only by expiry cleanup, never on the telemetry/SOS critical path.
// Renewal retains existing accepted history; upgrading cannot reconstruct data
// that was already deleted. Subscription and membership are checked afresh.
async function hasActiveCareForDevice(db, imei, now) {
  const users = await db.collection('users').where('linkedImeis', 'array-contains', imei).get();
  for (const doc of users.docs) {
    const context = await loadEntitlementsForUser(db, { ...(doc.data() || {}), uid: doc.id }, { now });
    if (context.serviceActive && context.plan === 'care') return true;
  }
  return false;
}

async function cleanupWellnessRecords(db, docs, { now, canRetain = async () => true } = {}) {
  const eligibility = new Map();
  const batch = db.batch();
  let deleted = 0, renewed = 0;
  for (const doc of docs) {
    const data = doc.data() || {};
    const imei = data.imei || doc.ref.parent?.parent?.id;
    let keep = false;
    if (data.displayable === true && imei) {
      if (!eligibility.has(imei)) {
        eligibility.set(imei, await hasActiveCareForDevice(db, imei, now) && await canRetain(imei));
      }
      keep = eligibility.get(imei);
    }
    if (keep) {
      batch.update(doc.ref, { expiresAt: new Date(+now + 30 * 86_400_000), retentionPolicy: 'active_care_review' });
      renewed++;
    } else {
      batch.delete(doc.ref);
      deleted++;
    }
  }
  if (docs.length) await batch.commit();
  return { deleted, renewed };
}
module.exports = { hasActiveCareForDevice, cleanupWellnessRecords };
