'use strict';

function formatSteps(value) {
  return Number(value).toLocaleString('en-US');
}

function formatActivityReply(result = {}) {
  if (result.error) {
    return 'I could not verify activity data right now. Please try again later or check the Guardian app.';
  }
  const name = result.name || 'Your loved one';
  const days = Array.isArray(result.days) ? result.days : [];
  if (days.length === 0) {
    return `No accepted step reading is available for ${name} yet.`;
  }
  if (Number(result.requestedDays || 1) <= 1) {
    const day = days[0];
    const at = day.lastObservedAt ? new Date(day.lastObservedAt) : null;
    const freshness = at && Number.isFinite(at.getTime())
      ? ` Last update: ${at.toISOString().replace('T', ' ').slice(0, 16)} UTC.`
      : '';
    return `${name}: ${formatSteps(day.steps)} steps on ${day.localDate}.${freshness}`;
  }
  const readings = days
    .map((day) => `${day.localDate}: ${formatSteps(day.steps)}`)
    .join(' · ');
  return `${name}'s accepted daily step readings: ${readings}. These are everyday activity estimates, not medical measurements.`;
}

module.exports = { formatActivityReply };
