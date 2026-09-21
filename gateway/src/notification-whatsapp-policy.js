const {
  FEATURE,
  hasEntitlement,
} = require('./entitlements');

function whatsappFeatureForAlert(alert = {}) {
  const type = String(alert.type || '').trim().toLowerCase();
  return type === 'sos'
    ? FEATURE.SOS_WHATSAPP_ALERTS
    : FEATURE.WHATSAPP_SAFETY_ALERTS;
}

function contactRank(contact, index) {
  const ownerUid = String(contact?.entitlements?.ownerUid || '');
  const guardianUid = String(contact?.guardianUid || '');
  return [
    ownerUid && guardianUid === ownerUid ? 0 : 1,
    contact?.isPrimary === true ? 0 : 1,
    Number.isInteger(contact?.contactIndex) ? contact.contactIndex : index,
  ];
}

function rankBefore(left, right) {
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return left[i] < right[i];
  }
  return false;
}

/**
 * Select WhatsApp recipients without widening the rest of the plan contract.
 *
 * Family/Care keep their existing full safety-alert fan-out. A plan with only
 * the Essential SOS entitlement gets exactly one recipient per service owner:
 * the service owner's explicitly primary emergency contact, then the owner's
 * first contact, then the first stored contact as a legacy fallback.
 */
function selectWhatsAppContacts(contacts = [], alert = {}) {
  const requiredFeature = whatsappFeatureForAlert(alert);
  const entitled = contacts.filter((contact) =>
    hasEntitlement(contact?.entitlements, requiredFeature)
  );

  if (requiredFeature !== FEATURE.SOS_WHATSAPP_ALERTS) return entitled;

  const selected = [];
  const limitedByOwner = new Map();

  entitled.forEach((contact, index) => {
    if (hasEntitlement(contact.entitlements, FEATURE.WHATSAPP_SAFETY_ALERTS)) {
      selected.push(contact);
      return;
    }

    const ownerKey = String(
      contact?.entitlements?.ownerUid || contact?.guardianUid || 'unknown'
    );
    const candidate = { contact, rank: contactRank(contact, index) };
    const current = limitedByOwner.get(ownerKey);
    if (!current || rankBefore(candidate.rank, current.rank)) {
      limitedByOwner.set(ownerKey, candidate);
    }
  });

  selected.push(...Array.from(limitedByOwner.values(), (entry) => entry.contact));
  return selected;
}

module.exports = {
  whatsappFeatureForAlert,
  selectWhatsAppContacts,
};
