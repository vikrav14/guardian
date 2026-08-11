const crypto = require('crypto');

function timestampKey(value) {
  if (value == null) return '';

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : value.toISOString();
  }

  if (typeof value.toDate === 'function') {
    const date = value.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime())
      ? date.toISOString()
      : '';
  }

  if (typeof value.seconds === 'number') {
    const nanos = typeof value.nanoseconds === 'number' ? value.nanoseconds : 0;
    const millis = value.seconds * 1000 + Math.floor(nanos / 1_000_000);
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString();
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function buildJourneyDocumentId(imei, journey = {}) {
  const identity = JSON.stringify([
    String(imei || ''),
    timestampKey(journey.startAt),
    timestampKey(journey.endAt),
    String(journey.polyline || ''),
    Number(journey.pointCount || 0),
  ]);

  const digest = crypto
    .createHash('sha256')
    .update(identity)
    .digest('hex')
    .slice(0, 32);

  return `journey_${digest}`;
}

module.exports = {
  buildJourneyDocumentId,
  timestampKey,
};
