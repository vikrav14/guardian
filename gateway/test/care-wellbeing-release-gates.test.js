'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

function read(relative) {
  return fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
}

test('Care wellbeing customer, ingestion and request gates default off', () => {
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

test('Flutter customer panel also defaults off independently', () => {
  const dashboard = fs.readFileSync(
    path.join(__dirname, '..', '..', 'apps', 'mobile', 'lib', 'screens', 'map_dashboard_page.dart'),
    'utf8',
  );
  assert.match(dashboard, /GUARDIAN_CARE_WELLBEING_ENABLED/);
  assert.match(dashboard, /defaultValue: false/);
});

test('temperature remains private and unsupported upload shapes remain blocked', () => {
  const contract = read('src/service-backbones/care-wellbeing.js');
  const { normalizeWellbeingEvent } = require('../src/care-wellbeing');
  assert.equal(normalizeWellbeingEvent({ type: 'health_reading', imei: '861000000000001',
    metric: 'temperature', value: 34.56 }).reason, 'unsupported_metric');
  assert.match(contract, /blockedUntilCaptured/);
  assert.match(contract, /bodytemp2/);
});
