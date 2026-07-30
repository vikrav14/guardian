const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateLocationResponse,
  validateBatteryResponse,
} = require('../src/response-validator');

test('validateLocationResponse: valid response', () => {
  const response =
    "Mum is near Quatre Bornes. Her last GPS location was -20.2733, 57.4924 about 2 minutes ago.";
  const toolResult = {
    lat: -20.2733,
    lng: 57.4924,
    accuracySource: 'gps',
    online: true,
  };

  const result = validateLocationResponse(response, toolResult);
  assert.ok(result.valid);
  assert.equal(result.issues.length, 0);
});

test('validateLocationResponse: detects invented coordinates', () => {
  const response = 'Mum is at -21.5555, 58.7777.'; // Invented coords
  const toolResult = {
    lat: -20.2733,
    lng: 57.4924,
    accuracySource: 'gps',
    online: true,
  };

  const result = validateLocationResponse(response, toolResult);
  assert.ok(!result.valid);
  assert.ok(result.issues.includes('INVENTED_COORDINATES'));
});

test('validateLocationResponse: detects coordinates without location data', () => {
  const response = 'Location: -20.1234, 57.5678'; // Coords but tool had no data
  const toolResult = {
    lat: null,
    lng: null,
    online: false,
  };

  const result = validateLocationResponse(response, toolResult);
  assert.ok(!result.valid);
  assert.ok(result.issues.includes('COORDINATES_WITHOUT_LOCATION'));
});

test('validateLocationResponse: detects mismatched source label', () => {
  const response = 'Mum is at her exact GPS location -20.2733, 57.4924.';
  const toolResult = {
    lat: -20.2733,
    lng: 57.4924,
    accuracySource: 'wifi', // WiFi, not GPS
    online: true,
  };

  const result = validateLocationResponse(response, toolResult);
  assert.ok(!result.valid);
  assert.ok(result.issues.includes('MISMATCHED_SOURCE_LABEL'));
});

test('validateLocationResponse: detects exposed IMEI', () => {
  const response = 'Device 861397053141170 is offline.'; // V28C IMEI format
  const toolResult = { lat: null, lng: null };

  const result = validateLocationResponse(response, toolResult);
  assert.ok(!result.valid);
  assert.ok(result.issues.includes('EXPOSED_IMEI'));
});

test('validateLocationResponse: detects offline not stated', () => {
  const response = 'Mum was last at -20.2733, 57.4924.';
  const toolResult = {
    lat: -20.2733,
    lng: 57.4924,
    online: false, // Offline!
    accuracySource: 'gps',
  };

  const result = validateLocationResponse(response, toolResult);
  assert.ok(!result.valid);
  assert.ok(result.issues.includes('OFFLINE_NOT_STATED'));
});

test('validateLocationResponse: allows offline when stated', () => {
  const response = 'Mum is offline. Last seen at -20.2733, 57.4924 2 hours ago.';
  const toolResult = {
    lat: -20.2733,
    lng: 57.4924,
    online: false,
    stalenessSeconds: 7200,
  };

  const result = validateLocationResponse(response, toolResult);
  assert.ok(result.valid);
});

test('validateBatteryResponse: valid', () => {
  const response = 'Battery at 45%';
  const toolResult = { batteryPercent: 45 };

  const result = validateBatteryResponse(response, toolResult);
  assert.ok(result.valid);
});

test('validateBatteryResponse: detects invented battery %', () => {
  const response = 'Battery at 95%';
  const toolResult = { batteryPercent: 45 }; // Actual is 45

  const result = validateBatteryResponse(response, toolResult);
  assert.ok(!result.valid);
  assert.ok(result.issues.includes('INVENTED_BATTERY'));
});

test('validateBatteryResponse: allows small variance (±5%)', () => {
  const response = 'Battery at 48%';
  const toolResult = { batteryPercent: 45 }; // Within ±5

  const result = validateBatteryResponse(response, toolResult);
  assert.ok(result.valid);
});

test('validateBatteryResponse: detects battery without data', () => {
  const response = 'Battery is 50%.';
  const toolResult = { batteryPercent: null }; // No data

  const result = validateBatteryResponse(response, toolResult);
  assert.ok(!result.valid);
  assert.ok(result.issues.includes('BATTERY_WITHOUT_DATA'));
});

test('validateLocationResponse: health claims disallowed', () => {
  const response = 'Mum is online. Her heart rate is elevated.';
  const toolResult = { online: true };
  const constraints = { medicalClaimsAllowed: false };

  const result = validateLocationResponse(response, toolResult, constraints);
  assert.ok(!result.valid);
  assert.ok(result.issues.includes('HEALTH_CLAIM_NOT_ALLOWED'));
});

test('validateLocationResponse: long response flagged', () => {
  const response = 'a'.repeat(1100); // Too long
  const result = validateLocationResponse(response, {});

  assert.ok(!result.valid);
  assert.ok(result.issues.includes('RESPONSE_TOO_LONG'));
});
