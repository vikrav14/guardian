'use strict';

const { performance } = require('node:perf_hooks');

const POLL_MS = 2000;
const WAIT_MS = 250_000;

function parseArguments(args) {
  const allowed = new Set(['--once', '--worn', '--removed', '--include-values']);
  if (!Array.isArray(args) || args.some(arg => !allowed.has(arg)) ||
      new Set(args).size !== args.length ||
      args.includes('--once') !== (args.includes('--worn') || args.includes('--removed')) ||
      (args.includes('--worn') && args.includes('--removed'))) {
    throw new Error('Use no arguments (read only), --include-values, or --once with exactly one of --worn/--removed and optional --include-values.');
  }
  return { once: args.includes('--once'), includeValues: args.includes('--include-values'),
    ...(args.includes('--once') ? { operatorPosition: args.includes('--removed') ? 'removed' : 'worn' } : {}) };
}

function safeOutput(value, config, includeValues, depth = 0) {
  if (depth > 12) return null;
  if (typeof value === 'string') {
    for (const secret of [config.adminApiKey, config.wifiHomePilotImei]) {
      if (typeof secret === 'string' && secret) value = value.split(secret).join('[redacted]');
    }
    return value.replace(/\b\d{15}\b/g, '[redacted]').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 500);
  }
  if (Array.isArray(value)) return value.slice(0, 100).map(item => safeOutput(item, config, includeValues, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !/^(imei|protocolId|adminApiKey|authorization|headers|raw|frame|payload)$/i.test(key))
      .filter(([key]) => includeValues || !/^(values|value|args|rawValue|readingValues)$/i.test(key))
      .map(([key, item]) => [key, safeOutput(item, config, includeValues, depth + 1)]));
  }
  return value;
}

function snapshot(status) {
  return { connected: status.connected === true, sequence: status.sequence || null,
    ...(status.temperatureTrial ? { temperatureTrial: status.temperatureTrial } : {}),
    ...(typeof status.temperatureIngestionSuppressed === 'boolean'
      ? { temperatureIngestionSuppressed: status.temperatureIngestionSuppressed } : {}),
    ...(status.cleanupError === 'temperature_trial_quarantine_release_failed'
      ? { cleanupError: status.cleanupError } : {}) };
}

