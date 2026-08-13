function normalizeLanguage(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9%'+]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function extractTimePeriod(text, now = new Date()) {
  const value = normalizeLanguage(text);
  let daysAgo = 0;
  let label = 'today';
  if (/\b(yesterday|hier|yer)\b/.test(value)) {
    daysAgo = 1;
    label = 'yesterday';
  }

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Indian/Mauritius',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(now).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]),
  );
  const localMidnightUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day) - daysAgo,
    -4,
  );
  return {
    key: label,
    label,
    startAt: new Date(localMidnightUtc),
    endAt: new Date(localMidnightUtc + 24 * 60 * 60 * 1000),
  };
}

module.exports = { normalizeLanguage, extractTimePeriod };
