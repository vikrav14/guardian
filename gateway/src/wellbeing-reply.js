'use strict';

const { formatAge } = require('./battery-freshness');

function ageSeconds(value, now = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));
}

function readingLine(reading, now) {
  const age = formatAge(ageSeconds(reading.observedAt, now));
  const received = age ? ` · received ${age}` : '';
  if (reading.metricSet === 'spo2') {
    const value = Number(reading.values?.spo2Percent);
    if (!Number.isInteger(value)) return null;
    return `• Oxygen estimate: ${value}%${received}`;
  }
  if (reading.metricSet === 'heart_rate_blood_pressure') {
    const heart = Number(reading.values?.heartRateBpm);
    const systolic = Number(reading.values?.systolicMmHg);
    const diastolic = Number(reading.values?.diastolicMmHg);
    if (![heart, systolic, diastolic].every(Number.isInteger)) return null;
    return `• Heart rate: ${heart} bpm · blood pressure estimate: ${systolic}/${diastolic} mmHg${received}`;
  }
  return null;
}

function formatWellbeingReply(result, { now = new Date() } = {}) {
  if (!result || result.error) {
    return 'I could not retrieve the watch wellbeing readings right now. Try again in a moment.';
  }
  const lines = (result.readings || [])
    .map((reading) => readingLine(reading, now))
    .filter(Boolean);
  if (lines.length === 0) {
    return `No accepted watch wellbeing readings are available for ${result.name || 'the wearer'} yet. Take a reading on the watch.`;
  }
  return [
    `*${result.name || 'Wearer'} — latest watch wellbeing readings:*`,
    ...lines,
    '_These are watch estimates, not medical measurements. They do not confirm that someone is safe or unwell. If you are concerned, check on the wearer and seek appropriate medical help._',
  ].join('\n');
}

module.exports = { formatWellbeingReply };
