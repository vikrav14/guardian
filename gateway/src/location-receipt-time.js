'use strict';

const MAX_LOCATION_CLOCK_LEAD_MS = 15_000;
const TIME_BASIS = 'gateway_receipt_location_clock_skew';
const millis = value => value instanceof Date ? +value
  : typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) ? Date.parse(value) : NaN;

/** Only freshly decoded location packets pass here, before durable capture.
 * A small watch clock lead uses that packet's receipt time. Old/missing/large
 * future timestamps and alarms are untouched; database reads never call this.
 * Preserve the source clock for diagnosis instead of silently inventing GPS time.
 */
function normalizeReceivedLocationEvent(event, receivedAt) {
  if (event?.type !== 'location') return event;
  const sourceAt = millis(event.location?.recordedAt);
  const receiptAt = millis(receivedAt);
  const lead = sourceAt - receiptAt;
  if (!Number.isFinite(lead) || lead <= 0 || lead > MAX_LOCATION_CLOCK_LEAD_MS) return event;
  return { ...event, location: { ...event.location,
    recordedAt: new Date(receiptAt), deviceRecordedAt: new Date(sourceAt), timeBasis: TIME_BASIS } };
}

function locationClockEvidence(point) {
  const lead = millis(point?.deviceRecordedAt) - millis(point?.recordedAt);
  return point?.timeBasis === TIME_BASIS && lead > 0 && lead <= MAX_LOCATION_CLOCK_LEAD_MS
    ? { deviceRecordedAt: new Date(millis(point.deviceRecordedAt)), timeBasis: TIME_BASIS } : {};
}

module.exports = { MAX_LOCATION_CLOCK_LEAD_MS, normalizeReceivedLocationEvent, locationClockEvidence };
