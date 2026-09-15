'use strict';

function parseArguments(args) {
  if (!args.length) return null;
  if (args.length === 1 && args[0] === '--request-temperature') return 'temperature_once';
  if (args.length === 1 && args[0] === '--request-version') return 'firmware_version';
  throw new Error('Use no arguments, --request-temperature or --request-version.');
}

async function inspectRoutine({ args, config, fetchImpl = fetch, now = Date.now,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), print = console.log }) {
  const action = parseArguments(args);
  if (!config.adminApiKey) throw new Error('ADMIN_API_KEY is required.');
  const url = `http://127.0.0.1:${config.httpPort}/admin/wellness-routine`;
  const options = {
    headers: { 'X-Admin-Key': config.adminApiKey, 'Content-Type': 'application/json' },
  };
  const response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(5000),
    method: action ? 'POST' : 'GET',
    ...(action ? { body: JSON.stringify({ action }) } : {}),
  });
  const result = await response.json();
  if (!response.ok || action !== 'firmware_version' || result.outcome !== 'version_request_handed_off') {
    print(JSON.stringify(result, null, 2));
    return response.ok ? 0 : 1;
  }
  print('Version query sent. Waiting up to 20 seconds for the reply…');
  const deadline = now() + 20_000;
  let status = {}, replySeen = false;
  // One VERNO only. All following calls read status; never resend or request
  // temperature automatically. The gateway enforces its separate cooldown.
  for (let checks = 0; checks < 10 && now() < deadline; checks++) {
    await sleep(Math.min(2000, deadline - now()));
    const remaining = deadline - now();
    if (remaining <= 0) break;
    const check = await fetchImpl(url, { ...options, method: 'GET',
      signal: AbortSignal.timeout(Math.min(5000, remaining)) });
    status = await check.json();
    if (!check.ok) { print(JSON.stringify(status, null, 2)); return 1; }
    const firmware = status.firmwareEvidence;
    replySeen = firmware?.requestedAt === result.requestedAt &&
      +new Date(firmware?.replyAt) >= +new Date(result.requestedAt);
    if (replySeen) break;
  }
  print(JSON.stringify({ ...status, outcome: replySeen ? 'version_reply_received' : 'version_reply_not_observed',
    versionRequestSent: true, versionConfirmed: replySeen && status.firmwareEvidence.replyState === 'version_received' }, null, 2));
  return replySeen ? 0 : 1;
}
if (require.main === module) inspectRoutine({ args: process.argv.slice(2), config: require('../src/config') })
  .then(code => { process.exitCode = code; }).catch(() => {
  console.error('Could not reach the running gateway; check the gateway and its admin configuration.');
  process.exitCode = 1;
});

module.exports = { parseArguments, inspectRoutine };
