const MAURITIUS_TIME_ZONE = 'Indian/Mauritius';

function asDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateTime(value) {
  const date = asDate(value);
  if (!date) return 'time unavailable';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: MAURITIUS_TIME_ZONE,
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function formatDuration(startAt, endAt) {
  const start = asDate(startAt);
  const end = asDate(endAt);
  if (!start || !end || end < start) return null;
  const minutes = Math.round((end.getTime() - start.getTime()) / 60000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function formatJourneyReply(result) {
  if (!result || result.error) {
    return 'I could not retrieve journey history right now. Try again in a moment.';
  }

  const name = result.name || 'Your loved one';
  const journeys = Array.isArray(result.journeys) ? result.journeys : [];
  if (journeys.length === 0) {
    return `No confirmed journeys are available for ${name} yet.`;
  }

  const lines = [`*Recent journeys for ${name}:*`];
  journeys.forEach((journey, index) => {
    const duration = formatDuration(journey.startAt, journey.endAt);
    const distance = journey.distanceKm == null
      ? null
      : `${Math.round(journey.distanceKm * 10) / 10} km`;
    const details = [distance, duration].filter(Boolean).join(' · ');
    const origin = journey.originGeofenceName
      ? ` · from ${journey.originGeofenceName}`
      : '';
    lines.push(
      `${index + 1}. ${formatDateTime(journey.startAt)}${details ? ` — ${details}` : ''}${origin}`,
    );
  });
  if (Number(result.omittedLowQualityCount) > 0) {
    lines.push('_Low-quality movement records were omitted._');
  }
  return lines.join('\n');
}

module.exports = { formatJourneyReply, formatDuration };
