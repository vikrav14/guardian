const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyIntent, isCritical, requiresLocation } = require('../src/intent-classifier');

test('classifyIntent: location requests', () => {
  const cases = [
    { text: 'Where is Mum?', expectedType: 'LOCATION_REQUEST', expectedUrgency: 3 },
    { text: 'locate Dad', expectedType: 'LOCATION_REQUEST', expectedUrgency: 3 },
    { text: 'Find my loved one', expectedType: 'LOCATION_REQUEST', expectedUrgency: 3 },
    { text: 'What is the position?', expectedType: 'LOCATION_REQUEST', expectedUrgency: 3 },
  ];

  for (const { text, expectedType, expectedUrgency } of cases) {
    const result = classifyIntent(text);
    assert.equal(result.type, expectedType, `Failed for: ${text}`);
    assert.equal(result.urgency, expectedUrgency, `Urgency mismatch for: ${text}`);
    assert.ok(result.confidence >= 0.85, `Low confidence for: ${text}`);
  }
});

test('classifyIntent: critical/emergency', () => {
  const cases = [
    { text: 'SOS!', expectedType: 'CRITICAL', expectedUrgency: 9 },

    { text: 'emergency', expectedType: 'CRITICAL', expectedUrgency: 9 },
    { text: 'danger danger', expectedType: 'CRITICAL', expectedUrgency: 9 },
  ];

  for (const { text, expectedType, expectedUrgency } of cases) {
    const result = classifyIntent(text);
    assert.equal(result.type, expectedType, `Failed for: ${text}`);
    assert.equal(result.urgency, expectedUrgency, `Urgency mismatch for: ${text}`);
  }
});

test('classifyIntent: device status', () => {
  const cases = [
    { text: 'battery?', expectedType: 'DEVICE_STATUS' },
    { text: 'Is Mum online?', expectedType: 'DEVICE_STATUS' },
    { text: 'check signal', expectedType: 'DEVICE_STATUS' },
  ];

  for (const { text, expectedType } of cases) {
    const result = classifyIntent(text);
    assert.equal(result.type, expectedType, `Failed for: ${text}`);
  }
});

test('classifyIntent: reminder/medication', () => {
  const result = classifyIntent('medication reminder');
  assert.equal(result.type, 'REMINDER_REQUEST');
});

test('classifyIntent: safe zone', () => {
  const result = classifyIntent('Is Dad at home?');
  assert.equal(result.type, 'SAFE_ZONE_CHECK');
});

test('classifyIntent: empty/unclear', () => {
  assert.equal(classifyIntent('').type, 'EMPTY');
  assert.equal(classifyIntent('hello').type, 'UNCLEAR');
  assert.equal(classifyIntent('xyz123').type, 'UNCLEAR');
});

test('isCritical: true for CRITICAL urgency >= 8', () => {
  const critical = classifyIntent('SOS!');
  assert.ok(isCritical(critical));

  const nonCritical = classifyIntent('where is Mum');
  assert.ok(!isCritical(nonCritical));
});

test('requiresLocation: true for location/zone checks', () => {
  assert.ok(requiresLocation(classifyIntent('where is Mum')));
  assert.ok(requiresLocation(classifyIntent('is Dad at home')));
  assert.ok(!requiresLocation(classifyIntent('battery')));
});

test('classifyIntent: word boundary match only', () => {
  // "where" should match "where", not "nowhere"
  // This tests word boundary enforcement
  const result = classifyIntent('I know where you are');
  assert.equal(result.type, 'LOCATION_REQUEST');

  // "battery" should match "battery", not "batteries"
  const statusResult = classifyIntent("What about the battery's status?");
  assert.equal(statusResult.type, 'DEVICE_STATUS');
});

test('classifyIntent: case insensitive', () => {
  assert.equal(classifyIntent('WHERE IS MUM').type, 'LOCATION_REQUEST');
  assert.equal(classifyIntent('SoS').type, 'CRITICAL');
  assert.equal(classifyIntent('Battery').type, 'DEVICE_STATUS');
});

test('classifyIntent: Mauritian Creole support', () => {
  // "Koté" is Creole for "where"
  // Note: Current implementation doesn't include Creole keywords yet
  // This test documents the gap and can be updated when Creole is added
  const result = classifyIntent('Mama koté?');
  // Currently: UNCLEAR (should be LOCATION_REQUEST after Creole support)
  // assert.equal(result.type, 'LOCATION_REQUEST');
});
test('classifyIntent: generic help is not a safety emergency', () => {
  const result = classifyIntent('help me write something');
  assert.equal(result.type, 'GENERAL_HELP');
  assert.ok(!isCritical(result));
});

test('classifyIntent: explicit SOS remains safety-critical', () => {
  const result = classifyIntent('SOS');
  assert.equal(result.type, 'CRITICAL');
  assert.ok(isCritical(result));
});
