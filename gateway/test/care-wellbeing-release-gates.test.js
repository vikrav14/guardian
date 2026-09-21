'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

function read(relative) {
  return fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
}

test('Care wellbeing operational switches remain independently fail-closed', () => {
  const config = read('src/config.js');
  for (const name of [
    'CARE_WELLBEING_INGEST_ENABLED',
    'CARE_WELLBEING_CUSTOMER_ENABLED',
    'CARE_WELLBEING_REQUEST_ENABLED',
  ]) {
    assert.match(config, new RegExp(`${name} \\|\\| 'false'`));
  }
  assert.match(config, /CARE_WELLBEING_DEVICE_MODE \|\| 'unverified'/);
});

test('Flutter Wellness is entitlement-driven and has no pilot visibility flag', () => {
  const dashboard = fs.readFileSync(
    path.join(__dirname, '..', '..', 'apps', 'mobile', 'lib', 'screens', 'map_dashboard_page.dart'),
    'utf8',
  );
  assert.doesNotMatch(dashboard, /GUARDIAN_CARE_WELLBEING_ENABLED|GUARDIAN_WELLNESS_PILOT/);
  assert.match(dashboard, /GuardianFeature\.activitySteps/);
  assert.match(dashboard, /GuardianFeature\.wellnessReadings/);
});

test('temperature estimate uploads are supported only for the captured shape', () => {
  const contract = read('src/service-backbones/care-wellbeing.js');
  const { normalizeWellbeingEvent } = require('../src/care-wellbeing');
  assert.equal(normalizeWellbeingEvent({ type: 'health_reading', imei: '861000000000001',
    metric: 'temperature', value: 34.56 }).reason, 'unsupported_metric');
  assert.doesNotMatch(contract, /pilotOnlyUploads: Object\.freeze\(\['btemp2'\]\)/);
  assert.match(contract, /btemp2/);
});