async function runSequence({ args, config, fetchImpl = fetch, print = console.log,
  now = () => performance.now(), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const operation = parseArguments(args);
  if (typeof config.adminApiKey !== 'string' || !config.adminApiKey.trim()) throw new Error('ADMIN_API_KEY is required.');
  const port = Number(config.httpPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('A valid gateway HTTP port is required.');
  const endpoint = `http://127.0.0.1:${port}/admin/wellness-sequence`;
  const statusUrl = endpoint + (operation.includeValues ? '?includeValues=1' : '');
  const headers = { 'X-Admin-Key': config.adminApiKey };
  const retrieval = `npm run wellness:sequence${operation.includeValues ? ' -- --include-values' : ''}`;
  const emit = value => print(JSON.stringify(safeOutput(value, config, operation.includeValues), null, 2));
  const recovery = `Do not repeat --once. Read the latest status with: ${retrieval}`;
  async function readStatus(timeout = 5000) {
    try {
      const response = await fetchImpl(statusUrl, { method: 'GET', headers, signal: AbortSignal.timeout(timeout) });
      if (!response.ok) return null;
      const status = await response.json();
      return status && typeof status === 'object' && !Array.isArray(status) ? status : null;
    } catch { return null; }
  }

  const before = await readStatus();
  if (!before) throw new Error(`Gateway sequence status unavailable; no measurement request sent. Check the gateway and run: ${retrieval}`);
  if (!operation.once) {
    emit({ outcome: 'read_only', ...snapshot(before) });
    return 0;
  }
  if (before.connected !== true) throw new Error(`A connected pilot watch session is required; nothing sent. Check with: ${retrieval}`);
  if (before.sequence && before.sequence.terminal !== true) {
    emit({ outcome: 'sequence_already_active', ...snapshot(before), instruction: recovery });
    return 1;
  }

  print(operation.operatorPosition === 'removed'
    ? 'Supervised sequence: leave the watch off the wrist with its sensor facing upward and uncovered.'
    : 'Supervised sequence: keep the watch fastened on your wrist.');
  print('Do not start measurements on the watch or run another measurement command during this attempt.');
  print('The gateway requests heart/BP first and sends BODYTEMP2 once only if both usable heart/BP and oxygen uploads arrive in time. It does not change native schedules.');
  print('This tests availability of readings; a successful result does not prove wearing or sensor accuracy. Allow up to about four minutes.');
  if (operation.includeValues) print('Reading values are included in this private diagnostic output.');

  let response, result;
  try {
    response = await fetchImpl(endpoint, { method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'single', operatorPosition: operation.operatorPosition }),
      signal: AbortSignal.timeout(5000) });
    result = await response.json();
  } catch {
    emit({ outcome: 'optical_handoff_unknown', readingConfirmed: false, wearingConfirmed: false,
      instruction: `The watch may have received the request. ${recovery}` });
    return 1;
  }
  if (!response.ok || result?.outcome !== 'optical_request_handed_off') {
    const outcome = ['optical_handoff_unknown', 'optical_not_sent'].includes(result?.outcome)
      ? result.outcome : 'sequence_not_confirmed';
    emit({ outcome, httpStatus: response.status || null,
      ...(typeof result?.error === 'string' ? { error: result.error } : {}),
      readingConfirmed: false, wearingConfirmed: false, instruction: recovery });
    return 1;
  }
  if (typeof result.attemptId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(result.attemptId)) {
    emit({ outcome: 'sequence_unavailable', readingConfirmed: false, wearingConfirmed: false,
      instruction: `The request was handed off, but its attempt identifier was unavailable. ${recovery}` });
    return 1;
  }
  const attemptId = result.attemptId;
  emit({ outcome: result.outcome, attemptId, requestedAt: result.requestedAt || null,
    opticalDeadlineAt: result.opticalDeadlineAt || null,
    automaticRetry: false, readingConfirmed: false, wearingConfirmed: false });
  const deadline = now() + WAIT_MS;
  let latest = null;
  // A single mutation is followed only by reads, matched to this attempt.
  // The monotonic deadline and iteration cap both bound the client wait.
  for (let checks = 0; checks < WAIT_MS / POLL_MS && now() < deadline; checks++) {
    await sleep(Math.max(0, Math.min(POLL_MS, deadline - now())));
    const remaining = deadline - now();
    if (remaining <= 0) break;
    const status = await readStatus(Math.min(5000, Math.max(1, Math.ceil(remaining))));
    if (!status) {
      emit({ outcome: 'sequence_unavailable', attemptId,
        ...(latest ? snapshot(latest) : {}), readingConfirmed: false, wearingConfirmed: false,
        instruction: `The request was already handed off. ${recovery}` });
      return 1;
    }
    if (status.sequence?.attemptId !== attemptId) continue;
    latest = status;
    if (status.sequence.terminal === true) {
      emit({ outcome: status.sequence.outcome, ...snapshot(status),
        readingConfirmed: false, wearingConfirmed: false,
        ...(status.sequence.outcome !== 'temperature_upload_observed' ? { instruction: recovery } : {}) });
      return status.sequence.outcome === 'temperature_upload_observed' ? 0 : 1;
    }
  }
  emit({ outcome: 'sequence_wait_ended', attemptId, ...(latest ? snapshot(latest) : {}),
    readingConfirmed: false, wearingConfirmed: false,
    instruction: `The bounded wait ended. This does not cancel or repeat an in-flight watch request. ${recovery}` });
  return 1;
}

if (require.main === module) runSequence({ args: process.argv.slice(2), config: require('../src/config') })
  .then(code => { process.exitCode = code; })
  .catch(error => { console.error(`ERROR: ${error.message}`); process.exitCode = 1; });

module.exports = { parseArguments, runSequence };
