'use strict';
const { hash } = require('./family-store');
const { can, serviceEntitlements, fail } = require('./family-policy');

// An explicit response is independent of transport receipts, answer usage and
// resolution. Both the app and WhatsApp use this same transactional authority.
async function acknowledge(db, { uid, imei, alertId, source = 'app', phone = null, now = Date.now() }) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(alertId || '') || !['app', 'whatsapp'].includes(source)) fail('invalid_alert', 400);
  return db.runTransaction(async tx => {
    const alertRef = db.collection('alerts').doc(alertId), alert = (await tx.get(alertRef)).data();
    if (!alert || alert.imei !== imei || !['sos', 'fall'].includes(alert.type)) fail('alert_unavailable', 404);
    const service = (await tx.get(db.collection('familyServices').doc(imei))).data();
    if (!can(service, uid, 'alerts', now) || !serviceEntitlements(service, now).serviceActive) fail('access_not_shared', 403);
    if (source === 'whatsapp') {
      const channel = (await tx.get(db.collection('familyChannels').doc(uid))).data();
      if (!phone || channel?.phone !== phone || !channel.verifiedAtMs) fail('access_not_shared', 403);
    }
    const ref = db.collection('familyAcknowledgements').doc(hash(`${alertId}:${uid}`));
    if ((await tx.get(ref)).exists) return { acknowledged: true };
    if (alert.resolved) fail('alert_already_resolved');
    const row = { alertId, imei, uid, name: service.members[uid].name || 'Family member', source, acknowledgedAtMs: now };
    tx.create(ref, row);
    tx.set(alertRef.collection('responses').doc(uid), row);
    return { acknowledged: true };
  });
}
module.exports = { acknowledge };
