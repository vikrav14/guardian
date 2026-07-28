const test = require('node:test');
const assert = require('node:assert/strict');
const { correctFleetHemisphere } = require('../src/fleet-hemisphere');

test('correctFleetHemisphere flips a positive latitude on a genuine GPS fix', () => {
  const event = {
    accuracySource: 'gps',
    location: { lat: 20.029417, lng: 57.5959032, recordedAt: new Date() },
  };
  const corrected = correctFleetHemisphere(event);
  assert.equal(corrected.location.lat, -20.029417);
  assert.equal(corrected.location.lng, 57.5959032);
});

test('correctFleetHemisphere leaves an already-negative GPS fix untouched', () => {
  const event = {
    accuracySource: 'gps',
    location: { lat: -20.029417, lng: 57.5959032, recordedAt: new Date() },
  };
  const corrected = correctFleetHemisphere(event);
  assert.equal(corrected, event);
});

test('correctFleetHemisphere does not touch WiFi/LBS-resolved fixes', () => {
  const event = {
    accuracySource: 'wifi',
    location: { lat: 20.029417, lng: 57.5959032, recordedAt: new Date() },
  };
  const corrected = correctFleetHemisphere(event);
  assert.equal(corrected, event);
  assert.equal(corrected.location.lat, 20.029417);
});

test('correctFleetHemisphere handles missing location or event gracefully', () => {
  assert.equal(correctFleetHemisphere(null), null);
  assert.equal(correctFleetHemisphere(undefined), undefined);
  const noLocation = { accuracySource: 'gps' };
  assert.equal(correctFleetHemisphere(noLocation), noLocation);
});
