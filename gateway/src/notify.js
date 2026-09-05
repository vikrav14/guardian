const config = require('./config');
const { buildSafetyMessage } = require('./safety-message');
const { buildSosSafetyMessage } = require('./sos-location-snapshot');
const {
  prepareSosWhatsApp,
  sendPreparedSosWhatsApp,
} = require('./sos-whatsapp');
const {
  prepareFallWhatsApp,
  sendPreparedFallWhatsApp,
} = require('./fall-whatsapp');
const { deviceAtFall } = require('./fall-location-snapshot');
const { summarizeMetaDelivery } = require('./meta-delivery');
const {
  FEATURE, hasEntitlement, loadEntitlementsForUser,
} = require('./entitlements');
const {
  whatsappFeatureForAlert,
  selectWhatsAppContacts,
} = require('./notification-whatsapp-policy');

/**
 * Find guardian users who linked this IMEI and collect emergency contacts.
 */
async function findContactsForImei(db, imei) {
  const snap = await db.collection('users').where('linkedImeis', 'array-contains', imei).get();
  const contacts = [];
  for (const doc of snap.docs) {
    const data = doc.data() || {};
    const entitlements = await loadEntitlementsForUser(db, { uid: doc.id, ...data });
    if (!hasEntitlement(entitlements, FEATURE.SOS_ALERTS)) continue;
    const list = Array.isArray(data.emergencyContacts) ? data.emergencyContacts : [];
    for (let contactIndex = 0; contactIndex < list.length; contactIndex += 1) {
      const c = list[contactIndex];
      if (!c || !c.phone) continue;
      contacts.push({
        name: c.name || 'Contact',
        phone: String(c.phone).trim(),
        whatsapp: c.whatsapp ? String(c.whatsapp).trim() : null,
        isPrimary: c.isPrimary === true,
        contactIndex,
        guardianUid: doc.id,
        entitlements,
      });
    }
  }
  return contacts;
}

function normalizeE164(phone) {
  const digits = String(phone).replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  // Mauritius default country code if local mobile given
  if (/^5\d{7}$/.test(digits)) return `+230${digits}`;
  if (/^\d{8,15}$/.test(digits)) return `+${digits}`;
  return digits;
}

async function twilioRequest(path, body) {
  const sid = config.twilioAccountSid;
  const token = config.twilioAuthToken;
  if (!sid || !token) return { ok: false, skipped: true, reason: 'twilio_not_configured' };

  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
  const params = new URLSearchParams(body);
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, body: text.slice(0, 300) };
  }
  return { ok: true, body: text.slice(0, 120) };
}

async function sendSms(to, body) {
  if (!config.twilioFromSms) {
    return { ok: false, skipped: true, reason: 'TWILIO_FROM_SMS missing' };
  }
  return twilioRequest('/Messages.json', {
    To: normalizeE164(to),
    From: config.twilioFromSms,
    Body: body,
  });
}

function buildMessage(imei, alert, device = null) {
  const normalizedType = String(alert?.type || '').trim().toLowerCase();
  if (normalizedType === 'sos') {
    return buildSosSafetyMessage({ device: device || {}, alert: alert || {} });
  }
  if (normalizedType === 'fall') {
    const safetyDevice = normalizedType === 'fall'
      ? deviceAtFall(device || {}, alert || {})
      : (device || {});
    return buildSafetyMessage({
      type: normalizedType,
      device: safetyDevice,
      alert: alert || {},
    });
  }

  const type = String(alert?.type || 'alert').toUpperCase();
  const msg = alert?.message || 'Guardian alert';
  return `Guardian ${type}: ${msg}`;
}

async function loadDeviceForNotification(db, imei) {
  if (!db) return null;
  try {
    const snap = await db.collection('devices').doc(imei).get();
    return snap.exists ? { imei, ...(snap.data() || {}) } : null;
  } catch (err) {
    console.error(`[notify] device context lookup failed for ${imei}: ${err.message}`);
    return null;
  }
}

/**
 * Notify all emergency contacts linked to this IMEI.
 * Carrier SMS is optional; WhatsApp uses Meta Cloud API only. Every attempt is
 * written to notificationLogs so Meta delivery webhooks can update it later.
 */
