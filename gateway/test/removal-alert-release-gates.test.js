'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('removal alert release gates default fully off', () => {
  const configPath = path.join(__dirname, '..', 'src', 'config');
  const script = `
    delete process.env.REMOVAL_ALERTS_INGEST_ENABLED;
    delete process.env.REMOVAL_ALERTS_CUSTOMER_ENABLED;
    delete process.env.REMOVAL_ALERTS_DEVICE_MODE;
    const config = require(${JSON.stringify(configPath)});
    process.stdout.write(JSON.stringify({
      ingest: config.removalAlertsIngestEnabled,
      customer: config.removalAlertsCustomerEnabled,
      mode: config.removalAlertsDeviceMode,
    }));
  `;
  const output = execFileSync(process.execPath, ['-e', script], {
    cwd: os.tmpdir(),
    env: { ...process.env },
    encoding: 'utf8',
  });
  assert.deepEqual(JSON.parse(output), {
    ingest: false,
    customer: false,
    mode: 'unverified',
  });
});
