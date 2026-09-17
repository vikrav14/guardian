'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getWellbeingReadings, runTool } = require('../src/assistant/tools');
const { evaluateSubscription, FEATURE, featureForWhatsAppIntent } = require('../src/entitlements');
const config = require('../src/config');
const entitlements = plan => evaluateSubscription({ version: 1, managedBy: 'guardian_admin', plan, status: 'active' });
test('Care readings do not grant other Care-only services', () => {
  for (const plan of ['essential', 'family']) {
    const ctx = entitlements(plan);
    assert.equal(ctx.features.includes(FEATURE.WELLNESS_READINGS), false);
    assert.equal(ctx.features.includes(FEATURE.WELLBEING_ACTIVITY_SUMMARIES), false);
    assert.equal(ctx.features.includes(FEATURE.MEDICATION_REMINDERS), false);
  }
  assert.equal(entitlements('care').features.includes(FEATURE.WELLNESS_READINGS), true);
  assert.equal(featureForWhatsAppIntent('WELLBEING_QUERY'), FEATURE.WHATSAPP_QA);
});
test('admin-SDK WhatsApp read checks consent before querying sensitive records', async () => {
  let reads = 0;
  const db = { collection(name) {
    assert.equal(name, 'wellbeingConsents'); reads++;
    return { doc: () => ({ get: async () => ({ exists: true, data: () => ({ status: 'revoked' }) }) }) };
  } };
  const result = await getWellbeingReadings(db, { devices: [{ imei: 'test-watch' }], entitlements: entitlements('care') }, { imei: 'test-watch' });
  assert.equal(result.code, 'consent_required');
  assert.equal(reads, 1);
});
test('Essential has no wellness WhatsApp Q&A and the customer gate protects tool execution', async () => {
  const base = { devices: [{ imei: 'test-watch' }] };
  assert.equal((await runTool(null, { ...base, entitlements: entitlements('essential') }, 'get_wellbeing_readings', {})).code, 'plan_required');
  const original = config.careWellbeingCustomerEnabled;
  try {
    config.careWellbeingCustomerEnabled = false;
    assert.equal((await runTool(null, { ...base, entitlements: entitlements('family') }, 'get_wellbeing_readings', {})).code, 'feature_disabled');
  } finally { config.careWellbeingCustomerEnabled = original; }
});
