'use strict';

const { MARKERS, commandPreview } = require('../src/wifi-fence-validation');

function parseArguments(args) {
  if (args.length === 0) return { action: 'status' };
  if (args.length !== 1) throw new Error('invalid_arguments');
  if (['--start', '--stop', '--report', '--preview'].includes(args[0])) {
    return { action: args[0].slice(2) };
  }
  const marker = args[0].startsWith('--mark=') ? args[0].slice(7) : null;
  if (MARKERS.includes(marker)) return { action: 'mark', marker };
  throw new Error('invalid_arguments');
}

async function inspectWifiFence({ args, request }) {
  const { action, marker } = parseArguments(args);
  if (action === 'preview') return commandPreview();
  const status = await request({ method: 'GET', timeline: action === 'report' });
  if (status?.version !== 1) throw new Error('unsupported_gateway');
  if (['status', 'report'].includes(action)) return status;
  if (status.configured !== true) throw new Error('private_observer_not_configured');
  if (action === 'start' && status.capture?.phase === 'recording') {
    throw new Error('capture_already_running');
  }
  if (action !== 'start' && !status.capture?.captureId) throw new Error('capture_not_started');
  // One attempt only. A timeout after POST is not an excuse to repeat an action.
  return request({ method: 'POST', action, marker,
    captureId: action === 'start' ? undefined : status.capture.captureId });
}

async function main() {
  const args = process.argv.slice(2);
  const parsed = parseArguments(args);
  if (parsed.action === 'preview') {
    console.log(JSON.stringify(commandPreview(), null, 2));
    return;
  }
  // Always resolve the private configuration from gateway, even when the
  // operator launches this script from the repository root in PowerShell.
  process.chdir(require('node:path').join(__dirname, '..'));
  const config = require('../src/config');
  if (!config.adminApiKey || !/^\d{15}$/.test(config.wifiHomePilotImei || '') ||
      !Number.isInteger(config.httpPort) || config.httpPort < 1 || config.httpPort > 65535) {
    throw new Error('local_configuration_missing');
  }
  const request = async ({ method, action, marker, captureId, timeline }) => {
    const url = new URL(`http://127.0.0.1:${config.httpPort}/ops/wifi-fence-validation`);
    url.searchParams.set('imei', config.wifiHomePilotImei);
    if (action) url.searchParams.set('action', action);
    if (marker) url.searchParams.set('marker', marker);
    if (captureId) url.searchParams.set('capture', captureId);
    if (timeline) url.searchParams.set('timeline', '1');
    const response = await fetch(url, { method, redirect: 'error',
      headers: { 'X-Admin-Key': config.adminApiKey }, signal: AbortSignal.timeout(8000) });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('gateway_request_rejected');
    }
    return response.json();
  };
  const result = await inspectWifiFence({ args, request });
  console.log(JSON.stringify(result, null, 2));
  if (parsed.action === 'start') {
    console.log('Observation started for 30 minutes. Keep the gateway running. No watch command was sent.');
    console.log('Later run npm run wifi-home:fence -- --report to collect the redacted timeline.');
  }
}

if (require.main === module) {
  main().catch(error => {
    const known = new Set(['invalid_arguments', 'unsupported_gateway', 'private_observer_not_configured',
      'capture_already_running', 'capture_not_started', 'local_configuration_missing', 'gateway_request_rejected']);
    console.error(known.has(error.message) ? error.message : 'capture_check_failed');
    console.error('Check the gateway connection and private admin configuration. Read status before retrying an operation.');
    process.exitCode = 1;
  });
}

module.exports = { parseArguments, inspectWifiFence };
