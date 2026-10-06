'use strict';
const admin = require('firebase-admin');
const { POLICY_VERSION, PERMISSIONS, PLANS, fail } = require('./family-policy');
const { hash } = require('./family-store');
const { deviceView, deviceProfile } = require('./family-device-view');

// Admin-only provisioning input, never called by an HTTP/client route. A paid
// contract ID is unique to one watch; IMEI possession is not ownership proof.
async function provisionFamilyService(db, manifest, { apply = false } = {}) {
  const { imei, ownerUid, plan, contractId, verifiedMemberUids = [] } = manifest;
  if (!/^\d{15}$/.test(imei || '') || !/^[^/\s]{1,128}$/.test(ownerUid || '') ||
      !PLANS[plan] || typeof contractId !== 'string' || contractId.length < 8 || contractId.length > 200 ||
      !Array.isArray(verifiedMemberUids) || verifiedMemberUids.length > 20 ||
      verifiedMemberUids.some(uid => !/^[^/\s]{1,128}$/.test(uid))) fail('invalid_manifest', 400);
  const members = [...new Set([ownerUid, ...verifiedMemberUids])];
  return db.runTransaction(async tx => {
    const ref = db.collection('familyServices').doc(imei), existing = await tx.get(ref);
    const contractRef = db.collection('familyContracts').doc(hash(contractId));
    const contract = await tx.get(contractRef);
    if (existing.exists || contract.exists) fail('service_or_contract_already_exists');
    const watch = (await tx.get(db.collection('devices').doc(imei))).data();
    if (!watch) fail('watch_not_found');
    const linked = await tx.get(db.collection('users').where('linkedImeis', 'array-contains', imei));
    if (linked.docs.some(doc => !members.includes(doc.id))) fail('review_all_existing_members');
    const profiles = [];
    for (const uid of members) {
      const user = (await tx.get(db.collection('users').doc(uid))).data();
      if (!user) fail('member_not_found');
      profiles.push({ uid, user });
    }
    // Preserve legacy members' access in the reviewed migration; narrow it
    // afterwards with an explicit owner action. Do not silently drop people.
    const all = Object.fromEntries(PERMISSIONS.map(key => [key, true]));
    const service = { imei, ownerUid, wearerName: watch.nickname || watch.name || 'Family member',
      policyVersion: POLICY_VERSION, contractHash: hash(contractId), invites: {},
      subscription: { version: 1, managedBy: 'guardian_admin', plan, status: 'active' },
      members: Object.fromEntries(profiles.map(({ uid, user }) => [uid, {
        name: user.displayName || user.email || 'Family member', email: user.email || null,
        status: 'active', role: uid === ownerUid ? 'owner' : 'caregiver', permissions: all,
        untilMs: null, whatsapp: false, whatsappConsent: false, migrationReviewed: true,
      }])), createdAt: new Date() };
    const preview = { imei, ownerUid, plan, people: members.length, limit: PLANS[plan].people,
      overLimit: members.length > PLANS[plan].people, whatsappRecipients: 0,
      warning: 'WhatsApp safety recipients must link and consent before the service is activated for customers.' };
    if (!apply) return { applied: false, ...preview };
    // Existing safety routes need a separately reviewed, consent-preserving
    // cutover. Never silently replace a live contact list with zero recipients.
    if (profiles.some(({ user }) => (user.emergencyContacts || []).some(contact => contact?.phone || contact?.whatsapp)))
      fail('existing_notification_migration_required');
    // Creating authority also changes routing, so activation must be a separately
    // reviewed deployment. This utility is not run by startup, billing or tests.
    tx.create(ref, service);
    tx.create(contractRef, { imei, ownerUid, createdAt: new Date() });
    tx.set(db.collection('familyDeviceViews').doc(imei), deviceView(watch));
    tx.set(db.collection('familyDeviceProfiles').doc(imei), deviceProfile(watch));
    for (const { uid } of profiles) tx.set(db.collection('users').doc(uid), {
      familyServiceImeis: admin.firestore.FieldValue.arrayUnion(imei),
      linkedImeis: admin.firestore.FieldValue.arrayUnion(imei),
      familyAccess: { [imei]: { owner: uid === ownerUid, permissions: all, untilMs: null } },
    }, { merge: true });
    return { applied: true, ...preview };
  });
}
module.exports = { provisionFamilyService };
