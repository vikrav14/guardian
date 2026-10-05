'use strict';

// Read the existing gateway. No Firebase initialization, watcher, camera command
// or notification transport is started by this process.
async function inspectIncidentWorker({ port, adminKey, fetchImpl = fetch }) {
  if (!adminKey || !Number.isInteger(port) || port < 1 || port > 65535) throw Error('local_configuration_missing');
  const response = await fetchImpl(`http://127.0.0.1:${port}/ops/incident-photos`, {
    method: 'GET', headers: { 'X-Admin-Key': adminKey }, redirect: 'error', signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw Error(response.status === 404 ? 'updated_gateway_required' : 'gateway_request_rejected');
  }
  const status = await response.json();
  if (status?.version !== 1) throw Error('unsupported_gateway');
  return { outcome: 'read_only', ...status };
}

async function main() {
  if (process.argv.length > 2) throw Error('invalid_arguments');
  const config = require('../src/config');
  const status = await inspectIncidentWorker({ port: config.httpPort, adminKey: config.adminApiKey });
  console.log(JSON.stringify(status, null, 2));
}
if (require.main === module) main().catch(error => {
  const known = ['invalid_arguments', 'local_configuration_missing', 'updated_gateway_required',
    'gateway_request_rejected', 'unsupported_gateway'];
  console.error(JSON.stringify({ outcome: 'check_failed',
    reason: known.includes(error.message) ? error.message : 'gateway_response_unavailable' }));
  process.exitCode = 1;
});
module.exports = { inspectIncidentWorker };
