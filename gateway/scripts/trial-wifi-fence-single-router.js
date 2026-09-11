'use strict';

const { preview } = require('../src/wifi-fence-single-router-trial');
const { normalizeRouterId, fingerprintRouter } = require('../src/wifi-home-observer');

async function runTrial({ args, request, readRouter, config, emit = () => {} }) {
  if (args.length === 0 || (args.length === 1 && args[0] === '--preview')) return preview();
  if (args.length !== 1 || args[0] !== '--send') throw new Error('invalid_arguments');
  const before = await request({ method: 'GET', endpoint: 'validation' });
  if (before?.version !== 1 || before.singleRouterTrial?.supported !== true) {
    throw new Error('updated_gateway_required');
  }
  if (before.configured !== true || before.sessionConnected !== true) throw new Error('pilot_not_connected');
  if (before.singleRouterTrial.attempted) throw new Error('trial_already_attempted');
  if (before.capture?.phase === 'recording') throw new Error('capture_already_running');
  const routerId = normalizeRouterId(await readRouter());
  if (!routerId || fingerprintRouter({ imei: config.wifiHomePilotImei, routerId,
    hashKey: config.wifiHomeHashKey }) !== config.wifiHomeRouterHash.toLowerCase()) {
    throw new Error('router_does_not_match_enrollment');
  }
  // Capture control and the hardware POST are each attempted once. Neither a
  // timeout nor a non-2xx response triggers another setting or fallback command.
  const started = await request({ method: 'POST', endpoint: 'validation', action: 'start' });
  if (started?.capture?.phase !== 'recording' || !started.capture.captureId) {
    throw new Error('capture_not_started');
  }
  emit({ captureStarted: true, captureId: started.capture.captureId });
  return request({ method: 'POST', endpoint: 'trial', body: { experimental: true,
    captureId: started.capture.captureId, routerId } });
}

async function privateRouterInput() {
  const readline = require('node:readline');
  const { Writable } = require('node:stream');
  const sink = new Writable({ write(_chunk, _encoding, done) { done(); } });
  const input = readline.createInterface({ input: process.stdin, output: sink,
    terminal: Boolean(process.stdin.isTTY && process.stdout.isTTY), historySize: 0,
    crlfDelay: Infinity });
  const lines = input[Symbol.asyncIterator]();
  input.once('SIGINT', () => input.close());
  process.stdout.write('Enrolled Home router 2.4 GHz BSSID (input hidden): ');
  try {
    const line = await lines.next();
    if (line.done) throw new Error('input_cancelled');
    return line.value.trim();
  } finally {
    input.close();
    process.stdout.write('\n');
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || (args.length === 1 && args[0] === '--preview')) {
    console.log(JSON.stringify(preview(), null, 2));
    console.log('Preview only. --send attempts an inferred one-router setting on the private pilot.');
    return;
  }
  if (args.length !== 1 || args[0] !== '--send') throw new Error('invalid_arguments');
  process.chdir(require('node:path').join(__dirname, '..'));
  const config = require('../src/config');
  if (!config.adminApiKey || config.wifiHomeObserveEnabled !== true ||
      !/^\d{15}$/.test(config.wifiHomePilotImei || '') ||
      !/^[0-9a-f]{64}$/i.test(config.wifiHomeRouterHash || '') ||
      !/^[0-9a-f]{64}$/i.test(config.wifiHomeHashKey || '') ||
      !Number.isInteger(config.httpPort) || config.httpPort < 1 || config.httpPort > 65535) {
    throw new Error('local_configuration_missing');
  }
  console.log('Experimental one-router setting: it may persist or replace fence settings. No proven undo command is available.');
  console.log('Real fence alarms may follow the existing alert/notification path. One send attempt; no CR, UPLOAD, retries or automatic rollback.');
  const request = async ({ method, endpoint, action, body }) => {
    const path = endpoint === 'trial' ? '/ops/wifi-fence-single-router-trial' : '/ops/wifi-fence-validation';
    const url = new URL(`http://127.0.0.1:${config.httpPort}${path}`);
    url.searchParams.set('imei', config.wifiHomePilotImei);
    if (action) url.searchParams.set('action', action);
    const response = await fetch(url, { method, redirect: 'error',
      headers: { 'X-Admin-Key': config.adminApiKey, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(8000) });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('gateway_request_rejected_or_uncertain');
    }
    return response.json();
  };
  const result = await runTrial({ args, request, config, readRouter: privateRouterInput,
    emit: value => console.log(JSON.stringify(value, null, 2)) });
  // Whitelist output even if an old/misconfigured local endpoint returns a frame.
  console.log(JSON.stringify({ experimental: true, attempted: result.attempted === true,
    phase: ['queued', 'handoff_unknown'].includes(result.phase) ? result.phase : 'unconfirmed',
    captureRecorded: result.captureRecorded === true, settingsApplied: null,
    nativeFenceAccepted: false, rollbackKnown: false }, null, 2));
  console.log('Capture continues for 30 minutes. Run npm run wifi-home:fence -- --report to check the response and later behaviour.');
  console.log('Do not repeat --send after an uncertain result or restart to retry. Stopping capture does not remove a watch setting.');
  if (result.phase !== 'queued') process.exitCode = 1;
}

if (require.main === module) {
  main().catch(error => {
    const known = new Set(['invalid_arguments', 'updated_gateway_required', 'pilot_not_connected',
      'trial_already_attempted', 'capture_already_running', 'router_does_not_match_enrollment',
      'capture_not_started', 'input_cancelled', 'local_configuration_missing',
      'gateway_request_rejected_or_uncertain']);
    console.error(known.has(error.message) ? error.message : 'trial_check_failed');
    console.error('No automatic retry. If a send was attempted, use wifi-home:fence -- --report; delivery may be unknown.');
    process.exitCode = 1;
  });
}

module.exports = { runTrial };
