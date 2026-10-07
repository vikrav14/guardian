#!/usr/bin/env node
'use strict';

const http = require('node:http');
const { runCareReminderTrial } = require('../src/care-reminder-trial');

function parseArgs(argv) {
  const options = {};
  const values = { '--imei': 'imei', '--action': 'action', '--time': 'time' };
  const flags = { '--send': 'send', '--confirm-replace-clocks': 'confirmReplaceClocks' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const key = values[arg] || flags[arg];
    if (!key || options[key] !== undefined) throw new Error(`Unknown or duplicate option: ${arg}`);
    if (flags[arg]) options[key] = true;
    else {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`Missing value for ${arg}`);
      options[key] = argv[++i];
    }
  }
  return options;
}

function sendToLocalGateway(imei, command) {
  // Preview never loads credentials or connects to Firestore/the gateway.
  const config = require('../src/config');
  if (!config.adminApiKey) throw new Error('ADMIN_API_KEY must be configured locally for --send');
  return new Promise((resolve, reject) => {
    const query = new URLSearchParams({ imei, command });
    const request = http.request({
      hostname: '127.0.0.1',
      port: config.httpPort,
      method: 'POST',
      path: `/dev/downlink?${query}`,
      headers: { 'X-Admin-Key': config.adminApiKey },
    }, (response) => {
      let body = '';
      response.on('data', (chunk) => { body += chunk; });
      response.on('error', reject);
      response.on('end', () => {
        if (response.statusCode !== 200) {
          reject(new Error(`Gateway HTTP ${response.statusCode}; no confirmed handoff. Check the watch before retrying.`));
          return;
        }
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error('Invalid gateway response; inspect the watch before retrying')); }
      });
    });
    request.on('error', reject);
    request.setTimeout(10000, () => request.destroy(new Error('Timed out; handoff is unknown. Inspect the watch before retrying.')));
    request.end();
  });
}

if (require.main === module) {
  Promise.resolve().then(() => runCareReminderTrial(parseArgs(process.argv.slice(2)), sendToLocalGateway))
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}

module.exports = { parseArgs };
