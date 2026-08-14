'use strict';

const DAY_NAMES = Object.freeze([
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
]);

function normalizeReminderTime(value) {
  const time = String(value || '').trim().padStart(5, '0');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new Error('Medication reminder time must be HH:MM (24-hour).');
  }
  return time;
}

function normalizeReminderFrequency(value, week = null) {
  const raw = String(value ?? 'daily').trim().toLowerCase();
  if (raw === '1' || raw === 'once') return { code: 1, week: null, label: 'once' };
  if (raw === '2' || raw === 'daily') return { code: 2, week: null, label: 'daily' };
  if (raw === 'weekdays') return { code: 3, week: '0111110', label: 'weekdays' };
  if (raw === 'weekends') return { code: 3, week: '1000001', label: 'weekends' };
  if (DAY_NAMES.includes(raw)) {
    const mask = DAY_NAMES.map((day) => day === raw ? '1' : '0').join('');
    return { code: 3, week: mask, label: raw };
  }
  if (raw === '3' || raw === 'weekly') {
    if (!/^[01]{7}$/.test(String(week || ''))) {
      throw new Error('Weekly medication reminder requires a 7-digit Sun-Sat week mask.');
    }
    return { code: 3, week: String(week), label: 'weekly' };
  }
  throw new Error('Medication reminder frequency must be once, daily, weekdays, weekends, weekly, or a weekday name.');
}

function canonicalMedicationReminder({
  imei, time, frequency = 'daily', week = null, text, createdBy, now = new Date(),
}) {
  const normalizedImei = String(imei || '').trim();
  const normalizedText = String(text || '').trim();
  const normalizedCreator = String(createdBy || '').trim();
  if (!normalizedImei) throw new Error('Medication reminder requires an IMEI.');
  if (!normalizedText) throw new Error('Medication reminder requires reminder text.');
  if (!normalizedCreator) throw new Error('Medication reminder requires createdBy.');
  const normalizedFrequency = normalizeReminderFrequency(frequency, week);
  return {
    imei: normalizedImei,
    time: normalizeReminderTime(time),
    frequency: normalizedFrequency.code,
    week: normalizedFrequency.week,
    text: normalizedText,
    enabled: true,
    createdBy: normalizedCreator,
    createdAt: now,
    updatedAt: now,
    lastSentAt: null,
    deliveryStatus: 'pending',
    acknowledgementStatus: 'not_supported',
  };
}

function deviceCommandParams(reminder) {
  return {
    time: reminder.time,
    frequency: reminder.frequency,
    week: reminder.week || undefined,
    text: reminder.text,
    enabled: reminder.enabled !== false,
  };
}

function alreadySentOnDate(reminder, date) {
  const raw = reminder?.lastSentAt;
  if (!raw) return false;
  const sent = raw?.toDate?.() || new Date(raw);
  if (Number.isNaN(sent.getTime())) return false;
  return sent.getFullYear() === date.getFullYear() &&
    sent.getMonth() === date.getMonth() && sent.getDate() === date.getDate();
}

function reminderDue(reminder, now = new Date()) {
  if (!reminder || reminder.enabled === false) return false;
  let time;
  let frequency;
  try {
    time = normalizeReminderTime(reminder.time);
    frequency = normalizeReminderFrequency(reminder.frequency, reminder.week);
  } catch {
    return false;
  }
  const current = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  if (time !== current || alreadySentOnDate(reminder, now)) return false;
  if (frequency.code === 1 || frequency.code === 2) return true;
  return frequency.week[now.getDay()] === '1';
}

module.exports = {
  DAY_NAMES,
  normalizeReminderTime,
  normalizeReminderFrequency,
  canonicalMedicationReminder,
  deviceCommandParams,
  alreadySentOnDate,
  reminderDue,
};
