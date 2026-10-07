'use strict';
const { hash } = require('./family-store');
const { activePeople, can, policy, serviceEntitlements } = require('./family-policy');
function selectedRecipients(service, now) {
  return activePeople(service, now).filter(uid => service.members[uid].whatsapp &&
    service.members[uid].whatsappConsent && can(service, uid, 'alerts', now))
    .sort((a, b) => a === service.ownerUid ? -1 : b === service.ownerUid ? 1 : a.localeCompare(b))
    .slice(0, policy(service).whatsappRecipients);
}
async function managedContacts(db, imei, now = Date.now()) {
  const service = (await db.collection('familyServices').doc(imei).get()).data();
  if (!service) return null;
  const entitlements = serviceEntitlements(service, now);
  if (!entitlements.serviceActive) return [];
  if (service.legacyNotifications) {
    // A private, operator-reviewed snapshot keeps the pre-migration recipients.
    // Newly invited members cannot inject contacts through their user profile.
    const contacts = [];
    for (const contact of service.legacyNotifications.contacts || []) {
      if (!can(service, contact.guardianUid, 'alerts', now)) continue;
      const profile = (await db.collection('users').doc(contact.guardianUid).get()).data();
      if (!(profile?.linkedImeis || []).includes(imei) ||
          !(profile?.emergencyContacts || []).some(current =>
            String(current?.phone || '').trim() === contact.phone &&
            (current?.whatsapp ? String(current.whatsapp).trim() : null) === contact.whatsapp)) continue;
      const source = (await db.collection('serviceSubscriptions').doc(contact.sourceSubscriptionOwnerUid).get()).data();
      const previous = require('./entitlements').evaluateSubscription(source, { now: new Date(now), ownerUid: contact.sourceSubscriptionOwnerUid });
      if (previous.serviceActive) contacts.push({ ...contact, entitlements: previous });
    }
    return contacts;
  }
  const selected = selectedRecipients(service, now);
  const result = [];
  for (const uid of selected) {
    const channel = (await db.collection('familyChannels').doc(uid).get()).data();
    if (!channel?.verifiedAtMs) continue;
    result.push({ name: service.members[uid].name, phone: channel.phone, whatsapp: channel.phone,
      guardianUid: uid, entitlements, managedFamily: true });
  }
  return result;
}
async function claimSafetyDelivery(db, imei, alertId, uid, phone, now = Date.now()) {
  if (!alertId || !phone) return false;
  return db.runTransaction(async tx => {
    const ref = db.collection('familyDeliveries').doc(hash(`${imei}:${alertId}:${uid}`));
    const previous = await tx.get(ref);
    const service = (await tx.get(db.collection('familyServices').doc(imei))).data();
    const channel = (await tx.get(db.collection('familyChannels').doc(uid))).data();
    const number = (await tx.get(db.collection('familyNumbers').doc(hash(phone)))).data();
    const member = service?.members?.[uid];
    if (service?.legacyNotifications || previous.exists || !can(service, uid, 'alerts', now) || !member.whatsapp || !member.whatsappConsent ||
        !serviceEntitlements(service, now).serviceActive || !channel?.verifiedAtMs ||
        channel.phone !== phone || number?.uid !== uid || !selectedRecipients(service, now).includes(uid)) return false;
    tx.create(ref, { imei, alertId, uid, handoffAtMs: now });
    return true;
  });
}
module.exports = { managedContacts, claimSafetyDelivery };
