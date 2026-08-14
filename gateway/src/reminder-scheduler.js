'use strict';

/**
 * Care reminder scheduler. The canonical record is
 * medicationReminders/{reminderId}; Flutter, WhatsApp and this worker all use
 * that same schema. Delivery is recorded separately from acknowledgement,
 * which the current V52 protocol does not prove.
 */

const { sendWhatsApp, normalizeE164 } = require('./notify');
const { FEATURE, hasEntitlement, loadEntitlementsForUser } = require('./entitlements');
const { reminderDue } = require('./medication-reminders');

async function runReminderCheck(db, options = {}) {
  const now = options.now || new Date();
  const send = options.sendWhatsApp || sendWhatsApp;
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
    const message = `💊 **Reminder for ${deviceName}**: ${reminder.text} at ${reminder.time}`;
    const target = normalizeE164(guardianPhone);
    const result = await send(target, message);
    const delivered = result?.ok === true;
    await reminderDoc.ref.update({
      deliveryStatus: delivered ? 'sent' : 'failed',
      lastDelivery: {
        channel: 'whatsapp',
        ok: delivered,
        provider: result?.provider || null,
        at: now,
      },
      lastDeliveryError: delivered ? null : (result?.error || result?.reason || 'Delivery failed.'),
      ...(delivered ? { lastSentAt: now } : {}),
      ...(delivered && Number(reminder.frequency) === 1 ? { enabled: false } : {}),
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
