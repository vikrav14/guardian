#!/usr/bin/env node

/**
 * Provision one manufacturer-documented V52 PHBX incoming-call allowlist
 * entry through the running local Guardian gateway.
 *
 * The watch must have an active TCP session. The script deliberately uses the
 * authenticated, purpose-specific local admin endpoint so it never needs
 * Firebase credentials, never exposes PHBX through the generic command
 * channel, and never places real contact data in source control.
 *
 * Usage:
 *   node scripts/send-phonebook-contact.js --imei <10-or-15-digits> \
 *     --slot 1 --name "Test" --phone "+230..."
 */
const http = require('http');
const config = require('../src/config');

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--') || !argv[index + 1]) continue;
    result[key.slice(2)] = argv[index + 1];
    index += 1;
  }
  return result;
}

function redactPhone(value) {
  const phone = String(value || '');
  return phone.length <= 4 ? '***' : `***${phone.slice(-4)}`;
}

function usageError(message) {
  console.error(message);
  console.error(
    'Usage: node scripts/send-phonebook-contact.js --imei <10-or-15-digits> --slot 1 --name "Test" --phone "+230..."'
  );
  process.exit(2);
}

const args = parseArgs(process.argv.slice(2));
const imei = String(args.imei || '').trim();
if (!/^\d{10}(?:\d{5})?$/.test(imei)) {
  usageError('IMEI must be the watch\'s 10-digit protocol ID or 15-digit hardware IMEI.');
}
if (!config.adminApiKey) {
  usageError('ADMIN_API_KEY is not configured in gateway/.env. Configure it and restart the gateway first.');
}

const requestBody = JSON.stringify({
  imei,
  slot: args.slot,
  name: args.name,
  phone: args.phone,
});
const request = http.request(
  {
    hostname: '127.0.0.1',
    port: config.httpPort,
    path: '/admin/device-phonebook/contact',
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
        console.error(`Phonebook send failed (HTTP ${response.statusCode}).`);
        console.error(payload.error || 'The watch may not have an active TCP session.');
        process.exit(1);
      }

      console.log('V52 incoming-call allowlist entry handed to the live watch session.');
      console.log(`Slot: ${args.slot}`);
      console.log(`Name: ${String(args.name || '').trim()}`);
      console.log(`Phone: ${redactPhone(args.phone)}`);
      console.log(`Protocol ID: ${payload.protocolId}`);
      console.log(`Active sessions: ${payload.sessions}`);
      if (payload.auditRecorded !== true) {
        console.warn('Warning: socket handoff succeeded, but the local audit record was unavailable. Do not retry blindly.');
      }
      console.log('Physical acceptance is still required:');
      console.log('1. Confirm the contact appears, then reboot and confirm it persists.');
      console.log('2. Confirm the approved number rings the watch and both sides can speak.');
      console.log('3. Confirm an unknown number is blocked.');
      console.log('The wearer cannot place outbound calls with Guardian\'s current SIM package.');
    });
  }
);

request.on('error', (error) => {
  console.error(`Could not reach the local Guardian HTTP gateway: ${error.message}`);
  console.error(`Confirm npm start is running and HTTP port ${config.httpPort} is listening.`);
  process.exit(1);
});

request.setTimeout(10_000, () => {
  request.destroy(new Error('Guardian phonebook provisioning request timed out after 10 seconds'));
});

request.end(requestBody);
