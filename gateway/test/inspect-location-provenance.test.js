const test = require('node:test');
const assert = require('node:assert/strict');

const {
  inspectDeviceLocation,
} = require('../scripts/inspect-location-provenance');

test('inspection proves retention without claiming metre-level satellite precision', () => {
  const satelliteAt = new Date('2026-08-14T19:42:33.000Z');
  const approximateAt = new Date('2026-08-14T19:47:33.000Z');
  const report = inspectDeviceLocation({
    online: true,
    lastHeartbeatAt: approximateAt,
    accuracySource: 'wifi',
    location: {
      lat: -20.028,
      lng: 57.596,
      source: 'wifi',
      gpsValid: false,
      accuracyMeters: 308.701,
      recordedAt: approximateAt,
    },
    lastLocationObservation: {
      lat: -20.028,
      lng: 57.596,
      source: 'wifi',
      gpsValid: false,
      accuracyMeters: 308.701,
      recordedAt: approximateAt,
    },
    lastSatelliteLocation: {
      lat: -20.029278,
      lng: 57.5960427,
      source: 'gps',
      gpsValid: true,
      accuracyMeters: null,
      recordedAt: satelliteAt,
    },
  });

  assert.equal(report.ok, true);
  assert.equal(report.latestObservation.source, 'wifi');
  assert.equal(report.latestObservation.accuracyMeters, 308.701);
  assert.equal(report.lastSatelliteLocation.source, 'gps');
  assert.equal(report.lastSatelliteLocation.accuracyMeters, null);
  assert.equal(report.displaySelection.retainedSatellite, true);
  assert.match(report.precisionVerdict, /Metre-level precision is not proven/);
});

test('inspection flags legacy accuracy leakage on a GPS observation', () => {
  const report = inspectDeviceLocation({
    accuracySource: 'gps',
    location: {
      lat: -20.029278,
      lng: 57.5960427,
      source: 'gps',
      gpsValid: true,
      accuracyMeters: 308.701,
      recordedAt: new Date('2026-08-14T19:42:33.000Z'),
    },
  });

  assert.equal(report.ok, false);
  assert.equal(report.issues.length, 1);
  assert.match(report.issues[0], /inherited an accuracy radius/);
});
