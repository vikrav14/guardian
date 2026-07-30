/**
 * Reminder scheduler for pill/medication reminders.
 *
 * Checks Firestore for active reminders and sends WhatsApp messages
 * when the scheduled time arrives.
 *
 * Schedule: Runs every minute to check all active reminders.
 */

const { sendWhatsApp, normalizeE164 } = require('./notify');

/**
 * Get current time in HH:MM format (24-hour).
 */
function getCurrentTimeHHMM() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * Check if a reminder should fire today.
 *
 * @param {Object} reminder - Reminder doc
 * @returns {boolean}
 */
function shouldFireToday(reminder) {
  if (reminder.status !== 'active') {
    return false;
  }

  const frequency = String(reminder.frequency || 'daily').toLowerCase();
  if (frequency === 'daily') {
    return true;
  }

  const now = new Date();
  const dayOfWeek = now.getDay(); // 0 = Sun, 6 = Sat

  if (frequency === 'weekdays') {
    return dayOfWeek >= 1 && dayOfWeek <= 5; // Mon-Fri
  }

  if (frequency === 'weekends') {
    return dayOfWeek === 0 || dayOfWeek === 6; // Sun, Sat
  }

  // Specific day (e.g., "monday", "tuesday")
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  if (dayNames.includes(frequency)) {
    return dayNames.indexOf(frequency) === dayOfWeek;
  }

  return false;
}

/**
 * Check if reminder should fire right now (within 1-minute window).
 *
 * @param {string} scheduledTime - Time in HH:MM format
 * @returns {boolean}
 */
function timeMatchesNow(scheduledTime) {
  const current = getCurrentTimeHHMM();
  return current === scheduledTime;
}

/**
 * Check if reminder was already sent today.
 *
 * @param {Object} reminder - Reminder doc
 * @returns {boolean}
 */
function alreadySentToday(reminder) {
  if (!reminder.lastSentAt) {
    return false;
  }

  const lastSent = reminder.lastSentAt.toDate ? reminder.lastSentAt.toDate() : reminder.lastSentAt;
  const today = new Date();

  return (
    lastSent.getFullYear() === today.getFullYear() &&
    lastSent.getMonth() === today.getMonth() &&
    lastSent.getDate() === today.getDate()
  );
}

/**
 * Start the reminder scheduler.
 *
 * Runs every minute and checks all active reminders.
 */
function startReminderScheduler(db, config = {}) {
  if (!db) {
    console.warn('[reminder-scheduler] Firestore unavailable, skipping scheduler');
    return { stop: () => {} };
  }

  const interval = config.checkIntervalMs || 60000; // Default: 1 minute

  let active = true;

  async function checkReminders() {
    if (!active) return;

    try {
      const usersSnap = await db.collection('users').get();

      for (const userDoc of usersSnap.docs) {
        const user = userDoc.data() || {};
        const linkedImeis = Array.isArray(user.linkedImeis) ? user.linkedImeis : [];

        for (const imei of linkedImeis) {
          const remindersSnap = await db
            .collection('devices')
            .doc(imei)
            .collection('reminders')
            .where('status', '==', 'active')
            .get();

          for (const reminderDoc of remindersSnap.docs) {
            const reminder = reminderDoc.data() || {};

            // Check all firing conditions
            if (!shouldFireToday(reminder)) continue;
            if (!timeMatchesNow(reminder.scheduledTime)) continue;
            if (alreadySentToday(reminder)) continue;

            // Fire the reminder
            const deviceSnap = await db.collection('devices').doc(imei).get();
            const device = deviceSnap.data() || {};

            const deviceName = device.nickname || device.relatedName || 'Your loved one';
            const message = `💊 **Reminder for ${deviceName}**: Take ${reminder.medicineName} at ${reminder.scheduledTime}`;

            // Send to guardian
            const guardianPhone = user.whatsapp || user.phone;
            if (guardianPhone) {
              const normalizedPhone = normalizeE164(guardianPhone);
              await sendWhatsApp(normalizedPhone, message);
              console.log(`[reminder-scheduler] Sent reminder to ${normalizedPhone}: ${reminder.medicineName}`);
            }

            // Update reminder's lastSentAt timestamp
            await reminderDoc.ref.update({
              lastSentAt: new Date(),
            });
          }
        }
      }
    } catch (err) {
      console.error('[reminder-scheduler] Error checking reminders:', err.message);
    }
  }

  // Run once immediately, then every interval
  checkReminders().catch((err) => console.error('[reminder-scheduler] Initial check failed:', err));
  const timerId = setInterval(checkReminders, interval);

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
  startReminderScheduler,
};
