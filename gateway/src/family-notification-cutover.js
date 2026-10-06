'use strict';
const admin = require('firebase-admin');
const { hash } = require('./family-store');
const { can, policy, checkOwner, serviceEntitlements, fail } = require('./family-policy');
const { normalizeE164 } = require('./notify');

// Operator-only and preview-first. This cannot attest number ownership or opt
// someone in: the actual inbound LINK and member consent must already exist.
async function cutoverFamilyNotifications(db, { imei, ownerUid, recipientUids }, { apply = false } = {}) {
  if (!/^\d{15}$/.test(imei || '') || !Array.isArray(recipientUids) || !recipientUids.length ||
      recipientUids.some(uid => typeof uid !== 'string' || !/^[^/\s]{1,128}$/.test(uid)) ||
      new Set(recipientUids).size !== recipientUids.length) fail('invalid_manifest', 400);
  return db.runTransaction(async tx => {
    const ref = db.collection('familyServices').doc(imei), service = (await tx.get(ref)).data();
    checkOwner(service, ownerUid);
    if (!service?.legacyNotifications || !serviceEntitlements(service).serviceActive) fail('migration_not_pending');
    if (recipientUids.length > policy(service).whatsappRecipients) fail('whatsapp_recipient_limit');
    const phones = new Set();
    for (const uid of recipientUids) {
      const member = service.members[uid];
      const channel = (await tx.get(db.collection('familyChannels').doc(uid))).data();
      if (!can(service, uid, 'alerts') || !member?.whatsappConsent || !channel?.verifiedAtMs) fail('recipient_must_link_and_consent');
      const number = (await tx.get(db.collection('familyNumbers').doc(hash(channel.phone)))).data();
      if (number?.uid !== uid) fail('recipient_must_link_and_consent');
      phones.add(normalizeE164(channel.phone));
    }
    for (const contact of service.legacyNotifications.contacts) {
      if (!can(service, contact.guardianUid, 'alerts')) continue;
      const user = (await tx.get(db.collection('users').doc(contact.guardianUid))).data();
      const stillListed = (user?.emergencyContacts || []).some(current =>
        String(current?.phone || '').trim() === contact.phone &&
        (current?.whatsapp ? String(current.whatsapp).trim() : null) === contact.whatsapp);
      if (stillListed && !phones.has(normalizeE164(contact.whatsapp || contact.phone))) fail('existing_recipient_not_ready');
    }
    if (apply) {
      const members = Object.fromEntries(Object.entries(service.members).map(([uid, member]) =>
        [uid, { ...member, whatsapp: recipientUids.includes(uid) }]));
      tx.update(ref, { members, legacyNotifications: admin.firestore.FieldValue.delete() });
      tx.create(db.collection('familyAccessAudit').doc(), { imei, ownerUid, action: 'notification_cutover',
        recipientUids, at: new Date() });
    }
    return { applied: apply, imei, recipients: recipientUids.length, notificationRouting: apply ? 'family' : 'legacy_preserved' };
  });
}
module.exports = { cutoverFamilyNotifications };
