'use strict';

function parseArguments(args) {
  const values = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!['--imei', '--mode', '--framing', '--send'].includes(key) || key in values) {
      throw new Error('Use --imei <15 digits> --mode auto|manual --framing supplier|current [--send].');
    }
    if (key === '--send') values[key] = true;
    else {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}.`);
      values[key] = value;
    }
  }
  if (!/^\d{15}$/.test(values['--imei'] || '') ||
      !['auto', 'manual'].includes(values['--mode']) ||
      !['supplier', 'current'].includes(values['--framing'])) {
    throw new Error('Use --imei <15 digits> --mode auto|manual --framing supplier|current [--send].');
  }
  return { imei: values['--imei'], mode: values['--mode'], framing: values['--framing'], send: values['--send'] === true };
}

async function runTrial({ args, config, fetchImpl = fetch, print = console.log, now = () => new Date() }) {
  const operation = parseArguments(args);
  const command = operation.mode === 'auto' ? 'APPLOCK,JT-0' : 'APPLOCK,JT-1';
  const lengthField = operation.framing === 'supplier' ? '000c' : '000C';
  const emit = value => print(JSON.stringify(value, null, 2));
  const common = { command, framing: operation.framing, lengthField, payloadBytes: 12,
    appliedStateVerified: false, settingMayPersist: true };
  if (!operation.send) {
    emit({ ...common, outcome: 'preview', commandSent: false });
    return 0;
  }
  if (typeof config.adminApiKey !== 'string' || !config.adminApiKey.trim()) throw new Error('ADMIN_API_KEY is required.');
  const port = Number(config.httpPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('A valid gateway HTTP port is required.');
  const url = new URL(`http://127.0.0.1:${port}/dev/downlink`);
  url.searchParams.set('imei', operation.imei);
  url.searchParams.set('command', command);
  if (operation.framing === 'supplier') url.searchParams.set('frameFormat', 'applock-example');
  const requestedAt = now().toISOString();
  let response, result;
  try {
    response = await fetchImpl(url.toString(), { method: 'POST', redirect: 'error',
      headers: { 'X-Admin-Key': config.adminApiKey }, signal: AbortSignal.timeout(10000) });
    result = await response.json();
  } catch {
    emit({ ...common, requestedAt, outcome: 'handoff_unknown',
      note: 'No automatic retry. Inspect gateway logs; the setting may have reached the watch.' });
    return 1;
  }
  if (!response.ok || result?.ok !== true) {
    // Do not print arbitrary server errors, which may echo credentials or data.
    emit({ ...common, requestedAt, outcome: 'handoff_not_confirmed', httpStatus: response.status,
      reason: ['no_active_session', 'unsupported_frame_format', 'frame_format_command_rejected', 'invalid_protocol_id']
        .includes(result?.error) ? result.error : 'inspect_gateway_logs' });
    return 1;
  }
  const id = result.protocolId;
  const expected = /^\d{10}$/.test(id || '') ? `[SG*${id}*${lengthField}*${command}]` : null;
  if (!expected || result.frame !== expected || result.command !== command || !(result.sessions > 0)) {
    emit({ ...common, requestedAt, outcome: 'frame_mismatch_after_handoff',
      note: 'Do not count this as the selected framing test or retry automatically. Update/restart the gateway and inspect its logs.' });
    return 1;
  }
  emit({ ...common, requestedAt, outcome: 'socket_handoff', protocolId: id, sessions: result.sessions,
    frame: expected, frameHex: Buffer.from(expected, 'ascii').toString('hex'),
    note: 'Wait for the APPLOCK reply in the gateway log. Verify answering with a physical call; the reply is not applied-state proof.' });
  return 0;
}

if (require.main === module) runTrial({ args: process.argv.slice(2), config: require('../src/config') })
  .then(code => { process.exitCode = code; })
  .catch(error => { console.error(error.message); process.exitCode = 1; });

module.exports = { parseArguments, runTrial };
