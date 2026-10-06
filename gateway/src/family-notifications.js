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
    if (previous.exists || !can(service, uid, 'alerts', now) || !member.whatsapp || !member.whatsappConsent ||
        !serviceEntitlements(service, now).serviceActive || !channel?.verifiedAtMs ||
        channel.phone !== phone || number?.uid !== uid || !selectedRecipients(service, now).includes(uid)) return false;
    tx.create(ref, { imei, alertId, uid, handoffAtMs: now });
    return true;
  });
}
module.exports = { managedContacts, claimSafetyDelivery };
