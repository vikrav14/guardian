'use strict';
const { fail, hash } = require('./policy');
const { PERMISSIONS, can, activeMember, serviceEntitlements } = require('../family-policy');
const { hasEntitlement, FEATURE } = require('../entitlements');
async function authorizeIntelligence(db, uid, imei, { now = Date.now() } = {}) {
  if (!db || !/^[^/\s]{1,128}$/.test(uid || '') || !/^\d{15}$/.test(imei || '')) fail('access_not_shared', 403);
  const service = (await db.collection('familyServices').doc(imei).get()).data();
  // There is no fallback to editable linkedImeis or a caller's account plan.
  // The new experience requires the per-wearer, backend-managed grant model.
  if (!service || !activeMember(service, uid, now)) fail('access_not_shared', 403);
  const entitlements = serviceEntitlements(service, now);
  const permissions = PERMISSIONS.filter(p => can(service, uid, p, now));
  if (!hasEntitlement(entitlements, FEATURE.GUARDIAN_AI) || !['family', 'care'].includes(entitlements.plan)) fail('active_service_required', 403);
  const ownerUid = entitlements.ownerUid;
  const scopeKey = hash(JSON.stringify([imei, ownerUid, entitlements.plan, permissions]));
  return { uid, imei, ownerUid, plan: entitlements.plan, permissions, scopeKey, serviceKey: `watch:${ownerUid}:${imei}` };
}
function scopeForAccess(db, access, jobId, feature, options = {}) {
  return { db, ...access, jobId, feature, ...options, authorize: async () => {
    const fresh = await authorizeIntelligence(db, access.uid, access.imei);
    if (fresh.scopeKey !== access.scopeKey) fail('access_changed', 403);
    return fresh;
  } };
}
module.exports = { authorizeIntelligence, scopeForAccess };
