'use strict';

// Supplier protocol section 43: RESET restarts the watch. FACTORY is a separate
// command and is never sent here. Preview first; --send performs one handoff.
// Usage: node scripts/send-reset.js --imei <15-digit-imei> [--send]
function parseArguments(args) {
  let imei, send = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--send' && !send) send = true;
    else if (arg === '--imei' && imei === undefined) imei = args[++i];
    else if (/^(?:\d{10}|\d{15})$/.test(arg) && imei === undefined) imei = arg;
    else throw new Error('Use --imei <15-digit IMEI or 10-digit protocol ID> [--send].');
  }
  if (!/^(?:\d{10}|\d{15})$/.test(imei || '')) {
    throw new Error('An explicit 15-digit IMEI or 10-digit protocol ID is required.');
  }
  return { imei, send };
}

async function runReset({ args, config, fetchImpl = fetch, print = console.log, now = () => new Date() }) {
  const operation = parseArguments(args);
  const emit = value => print(JSON.stringify(value, null, 2));
  const common = { command: 'RESET', watchRestartVerified: false };
  if (!operation.send) {
    emit({ ...common, target: operation.imei, outcome: 'preview', commandSent: false });
    return 0;
  }
  if (typeof config.adminApiKey !== 'string' || !config.adminApiKey.trim()) {
    throw new Error('ADMIN_API_KEY is required.');
  }
  const port = Number(config.httpPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('A valid gateway HTTP port is required.');
  }
  const url = new URL(`http://127.0.0.1:${port}/dev/downlink`);
  url.searchParams.set('imei', operation.imei);
  url.searchParams.set('command', 'RESET');
  const requestedAt = now().toISOString();
  let response, result;
  try {
    response = await fetchImpl(url.toString(), { method: 'POST', redirect: 'error',
      headers: { 'X-Admin-Key': config.adminApiKey }, signal: AbortSignal.timeout(10000) });
    result = await response.json();
  } catch {
    emit({ ...common, requestedAt, outcome: 'handoff_unknown',
      note: 'No automatic retry. Inspect gateway logs and the watch; restart may already have been requested.' });
    return 1;
  }
  if (!response.ok || result?.ok !== true) {
    emit({ ...common, requestedAt, outcome: 'handoff_not_confirmed', httpStatus: response.status,
      reason: result?.error === 'no_active_session' ? 'no_active_session' : 'inspect_gateway_logs' });
    return 1;
  }
  const id = result.protocolId;
  const expected = /^\d{10}$/.test(id || '') ? `[SG*${id}*0005*RESET]` : null;
  if (!expected || result.command !== 'RESET' || result.frame !== expected || !(result.sessions > 0)) {
    emit({ ...common, requestedAt, outcome: 'frame_mismatch_after_handoff',
      note: 'Inspect gateway logs and the watch. Do not retry automatically.' });
    return 1;
  }
  emit({ ...common, requestedAt, outcome: 'socket_handoff', protocolId: id,
    sessions: result.sessions, frame: expected,
    note: 'Observe the watch restarting, then wait for reconnection and fresh telemetry. Handoff alone does not prove restart.' });
  return 0;
}

if (require.main === module) runReset({ args: process.argv.slice(2), config: require('../src/config') })
  .then(code => { process.exitCode = code; })
  .catch(error => { console.error(error.message); process.exitCode = 1; });

module.exports = { parseArguments, runReset };
