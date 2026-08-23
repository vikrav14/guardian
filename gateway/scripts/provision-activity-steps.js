#!/usr/bin/env node

/**
 * Explicitly enable or disable the V52 pedometer through the authenticated,
 * purpose-specific local Guardian gateway endpoint.
 *
 * Usage:
 *   node scripts/provision-activity-steps.js --imei <10-or-15-digits> --enable
 *   node scripts/provision-activity-steps.js --imei <10-or-15-digits> --disable
 */
const http = require('http');
const config = require('../src/config');

function valueAfter(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function usageError(message) {
  console.error(message);
  console.error(
    'Usage: node scripts/provision-activity-steps.js --imei <10-or-15-digits> (--enable | --disable)'
  );
  process.exit(2);
}

const argv = process.argv.slice(2);
const imei = String(valueAfter(argv, '--imei') || '').trim();
const enableRequested = argv.includes('--enable');
const disableRequested = argv.includes('--disable');

if (!/^\d{10}(?:\d{5})?$/.test(imei)) {
  usageError('IMEI must be the watch\'s 10-digit protocol ID or 15-digit hardware IMEI.');
}
if (enableRequested === disableRequested) {
  usageError('Choose exactly one of --enable or --disable.');
}
if (!config.adminApiKey) {
  usageError('ADMIN_API_KEY is not configured in gateway/.env. Configure it and restart the gateway first.');
}

const enabled = enableRequested;
const requestBody = JSON.stringify({ imei, enabled });
const request = http.request(
  {
    hostname: '127.0.0.1',
    port: config.httpPort,
    path: '/admin/device-activity-steps/pedometer',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(requestBody),
      'X-Admin-Key': config.adminApiKey,
    },
  },
  (response) => {
    let body = '';
    response.on('data', (chunk) => {
      body += chunk;
    });
    response.on('end', () => {
      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        payload = { error: body || 'empty response' };
      }

      if (response.statusCode !== 200 || payload.ok !== true) {
        console.error(`Pedometer provisioning failed (HTTP ${response.statusCode}).`);
        console.error(payload.error || 'The watch may not have an active TCP session.');
        if (payload.partialConfigurationPossible) {
          console.error('A partial socket handoff occurred. Inspect the watch before retrying.');
        }
        process.exit(1);
      }

      console.log(`V52 pedometer ${enabled ? 'enable' : 'disable'} request handed to the live watch session.`);
      console.log(`Protocol ID: ${payload.protocolId}`);
      console.log(`Commands handed off: ${payload.commandsHandedOff}/${payload.commandsRequired}`);
      console.log(`Active sessions: ${payload.sessions}`);
      if (payload.auditRecorded !== true) {
        console.warn('Warning: socket handoff succeeded, but the local audit record was unavailable. Do not retry blindly.');
      }
      console.log('Socket handoff is not physical acceptance. Inspect the Steps screen and verify passive telemetry.');
    });
  }
);

request.on('error', (error) => {
  console.error(`Could not reach the local Guardian HTTP gateway: ${error.message}`);
  console.error(`Confirm npm start is running and HTTP port ${config.httpPort} is listening.`);
  process.exit(1);
});

request.setTimeout(10_000, () => {
  request.destroy(new Error('Guardian pedometer provisioning request timed out after 10 seconds'));
});

request.end(requestBody);
