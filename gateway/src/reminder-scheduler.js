'use strict';

/**
 * Care reminder scheduler. The canonical record is
 * medicationReminders/{reminderId}; Flutter, WhatsApp and this worker all use
 * that same schema. Delivery is recorded separately from acknowledgement,
 * which the current V52 protocol does not prove.
 */

const config = require('./config');
const { normalizeE164 } = require('./notify');
const { sendMetaTemplate } = require('./whatsapp-meta');
const { FEATURE, hasEntitlement, loadEntitlementsForUser } = require('./entitlements');
const { reminderDue } = require('./medication-reminders');

async function runReminderCheck(db, options = {}) {
  const now = options.now || new Date();
  const send = options.sendMetaTemplate || sendMetaTemplate;
  const entitlementLoader = options.loadEntitlementsForUser || loadEntitlementsForUser;
  const remindersSnap = await db
    .collection('medicationReminders')
    .where('enabled', '==', true)
    .get();
  const userCache = new Map();

  for (const reminderDoc of remindersSnap.docs) {
    const reminder = reminderDoc.data() || {};
    if (!reminderDue(reminder, now)) continue;
    const uid = String(reminder.createdBy || '');
    if (!uid) continue;

    let userEntry = userCache.get(uid);
    if (!userEntry) {
      const userSnap = await db.collection('users').doc(uid).get();
      if (!userSnap.exists) continue;
      const user = { uid, ...(userSnap.data() || {}) };
      const entitlements = await entitlementLoader(db, user);
      userEntry = { user, entitlements };
      userCache.set(uid, userEntry);
    }
    if (!hasEntitlement(userEntry.entitlements, FEATURE.MEDICATION_REMINDERS)) continue;
    if (!(userEntry.user.linkedImeis || []).map(String).includes(String(reminder.imei))) continue;

    const guardianPhone = userEntry.user.whatsapp || userEntry.user.phone;
    if (!guardianPhone) {
      await reminderDoc.ref.update({
        deliveryStatus: 'failed',
        lastDeliveryError: 'No guardian WhatsApp or phone number is configured.',
        updatedAt: now,
      });
      continue;
    }

    const deviceSnap = await db.collection('devices').doc(String(reminder.imei)).get();
    const device = deviceSnap.exists ? (deviceSnap.data() || {}) : {};
    const deviceName = device.nickname || device.relatedName || 'Your loved one';
    const target = normalizeE164(guardianPhone);
    const templateName = String(
      options.metaTemplateName || config.metaWhatsAppReminderTemplate || ''
    ).trim();
    const result = templateName
      ? await send(target, templateName, {
          languageCode: 'en',
          components: [{
            type: 'body',
            parameters: [deviceName, reminder.text, reminder.time]
              .map((text) => ({ type: 'text', text: String(text) })),
          }],
        })
      : {
          ok: false,
          skipped: true,
          provider: 'meta',
          reason: 'META_WHATSAPP_REMINDER_TEMPLATE missing',
        };
    const accepted = result?.accepted === true || result?.ok === true;
    await reminderDoc.ref.update({
      deliveryStatus: accepted ? 'accepted' : 'failed',
      lastDelivery: {
        channel: 'whatsapp',
        ok: result?.ok === true,
        accepted,
        provider: result?.provider || null,
        messageId: result?.messageId || null,
        deliveryStatus: result?.deliveryStatus || (accepted ? 'accepted' : 'failed'),
        at: now,
      },
      lastDeliveryError: accepted ? null : (result?.error || result?.reason || 'Delivery failed.'),
      ...(accepted ? { lastSentAt: now } : {}),
      ...(accepted && Number(reminder.frequency) === 1 ? { enabled: false } : {}),
      updatedAt: now,
    });
  }
}

function startReminderScheduler(db, config = {}) {
  if (!db) {
    console.warn('[reminder-scheduler] Firestore unavailable, skipping scheduler');
    return { stop: () => {} };
  }
  const interval = config.checkIntervalMs || 60000;
  let active = true;
  async function check() {
    if (!active) return;
    try {
      await runReminderCheck(db);
    } catch (error) {
      console.error('[reminder-scheduler] Error checking reminders:', error.message);
    }
  }
  check();
  const timerId = setInterval(check, interval);
  console.log(`[reminder-scheduler] Started with ${interval}ms check interval`);
  return {
    stop: () => {
      active = false;
      clearInterval(timerId);
      console.log('[reminder-scheduler] Stopped');
    },
  };
}

module.exports = {
  runReminderCheck,
  startReminderScheduler,
};
