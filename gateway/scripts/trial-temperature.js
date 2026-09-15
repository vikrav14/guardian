'use strict';

const POLL_MS = 2000;
const CAPTURE_MS = 120_000;

function parseArguments(args) {
  const allowed = new Set(['--once', '--worn', '--include-values', '--uppercase']);
  if (!Array.isArray(args) || args.some(arg => !allowed.has(arg)) || new Set(args).size !== args.length ||
      args.includes('--once') !== args.includes('--worn') ||
      (args.includes('--uppercase') && !args.includes('--once'))) {
    throw new Error('Use no arguments (read only), --include-values, or --once --worn with optional --include-values and --uppercase.');
  }
  return { once: args.includes('--once'), includeValues: args.includes('--include-values'),
    ...(args.includes('--uppercase') ? { commandCase: 'uppercase' } : {}) };
}

function terminal(trial) {
  return trial?.outcome === 'upload_observed_after_request' ||
    ['capture_timeout', 'session_changed', 'not_sent'].includes(trial?.phase);
}

async function runTrial({ args, config, fetchImpl = fetch, print = console.log,
  now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const operation = parseArguments(args);
  if (typeof config.adminApiKey !== 'string' || !config.adminApiKey.trim()) {
    throw new Error('ADMIN_API_KEY is required.');
  }
  const port = Number(config.httpPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('A valid gateway HTTP port is required.');
  const endpoint = `http://127.0.0.1:${port}/admin/temperature-trial`;
  const statusUrl = `${endpoint}${operation.includeValues ? '?includeValues=1' : ''}`;
  const headers = { 'X-Admin-Key': config.adminApiKey };
  const emit = result => print(JSON.stringify(result, null, 2));
  const retrieval = `npm run temperature:trial${operation.includeValues ? ' -- --include-values' : ''}`;
  async function readStatus(timeout = 5000) {
    try {
      const response = await fetchImpl(statusUrl, { method: 'GET', headers,
        signal: AbortSignal.timeout(timeout) });
      if (!response.ok) return null;
      const status = await response.json();
      return status && typeof status === 'object' && !Array.isArray(status) ? status : null;
    } catch { return null; }
  }
  const before = await readStatus();
  if (!before) throw new Error('Gateway trial status unavailable; no measurement command sent.');
  if (!operation.once) {
    emit({ outcome: 'read_only', connected: before.connected === true, trial: before.trial || null });
    return 0;
  }
  if (before.connected !== true) throw new Error('One connected pilot watch session is required; nothing sent.');

  print('Supervised temperature test: wear the watch and do not press its temperature button during the two-minute capture. The gateway will send one measurement request.');
  print(operation.commandCase === 'uppercase'
    ? 'Selected command: BODYTEMP2. This is an explicit uppercase comparison; there is no automatic fallback to another command.'
    : 'Selected command: bodytemp2, the lowercase variant in the supplied protocol.');
  print(operation.includeValues
    ? 'Reading values will be included in this diagnostic output.'
    : 'This output shows capture metadata only. Use --include-values on a read-only check to inspect captured values.');
  let response, result;
  try {
    response = await fetchImpl(endpoint, { method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'single', operatorPosition: 'worn',
        ...(operation.commandCase ? { commandCase: operation.commandCase } : {}) }),
      signal: AbortSignal.timeout(5000) });
    result = await response.json();
  } catch {
    emit({ outcome: 'handoff_unknown', readingConfirmed: false, wearingConfirmed: false,
      instruction: `The watch may have received the request. Do not repeat --once. Retrieve capture status with: ${retrieval}` });
    return 1;
  }
  if (!response.ok || result?.outcome !== 'command_handed_off') {
    const outcome = ['handoff_unknown', 'not_sent'].includes(result?.outcome)
      ? result.outcome : 'command_not_confirmed';
    let error = typeof result?.error === 'string' ? result.error : '';
    for (const secret of [config.adminApiKey, config.wifiHomePilotImei]) {
      if (typeof secret === 'string' && secret) error = error.split(secret).join('[redacted]');
    }
    error = error.replace(/\b\d{15}\b/g, '[redacted]').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 240);
    emit({ outcome, httpStatus: response.status || null, ...(error ? { error } : {}),
      readingConfirmed: false, wearingConfirmed: false,
      instruction: outcome === 'handoff_unknown'
        ? `The watch may have received the request. Do not repeat --once. Retrieve capture status with: ${retrieval}`
        : `No automatic retry was made. Inspect gateway logs and read status with: ${retrieval}` });
    return 1;
  }
  if (typeof result.trialId !== 'string' || !result.trialId || result.trialId.length > 128) {
    emit({ outcome: 'capture_unavailable', readingConfirmed: false, wearingConfirmed: false,
      instruction: `The request was handed off, but its capture identifier was unavailable. Do not repeat --once. Read status with: ${retrieval}` });
    return 1;
  }
  const trialId = result.trialId;
  emit({ outcome: 'command_handed_off', trialId, requestedAt: result.requestedAt || null,
    ...(['bodytemp2', 'BODYTEMP2'].includes(result.command) ? { command: result.command } : {}),
    readingConfirmed: false, wearingConfirmed: false });
  const deadline = now() + CAPTURE_MS;
  let latest = null;
  // All calls after the one POST are reads. Correlate by trialId, never a
  // previous capture or a reply-only status. A bounded loop also covers clocks
  // that fail to advance; injected clocks/sleeps keep the tests deterministic.
  for (let checks = 0; checks < CAPTURE_MS / POLL_MS && now() < deadline; checks++) {
    await sleep(Math.min(POLL_MS, deadline - now()));
    const remaining = deadline - now();
    if (remaining <= 0) break;
    const status = await readStatus(Math.min(5000, Math.max(1, Math.ceil(remaining))));
    if (!status) {
      emit({ outcome: 'capture_unavailable', trialId, readingConfirmed: false, wearingConfirmed: false,
        instruction: `The request was already handed off. Do not repeat --once. Read capture status with: ${retrieval}` });
      return 1;
    }
    if (status.trial?.trialId !== trialId) continue;
    latest = status;
    if (terminal(status.trial)) {
      emit({ outcome: status.trial.outcome, connected: status.connected === true, trial: status.trial,
        readingConfirmed: false, wearingConfirmed: false });
      return status.trial.outcome === 'upload_observed_after_request' ? 0 : 1;
    }
  }
  emit({ outcome: 'capture_timeout', trialId,
    ...(latest ? { connected: latest.connected === true, trial: latest.trial } : {}),
    readingConfirmed: false, wearingConfirmed: false,
    instruction: `The two-minute wait ended without an observed matching upload. Read the final capture with: ${retrieval}` });
  return 1;
}

if (require.main === module) runTrial({ args: process.argv.slice(2), config: require('../src/config') })
  .then(code => { process.exitCode = code; })
  .catch(error => { console.error(`ERROR: ${error.message}`); process.exitCode = 1; });

module.exports = { parseArguments, runTrial };
