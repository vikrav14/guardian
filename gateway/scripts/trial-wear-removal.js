'use strict';

function parseArguments(args) {
  if (!args.length) return null;
  if (args.length === 1 && ['--enable', '--disable'].includes(args[0])) return args[0].slice(2);
  throw new Error('Use no arguments (read only), --enable, or --disable.');
}

async function runTrial({ args, config, fetchImpl = fetch, print = console.log }) {
  const action = parseArguments(args);
  if (!config.adminApiKey) throw new Error('ADMIN_API_KEY is required.');
  const base = `http://127.0.0.1:${config.httpPort}`;
  const headers = { 'X-Admin-Key': config.adminApiKey };
  const statusResponse = await fetchImpl(`${base}/admin/wellness-routine`, {
    headers, method: 'GET', signal: AbortSignal.timeout(5000),
  });
  const status = await statusResponse.json();
  if (!statusResponse.ok) throw new Error(`Gateway status unavailable (HTTP ${statusResponse.status}); nothing sent.`);
  if (!action) {
    print(JSON.stringify({ outcome: 'read_only', connected: status.connected === true,
      commandReplyEvidence: status.commandReplyEvidence || null,
      wearingStatus: status.wearingStatus || 'unknown',
      instruction: 'A supervised trial uses --enable; --disable requests alarm OFF afterward. Neither confirms wearing.' }, null, 2));
    return 0;
  }
  // The running runtime reports connected only for one active pilot session.
  // A disconnected/multiple-session snapshot must never become a write.
  if (status.connected !== true) throw new Error('One connected pilot watch session is required; nothing sent.');
  const command = `REMOVE,${action === 'enable' ? 1 : 0}`;
  print(`${action === 'enable' ? 'Enabling' : 'Disabling'} the removal alarm for this test. The setting may persist; a reply does not prove the applied state.`);
  let response, result;
  try {
    // Exactly one documented command, using existing strict-admin transport.
    // No SMS, alarm-mode change, schedule, auto-retry or acceptance update.
    response = await fetchImpl(`${base}/admin/wellness-routine`, {
      headers: { ...headers, 'Content-Type': 'application/json' }, method: 'POST',
      body: JSON.stringify({ action: `removal_test_${action}` }), signal: AbortSignal.timeout(5000),
    });
    result = await response.json();
  } catch {
    print(JSON.stringify({ outcome: 'handoff_unknown', command, settingsConfirmed: false,
      instruction: 'The watch may have received the command. Inspect gateway logs and wear:check before retrying.' }, null, 2));
    return 1;
  }
  const handedOff = response.ok && result.outcome === 'command_handed_off';
  print(JSON.stringify({ outcome: handedOff ? 'command_handed_off' : 'command_not_confirmed',
    command, requestedAt: result.requestedAt || null, settingsConfirmed: false,
    wearingConfirmed: false, settingMayPersist: true,
    ...(!handedOff ? { error: result.error || result.outcome || `HTTP ${response.status}` } : {}),
    replyEvidenceBeforeRequest: status.commandReplyEvidence || null,
    ...(action === 'enable' ? { cleanup: 'npm run wear:trial -- --disable' } : {}),
  }, null, 2));
  return handedOff ? 0 : 1;
}

if (require.main === module) runTrial({ args: process.argv.slice(2), config: require('../src/config') })
  .then(code => { process.exitCode = code; })
  .catch(error => { console.error(`ERROR: ${error.message}`); process.exitCode = 1; });

module.exports = { parseArguments, runTrial };
