'use strict';

function copyInteger(target, key, value, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isInteger(value) || value < min || value > max) return false;
  target[key] = value;
  return true;
}

function extractV52TelemetryValues(event = {}) {
  const values = {};
  copyInteger(values, 'batteryPercent', event.batteryPercent, { max: 100 });
  copyInteger(values, 'cellularSignalPercent', event.cellularSignalPercent, { max: 100 });
  copyInteger(values, 'stepsRaw', event.stepsRaw);
  copyInteger(values, 'rollCountRaw', event.rollCountRaw);
  return values;
}

function buildV52TelemetryPatch(event = {}, receivedAt = new Date()) {
  const values = extractV52TelemetryValues(event);
  const patch = { ...values };
  const hasBattery = values.batteryPercent != null;
  const hasSignal = values.cellularSignalPercent != null;
  const hasActivity = values.stepsRaw != null || values.rollCountRaw != null;

  if (!hasBattery && !hasSignal && !hasActivity) return patch;

  const timestamp = receivedAt instanceof Date && !Number.isNaN(receivedAt.getTime())
    ? receivedAt
    : new Date();
  patch.telemetryUpdatedAt = timestamp;
  if (hasBattery) patch.batteryUpdatedAt = timestamp;
  if (hasSignal) patch.cellularSignalUpdatedAt = timestamp;
  if (hasActivity) patch.activityUpdatedAt = timestamp;
  return patch;
}

module.exports = {
  extractV52TelemetryValues,
  buildV52TelemetryPatch,
};
