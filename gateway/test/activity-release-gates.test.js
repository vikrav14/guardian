'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('activity release gates default to fully disabled', () => {
  const script = `
    delete process.env.ACTIVITY_STEPS_INGEST_ENABLED;
    delete process.env.ACTIVITY_STEPS_CUSTOMER_ENABLED;
    delete process.env.ACTIVITY_STEPS_COUNTER_MODE;
    const config = require('./src/config');
    process.stdout.write(JSON.stringify({
      ingest: config.activityStepsIngestEnabled,
      customer: config.activityStepsCustomerEnabled,
      mode: config.activityStepsCounterMode,
    }));
  `;
  const output = execFileSync(process.execPath, ['-e', script], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env },
    encoding: 'utf8',
  });
  assert.deepEqual(JSON.parse(output), {
    ingest: false,
    customer: false,
    mode: 'unverified',
  });
});
