const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractV52TelemetryValues,
  buildV52TelemetryPatch,
} = require('../src/v52-telemetry');

test('extractV52TelemetryValues keeps bounded V52 values including zero', () => {
  assert.deepEqual(
    extractV52TelemetryValues({
      batteryPercent: 0,
      cellularSignalPercent: 80,
      stepsRaw: 1234,
      rollCountRaw: 0,
    }),
    {
      batteryPercent: 0,
      cellularSignalPercent: 80,
      stepsRaw: 1234,
      rollCountRaw: 0,
    }
  );
});

test('extractV52TelemetryValues rejects invalid or out-of-range values', () => {
  assert.deepEqual(
    extractV52TelemetryValues({
      batteryPercent: 101,
      cellularSignalPercent: -1,
      stepsRaw: 2.5,
      rollCountRaw: '4',
    }),
    {}
  );
});

test('buildV52TelemetryPatch uses receipt time for independent freshness', () => {
  const receivedAt = new Date('2026-08-16T10:00:00.000Z');
  const patch = buildV52TelemetryPatch(
    {
      batteryPercent: 87,
      cellularSignalPercent: 75,
      stepsRaw: 40,
      rollCountRaw: 2,
    },
    receivedAt
  );

  assert.equal(patch.batteryUpdatedAt, receivedAt);
  assert.equal(patch.cellularSignalUpdatedAt, receivedAt);
  assert.equal(patch.activityUpdatedAt, receivedAt);
  assert.equal(patch.telemetryUpdatedAt, receivedAt);
});

test('buildV52TelemetryPatch does not invent timestamps without telemetry', () => {
  assert.deepEqual(buildV52TelemetryPatch({}), {});
});
