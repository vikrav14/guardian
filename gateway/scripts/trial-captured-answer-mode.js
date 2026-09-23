'use strict';

const fs = require('node:fs');
const { MAX_CAPTURE_BYTES, parseCaptureFile, prepareCapturedAnswerTrial } = require('../src/captured-answer-mode-trial');

function parseArguments(args) {
  const values = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!['--imei', '--mode', '--capture-file', '--send'].includes(key) || key in values) throw new Error('invalid_arguments');
    values[key] = key === '--send' ? true : args[++i];
    if (!values[key] || String(values[key]).startsWith('--')) throw new Error('invalid_arguments');
  }
  if (!/^\d{15}$/.test(values['--imei'] || '') || !['auto', 'manual'].includes(values['--mode']) ||
      !values['--capture-file']) throw new Error('invalid_arguments');
  return { imei: values['--imei'], mode: values['--mode'], path: values['--capture-file'], send: values['--send'] === true };
}

function readCapture(path) {
  let fd;
  try {
    fd = fs.openSync(path, 'r');
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_CAPTURE_BYTES) throw new Error();
    // Bound the read even if the recorder grows the file between stat/read.
    const bytes = Buffer.alloc(MAX_CAPTURE_BYTES + 1);
    let size = 0;
    while (size < bytes.length) {
      const count = fs.readSync(fd, bytes, size, bytes.length - size, null);
      if (!count) break;
      size += count;
    }
    if (size > MAX_CAPTURE_BYTES) throw new Error();
    return parseCaptureFile(bytes.subarray(0, size).toString('utf8'));
  } catch { throw new Error('private_capture_unavailable_or_invalid'); }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}

async function runCapturedTrial({ args, config, fetchImpl = fetch, print = console.log }) {
  const operation = parseArguments(args);
  const input = { imei: operation.imei, mode: operation.mode, capture: readCapture(operation.path) };
  const { metadata } = prepareCapturedAnswerTrial(input);
  const { sequenceDigest, ...safe } = metadata;
  const emit = value => print(JSON.stringify({ ...safe, ...value }, null, 2));
  if (!operation.send) { emit({ outcome: 'preview', commandSent: false }); return 0; }
  if (typeof config.adminApiKey !== 'string' || !config.adminApiKey.trim()) throw new Error('ADMIN_API_KEY_required');
  if (!Number.isInteger(Number(config.httpPort)) || Number(config.httpPort) < 1 || Number(config.httpPort) > 65535) throw new Error('invalid_HTTP_PORT');
  let response, result;
  try {
    response = await fetchImpl(`http://127.0.0.1:${Number(config.httpPort)}/admin/watch-answer-trial`, {
      method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', 'X-Admin-Key': config.adminApiKey },
      body: JSON.stringify(input), signal: AbortSignal.timeout(10000),
    });
    result = await response.json();
  } catch {
    emit({ outcome: 'handoff_unknown', note: 'No automatic retry. The setting may have reached the watch; check its behaviour.' });
    return 1;
  }
  if (!response.ok || result?.ok !== true) {
    const reason = ['no_fresh_identified_session', 'capture_device_mismatch', 'socket_write_uncertain', 'invalid_reference_capture']
      .includes(result?.reason) ? result.reason : 'request_not_confirmed';
    emit({ outcome: result?.outcome === 'not_sent' ? 'not_sent' : 'handoff_unknown', httpStatus: response.status, reason });
    return 1;
  }
  if (result.sequenceDigest !== sequenceDigest || result.protocolId !== metadata.protocolId ||
      result.mode !== operation.mode || result.frameCount !== metadata.frameCount ||
      result.sessions !== 1 || result.outcome !== 'socket_handoff' || result.appliedStateVerified !== false) {
    emit({ outcome: 'handoff_unknown', reason: 'response_mismatch', note: 'Do not retry automatically; verify the watch and running gateway.' });
    return 1;
  }
  emit({ outcome: 'socket_handoff', sessions: 1,
    note: 'Exact captured sequence handed to one socket. Verify with a physical call. Manual restoration must be tested separately.' });
  return 0;
}

if (require.main === module) runCapturedTrial({ args: process.argv.slice(2), config: require('../src/config') })
  .then(code => { process.exitCode = code; })
  .catch(error => {
    const known = ['invalid_arguments', 'private_capture_unavailable_or_invalid', 'invalid_reference_capture', 'ADMIN_API_KEY_required', 'invalid_HTTP_PORT'];
    console.error(known.includes(error.message) ? error.message : 'Trial failed; inspect the watch before retrying.');
    process.exitCode = 1;
  });

module.exports = { parseArguments, readCapture, runCapturedTrial };
