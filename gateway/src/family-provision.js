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
  const preserveExisting = manifest.migration?.preserveExistingNotifications === true;
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
    let subscription = { version: 1, managedBy: 'guardian_admin', plan, status: 'active' };
    let legacyNotifications;
    if (preserveExisting) {
      // Only an already linked service owner can use this migration. Reference
      // the existing subscription; do not manufacture a new paid agreement.
      const owner = profiles.find(profile => profile.uid === ownerUid).user;
      const sourcePath = `serviceSubscriptions/${ownerUid}`;
      if (manifest.migration.sourceSubscription !== sourcePath ||
          contractId !== `migration:${sourcePath}:${imei}` ||
          (owner.serviceOwnerUid || ownerUid) !== ownerUid ||
          !linked.docs.some(doc => doc.id === ownerUid)) fail('existing_owner_required');
      subscription = (await tx.get(db.doc(sourcePath))).data();
      if (subscription?.plan !== plan || !require('./entitlements').evaluateSubscription(subscription).serviceActive)
        fail('active_matching_subscription_required');
      const contacts = [];
      for (const { uid, user } of profiles.filter(profile => linked.docs.some(doc => doc.id === profile.uid))) {
        const entitlement = await require('./entitlements').loadEntitlementsForUser({
          collection: name => ({ doc: id => ({ get: () => tx.get(db.collection(name).doc(id)) }) }),
        }, { ...user, uid });
        if (!entitlement.serviceActive) continue;
        for (const [index, contact] of (user.emergencyContacts || []).entries()) {
          if (!contact?.phone) continue;
          contacts.push({ guardianUid: uid, name: contact.name || 'Contact',
            phone: String(contact.phone).trim(), whatsapp: contact.whatsapp ? String(contact.whatsapp).trim() : null,
            isPrimary: contact.isPrimary === true, contactIndex: index,
            // Preserve each existing contact's entitlement, including Essential limits.
            sourceSubscriptionOwnerUid: entitlement.ownerUid });
        }
      }
      legacyNotifications = { contacts, preservedAt: new Date(), sourceSubscription: sourcePath };
    }
    // Preserve legacy members' access in the reviewed migration; narrow it
    // afterwards with an explicit owner action. Do not silently drop people.
    const all = Object.fromEntries(PERMISSIONS.map(key => [key, true]));
    const service = { imei, ownerUid, wearerName: watch.nickname || watch.name || 'Family member',
      policyVersion: POLICY_VERSION, contractHash: hash(contractId), invites: {},
      subscription, ...(legacyNotifications ? { legacyNotifications } : {}),
      members: Object.fromEntries(profiles.map(({ uid, user }) => [uid, {
        name: user.displayName || user.email || 'Family member', email: user.email || null,
        status: 'active', role: uid === ownerUid ? 'owner' : 'caregiver', permissions: all,
        untilMs: null, whatsapp: false, whatsappConsent: false, migrationReviewed: true,
      }])), createdAt: new Date() };
    const preview = { imei, ownerUid, plan, people: members.length, limit: PLANS[plan].people,
      overLimit: members.length > PLANS[plan].people, whatsappRecipients: 0,
      notificationRouting: preserveExisting ? 'legacy_preserved' : 'family',
      preservedContacts: legacyNotifications?.contacts.length || 0,
      warning: preserveExisting
        ? 'Existing alert contacts are preserved. New WhatsApp recipient selection remains pending verified linking and a reviewed cutover.'
        : 'WhatsApp safety recipients must link and consent before the service is activated for customers.' };
    if (!apply) return { applied: false, ...preview };
    // Existing safety routes need a separately reviewed, consent-preserving
    // cutover. Never silently replace a live contact list with zero recipients.
    if (!preserveExisting && profiles.some(({ user }) => (user.emergencyContacts || []).some(contact => contact?.phone || contact?.whatsapp)))
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