async function notifyEmergencyContacts(db, imei, alert, { alertId = null } = {}) {
  const contacts = await findContactsForImei(db, imei);
  const device = await loadDeviceForNotification(db, imei);
  const text = buildMessage(imei, alert, device);
  const results = [];
  const isSos = String(alert?.type || '').toLowerCase() === 'sos';
  const isFall = String(alert?.type || '').toLowerCase() === 'fall';
  const whatsappContacts = selectWhatsAppContacts(contacts, alert);
  const whatsappContactSet = new Set(whatsappContacts);
  const requiredWhatsAppFeature = whatsappFeatureForAlert(alert);

  // Cost-smart: compose once per event, then fan the same validated Meta
  // template only to recipients selected by the plan/channel policy.
  const sosPreparationPromise =
    isSos && config.notifyWhatsApp &&
      whatsappContacts.length > 0
      ? prepareSosWhatsApp({ device: device || {}, alert }).catch((err) => ({
          error: err.message,
        }))
      : null;
  const fallPreparationPromise =
    isFall && config.notifyWhatsApp &&
      whatsappContacts.length > 0
      ? prepareFallWhatsApp({ device: device || {}, alert }).catch((err) => ({
          error: err.message,
        }))
      : null;

  if (contacts.length === 0) {
    console.log(`[notify] no emergency contacts for IMEI ${imei}`);
  }

  for (const c of contacts) {
    const entry = { name: c.name, phone: c.phone, channels: {} };

    if (config.notifySms) {
      entry.channels.sms = await sendSms(c.phone, text);
    } else {
      entry.channels.sms = { ok: false, skipped: true, reason: 'NOTIFY_SMS=false' };
    }

    const waTarget = c.whatsapp || c.phone;
    if (
      config.notifyWhatsApp &&
      whatsappContactSet.has(c)
    ) {
      if (isSos && sosPreparationPromise) {
        const prepared = await sosPreparationPromise;
        if (prepared?.error) {
          entry.channels.whatsapp = {
            ok: false,
            provider: 'meta',
            deliveryStatus: 'failed',
            reason: 'SOS_TEMPLATE_PREPARATION_FAILED',
            error: prepared.error,
            fallbackUsed: false,
          };
        } else {
          entry.channels.whatsapp = await sendPreparedSosWhatsApp(
            waTarget,
            prepared
          );
        }
      } else if (isFall && fallPreparationPromise) {
        const prepared = await fallPreparationPromise;
        if (prepared?.error) {
          entry.channels.whatsapp = {
              ok: false,
              provider: 'meta',
              deliveryStatus: 'failed',
              reason: 'FALL_TEMPLATE_PREPARATION_FAILED',
              error: prepared.error,
              fallbackUsed: false,
          };
        } else {
          entry.channels.whatsapp = await sendPreparedFallWhatsApp(
            waTarget,
            prepared
          );
        }
      } else {
        entry.channels.whatsapp = {
          ok: false,
          skipped: true,
          provider: 'meta',
          reason: 'UNSUPPORTED_SAFETY_TEMPLATE',
        };
      }
    } else {
      const planIncludesChannel = hasEntitlement(
        c.entitlements,
        requiredWhatsAppFeature
      );
      entry.channels.whatsapp = {
        ok: false,
        skipped: true,
        reason: !config.notifyWhatsApp
          ? 'NOTIFY_WHATSAPP=false'
          : planIncludesChannel
            ? 'PRIMARY_WHATSAPP_RECIPIENT_ONLY'
            : 'PLAN_EXCLUDES_WHATSAPP',
      };
    }

    // Always log intent so you can see fan-out without Twilio.
    console.log(
      `[notify] ${c.name} ${c.phone} sms=${entry.channels.sms.ok ? 'ok' : entry.channels.sms.reason || 'fail'} ` +
        `wa=${entry.channels.whatsapp.ok ? 'ok' : entry.channels.whatsapp.reason || 'fail'}`
    );
    results.push(entry);
  }

  const metaMessageIds = results
    .map((entry) => entry.channels?.whatsapp?.messageId)
    .filter(Boolean);
  const deliverySummary = summarizeMetaDelivery(results);
  let notificationLogId = null;
  if (db) {
    const ref = await db.collection('notificationLogs').add({
      imei,
      alertId,
      alertType: alert.type || null,
      message: text,
      contactCount: contacts.length,
      results,
      metaMessageIds,
      deliveryStatus: deliverySummary.status,
      deliverySummary,
      createdAt: adminTimestamp(),
    });
    notificationLogId = ref?.id || null;
  }

  return { results, notificationLogId, deliverySummary };
}

function adminTimestamp() {
  try {
    const admin = require('firebase-admin');
    return admin.firestore.FieldValue.serverTimestamp();
  } catch {
    return new Date().toISOString();
  }
}

module.exports = {
  notifyEmergencyContacts,
  findContactsForImei,
  buildMessage,
  loadDeviceForNotification,
  normalizeE164,
  sendSms,
};
