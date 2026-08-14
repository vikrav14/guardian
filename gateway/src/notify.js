const config = require('./config');
const { buildSafetyMessage } = require('./safety-message');
const {
  prepareSosWhatsApp,
  sendPreparedSosWhatsApp,
} = require('./sos-whatsapp');
const {
  FEATURE, hasEntitlement, loadEntitlementsForUser,
} = require('./entitlements');

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
    for (const c of list) {
      if (!c || !c.phone) continue;
      contacts.push({
        name: c.name || 'Contact',
        phone: String(c.phone).trim(),
        whatsapp: c.whatsapp ? String(c.whatsapp).trim() : null,
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

async function sendWhatsApp(to, body) {
  if (!config.twilioWhatsAppFrom) {
    return { ok: false, skipped: true, reason: 'TWILIO_WHATSAPP_FROM missing' };
  }
  const dest = normalizeE164(to);
  return twilioRequest('/Messages.json', {
    To: dest.startsWith('whatsapp:') ? dest : `whatsapp:${dest}`,
    From: config.twilioWhatsAppFrom,
    Body: body,
  });
}

function buildMessage(imei, alert, device = null) {
  const normalizedType = String(alert?.type || '').trim().toLowerCase();
  if (normalizedType === 'sos' || normalizedType === 'fall') {
    return buildSafetyMessage({
      type: normalizedType,
      device: device || {},
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
 * Uses Twilio when configured; always writes a notificationLogs row.
 */
async function notifyEmergencyContacts(db, imei, alert) {
  const contacts = await findContactsForImei(db, imei);
  const device = await loadDeviceForNotification(db, imei);
  const text = buildMessage(imei, alert, device);
  const results = [];
  const isSos = String(alert?.type || '').toLowerCase() === 'sos';

  // Cost-smart: compose once per SOS event, then fan the same validated
  // Meta template out to every emergency contact.
  const sosPreparationPromise =
    isSos && config.notifyWhatsApp &&
      contacts.some((contact) => hasEntitlement(contact.entitlements, FEATURE.WHATSAPP_SAFETY_ALERTS))
      ? prepareSosWhatsApp({ device: device || {}, alert }).catch((err) => ({
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
      hasEntitlement(c.entitlements, FEATURE.WHATSAPP_SAFETY_ALERTS)
    ) {
      if (isSos && sosPreparationPromise) {
        const prepared = await sosPreparationPromise;
        if (prepared?.error) {
          entry.channels.whatsapp = await sendWhatsApp(waTarget, text);
          entry.channels.whatsapp.fallbackUsed = true;
          entry.channels.whatsapp.metaPreparationError = prepared.error;
        } else {
          entry.channels.whatsapp = await sendPreparedSosWhatsApp(
            waTarget,
            prepared,
            {
              // Temporary safety net while the Meta templates are being approved.
              // Once Meta is stable in production, Twilio WhatsApp can be removed.
              fallbackSend: sendWhatsApp,
            }
          );
        }
      } else {
        entry.channels.whatsapp = await sendWhatsApp(waTarget, text);
      }
    } else {
      entry.channels.whatsapp = {
        ok: false,
        skipped: true,
        reason: config.notifyWhatsApp ? 'PLAN_EXCLUDES_WHATSAPP' : 'NOTIFY_WHATSAPP=false',
      };
    }

    // Always log intent so you can see fan-out without Twilio.
    console.log(
      `[notify] ${c.name} ${c.phone} sms=${entry.channels.sms.ok ? 'ok' : entry.channels.sms.reason || 'fail'} ` +
        `wa=${entry.channels.whatsapp.ok ? 'ok' : entry.channels.whatsapp.reason || 'fail'}`
    );
    results.push(entry);
  }

  if (db) {
    await db.collection('notificationLogs').add({
      imei,
      alertType: alert.type || null,
      message: text,
      contactCount: contacts.length,
      results,
      createdAt: adminTimestamp(),
    });
  }

  return results;
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
  sendWhatsApp,
};
