'use strict';

// Guardian's initial market uses Indian/Mauritius (UTC+4, no DST).
// Keep this calendar contract aligned with Flutter and Firestore rules.
const DAY_MS = 86_400_000;
const OFFSET_MS = 4 * 60 * 60 * 1000;
function wellnessDayStart(now = new Date()) {
  const time = new Date(now).getTime();
  if (!Number.isFinite(time)) throw new TypeError('Invalid wellness clock');
  return new Date(Math.floor((time + OFFSET_MS) / DAY_MS) * DAY_MS - OFFSET_MS);
}
function wellnessWindow(entitlements, { now = new Date(), days = 7, minimumPlan = 'essential' } = {}) {
  if (!entitlements?.serviceActive || !['essential', 'family', 'care'].includes(entitlements.plan)) return null;
  if (minimumPlan === 'care' && entitlements.plan !== 'care') return null;
  if (entitlements.accessUntil && new Date(entitlements.accessUntil) <= now) return null;
  const maximum = entitlements.plan === 'essential' ? 1 : entitlements.plan === 'family' ? 7 : 31;
  const count = Math.min(maximum, Math.max(1, Math.floor(Number(days) || 1)));
  const end = new Date(wellnessDayStart(now).getTime() + DAY_MS);
  return { start: new Date(end.getTime() - count * DAY_MS), end, days: count };
}
function wellnessRecordInWindow(value, window, now = new Date()) {
  const date = value?.toDate?.() || new Date(value);
  return !!window && Number.isFinite(date.getTime()) && date >= window.start && date < window.end && date <= now;
}
module.exports = { wellnessDayStart, wellnessWindow, wellnessRecordInWindow };
