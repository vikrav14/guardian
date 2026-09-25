'use strict';

// Operator diagnostic only. No watch sender, Firebase writes or gateway import.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const API = 'http://127.0.0.1:4040/api/endpoints';
const emit = value => console.log(JSON.stringify(value));

function config(row) {
  const result = { name: row.name, url: row.url, upstream: { ...row.upstream }, inspect: row.inspect };
  for (const key of ['traffic_policy', 'pooling_enabled']) if (row[key] !== undefined) result[key] = row[key];
  return result;
}
function same(a, b) {
  if (!a || !b) return false;
  const protocol = row => row.upstream?.protocol || (row.url?.startsWith('tcp:') ? 'tcp' : 'http');
  return a.name === b.name && a.url === b.url && a.upstream?.url === b.upstream?.url &&
    protocol(a) === protocol(b) && a.inspect === b.inspect &&
    (a.traffic_policy || '') === (b.traffic_policy || '') && Boolean(a.pooling_enabled) === Boolean(b.pooling_enabled);
}
function publicUrl(value, protocol) {
  const url = new URL(value);
  if (url.protocol !== protocol || !url.hostname || url.username || url.password || url.search || url.hash ||
      url.pathname && url.pathname !== '/' || protocol === 'tcp:' && !url.port) throw Error('invalid_endpoint_url');
  return value;
}
function planEndpoints(rows, id) {
  if (!Array.isArray(rows) || rows.length !== 3 || !/^[a-f0-9]{16}$/.test(id)) throw Error('unexpected_endpoint_layout');
  const select = name => {
    const matches = rows.filter(row => row.name === name);
    if (matches.length !== 1) throw Error('unexpected_endpoint_layout');
    return matches[0];
  };
  const guardian = select('command_line'), capture = select('guardian-answer-capture'), whatsapp = select('guardian-wa-https');
  for (const row of rows) {
    if (!row.upstream || Object.keys(row.upstream).some(key => !['url', 'protocol'].includes(key)) ||
        typeof row.inspect !== 'boolean' || row.traffic_policy || row.pooling_enabled) throw Error('unsupported_endpoint_configuration');
  }
  if (!/^(localhost|127\.0\.0\.1):9000$/.test(guardian.upstream.url) ||
      !/^(localhost|127\.0\.0\.1):9002$/.test(capture.upstream.url) ||
      !/^http:\/\/(localhost|127\.0\.0\.1):9001\/?$/.test(whatsapp.upstream.url)) throw Error('unexpected_endpoint_upstream');
  publicUrl(guardian.url, 'tcp:'); publicUrl(capture.url, 'tcp:'); publicUrl(whatsapp.url, 'https:');
  if (Number(capture.metrics?.conns?.gauge || 0) !== 0) throw Error('recorder_has_active_connections');
  const captureTrial = config(capture);
  return { version: 2, id, guardian: config(guardian), capture: config(capture), whatsapp: config(whatsapp), captureTrial,
    data: { name: `guardian-photo-ftp-data-${id}`, url: 'tcp://', upstream: { url: '127.0.0.1:2122' }, inspect: false } };
}

async function api(method, name, body) {
  const response = await fetch(API + (name ? '/' + encodeURIComponent(name) : ''), {
    method, headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000), redirect: 'error',
  });
  if (!response.ok) {
    const error = Error(`ngrok_http_${response.status}`);
    error.request = { method, endpoint: name || body?.name || null, status: response.status };
    throw error;
  }
  return response.status === 204 ? null : response.json();
}

function validateJournal(value) {
  if (!value || ![1, 2].includes(value.version)) throw Error('invalid_restore_journal');
  const expected = planEndpoints([value.guardian, value.capture, value.whatsapp], value.id);
  if (value.version === 1) {
    expected.version = 1;
    expected.captureTrial = { ...expected.capture, upstream: { url: '127.0.0.1:2121' }, inspect: false };
  }
  if (!same(value.captureTrial, expected.captureTrial) || !same(value.data, expected.data)) throw Error('invalid_restore_journal');
  return expected;
}

async function replaceEndpoint(original, replacement, request, check = () => {}, requireIdle = true) {
  // Older agents can expose GET/POST/DELETE without implementing endpoint PUT.
  // Re-read before deleting so a concurrent operator's route is not replaced.
  const rows = (await request('GET')).endpoints;
  const current = rows.find(row => row.name === original.name);
  if (!same(current, original) || original.name !== replacement.name || original.name === 'command_line') {
    throw Error('endpoint_changed_during_trial');
  }
  if (requireIdle && Number(current.metrics?.conns?.gauge || 0) !== 0) throw Error('recorder_has_active_connections');
  check();
  await request('DELETE', original.name);
  check();
  await request('POST', null, replacement);
}

async function restore(plan, request = api) {
  const problems = [];
  const attempt = async fn => { try { await fn(); } catch (error) { problems.push(error.message); } };
  await attempt(async () => {
    const rows = (await request('GET')).endpoints;
    const current = rows.find(row => row.name === plan.data.name);
    if (current) {
      publicUrl(current.url, 'tcp:');
      if (!same(current, { ...plan.data, url: current.url })) throw Error('data_endpoint_changed');
      await request('DELETE', plan.data.name);
    }
  });
  // Restore WhatsApp first; a recorder restoration failure must not skip it.
  // v2 never mutates either TCP endpoint. v1 journals remain recoverable.
  for (const original of plan.version === 1 ? [plan.whatsapp, plan.capture] : [plan.whatsapp]) await attempt(async () => {
    const rows = (await request('GET')).endpoints;
    const current = rows.find(row => row.name === original.name);
    if (same(current, original)) return;
    if (!current) { await request('POST', null, original); return; }
    if (original.name === plan.capture.name && same(current, plan.captureTrial)) {
      // Cleanup owns this temporary FTP endpoint. Lagging connection metrics
      // must not prevent restoration after the receiver has been stopped.
      await replaceEndpoint(plan.captureTrial, original, request, undefined, false); return;
    }
    throw Error('endpoint_changed_during_trial');
  });
  await attempt(async () => {
    const rows = (await request('GET')).endpoints;
    if (rows.some(row => row.name === plan.data.name) ||
        ![plan.guardian, plan.whatsapp, plan.capture].every(original => same(rows.find(row => row.name === original.name), original))) {
      throw Error('endpoint_restoration_not_verified');
    }
  });
  return { outcome: problems.length ? 'endpoint_restore_incomplete' : 'endpoint_configuration_restored',
    endpointConfigurationRestored: problems.length === 0, publicReachabilityVerified: false, problems };
}

async function trial({ plan, request = api, probe, signal }) {
  let probeResult = null, failure = null, failureStage = null, failureRequest = null;
  let stage = 'verify_original_endpoints';
  const check = () => { if (signal?.aborted) throw Error('probe_cancelled'); };
  try {
    check();
    const originalRows = (await request('GET')).endpoints;
    if (plan.version !== 2 || ![plan.guardian, plan.capture, plan.whatsapp].every(original =>
      same(originalRows.find(row => row.name === original.name), original))) throw Error('endpoint_changed_during_trial');
    check();
    stage = 'pause_whatsapp_endpoint';
    await request('DELETE', plan.whatsapp.name);
    check();
    stage = 'create_ftp_data_endpoint';
    await request('POST', null, plan.data);
    check();
    stage = 'verify_trial_endpoints';
    const rows = (await request('GET')).endpoints;
    const data = rows.find(row => row.name === plan.data.name);
    if (!data || !same(data, { ...plan.data, url: data.url }) ||
        !same(rows.find(row => row.name === plan.capture.name), plan.captureTrial) ||
        !same(rows.find(row => row.name === plan.guardian.name), plan.guardian)) throw Error('trial_endpoints_not_verified');
    publicUrl(data.url, 'tcp:');
    stage = 'public_ftp_transfer';
    probeResult = await probe(plan.captureTrial.url, data.url);
  } catch (error) { failure = error.message; failureStage = stage; failureRequest = error.request || null; }
  const restoration = await restore(plan, request);
  return { outcome: !failure && restoration.endpointConfigurationRestored ? 'public_ftp_probe_passed' : 'public_ftp_probe_incomplete',
    probeResult, failure, failureStage, failureRequest, restoration, watchCommandsSent: false, firebaseWrites: 0 };
}

function child(python, args, signal, readyEvent) {
  let output = '', settled = false, timer;
  const process = spawn(python, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let resolveExit;
  const exited = new Promise(resolve => { resolveExit = resolve; });
  const result = new Promise((resolve, reject) => {
    const fail = reason => { if (!settled) { settled = true; reject(Error(reason)); } process.kill(); };
    const abort = () => fail('probe_cancelled');
    const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); resolveExit(); };
    process.on('error', () => { finish(); fail('python_launch_failed'); });
    process.stdout.on('data', buffer => {
      output += buffer.toString();
      if (output.length > 32768) { fail('python_output_limit'); return; }
      if (readyEvent && output.split('\n').some(line => { try { return JSON.parse(line).event === readyEvent; } catch { return false; } })) {
        if (!settled) { settled = true; clearTimeout(timer); resolve(null); }
      }
    });
    process.stderr.on('data', () => {}); // avoid propagating raw FTP arguments/tracebacks
    process.on('close', code => {
      finish();
      if (!settled) {
        settled = true;
        if (code !== 0 || readyEvent) reject(Error('python_probe_or_receiver_failed'));
        else { try { resolve(JSON.parse(output.trim())); } catch { reject(Error('python_result_missing')); } }
      }
    });
    timer = setTimeout(() => fail('python_step_timeout'), readyEvent ? 15000 : 45000);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
  return { result, stop: async () => { if (process.exitCode === null) process.kill(); await exited; } };
}

async function freePort(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', () => reject(Error('local_ftp_port_in_use')));
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}

async function startControlBridge(port = 9002) {
  const sockets = new Set();
  const server = net.createServer(socket => {
    if (sockets.size >= 12) { socket.destroy(); return; }
    const upstream = net.connect(2121, '127.0.0.1');
    for (const stream of [socket, upstream]) {
      sockets.add(stream); stream.once('close', () => sockets.delete(stream));
      stream.setTimeout(30000, () => stream.destroy());
    }
    socket.on('error', () => upstream.destroy());
    upstream.on('error', () => socket.destroy());
    socket.on('close', () => upstream.destroy());
    upstream.on('close', () => socket.destroy());
    socket.pipe(upstream).pipe(socket);
  });
  await new Promise((resolve, reject) => {
    server.once('error', () => reject(Error('recorder_port_in_use_stop_old_recorder')));
    server.listen(port, '127.0.0.1', resolve);
  });
  return { port: server.address().port, stop: async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  } };
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--restore-journal' && args.length === 2) {
    const file = args[1];
    if (!path.isAbsolute(file) || fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).size > 16384) throw Error('invalid_restore_journal');
    const result = await restore(validateJournal(JSON.parse(fs.readFileSync(file, 'utf8'))));
    emit(result); if (!result.endpointConfigurationRestored) process.exitCode = 1;
    return;
  }
  if (args.some(x => !['--run', '--pause-whatsapp'].includes(x)) || new Set(args).size !== args.length ||
      args.length && !(args.includes('--run') && args.includes('--pause-whatsapp'))) throw Error('run_requires_pause_whatsapp_flag');
  const plan = planEndpoints((await api('GET')).endpoints, crypto.randomBytes(8).toString('hex'));
  if (!args.length) {
    emit({ outcome: 'public_ftp_preview', changesMade: false, guardianUrl: plan.guardian.url,
      reuseRecorderThroughLocalBridge: true, tcpEndpointChangesPlanned: false, temporarilyPauseWhatsappWebhooks: true,
      automaticallyRestoreEndpoints: true, watchCommandsSent: false, firebaseWrites: 0 }); return;
  }
  const python = process.env.GUARDIAN_PHOTO_PYTHON || path.join(process.env.LOCALAPPDATA || '', 'Guardian', 'photo-ftp-python', 'Scripts', 'python.exe');
  if (!path.isAbsolute(python) || !fs.existsSync(python)) throw Error('photo_python_environment_missing');
  await freePort(2121); await freePort(2122);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardian-photo-public-'));
  fs.chmodSync(root, 0o700);
  const journal = path.join(root, 'restore-endpoints.json');
  fs.writeFileSync(journal, JSON.stringify(plan), { flag: 'wx', mode: 0o600 });
  const receiver = path.join(__dirname, 'photo_ftp_receiver.py'), sessionDir = path.join(root, 'receiver');
  const abort = new AbortController();
  const onInterrupt = () => abort.abort();
  process.on('SIGINT', onInterrupt); process.on('SIGTERM', onInterrupt);
  const deadline = setTimeout(onInterrupt, 120000);
  let bridge;
  try {
    bridge = await startControlBridge();
    await child(python, [receiver, '--init-dir', sessionDir, '--imei', '861397052547492', '--protocol-id', '9705254749'], abort.signal).result;
    emit({ outcome: 'public_ftp_probe_starting', restoreJournal: journal,
      whatsappWebhookPausePlanned: true, watchCommandsSent: false });
    const result = await trial({ plan, signal: abort.signal, probe: async (controlUrl, dataUrl) => {
      const session = path.join(sessionDir, 'session.json');
      const server = child(python, [receiver, '--run', '--session', session, '--control-url', controlUrl,
        '--data-url', dataUrl, '--minutes', '1'], abort.signal, 'ftp_listening');
      try {
        await server.result;
        const result = await child(python, [receiver, '--probe', '--session', session, '--control-url', controlUrl], abort.signal).result;
        if (result.event !== 'ftp_probe_passed' || result.bytesVerified !== 1024) throw Error('public_probe_not_verified');
        return result;
      } finally { await server.stop(); }
    } });
    emit({ ...result, restoreJournal: journal });
    if (result.outcome !== 'public_ftp_probe_passed') process.exitCode = 1;
  } finally {
    try { if (bridge) await bridge.stop(); }
    finally {
      clearTimeout(deadline); process.removeListener('SIGINT', onInterrupt); process.removeListener('SIGTERM', onInterrupt);
    }
  }
}

if (require.main === module) main().catch(error => {
  emit({ outcome: 'public_ftp_check_failed', reason: /^[a-z_0-9]+$/.test(error.message || '') ? error.message : 'check_local_agent_and_arguments' });
  process.exitCode = 1;
});
module.exports = { config, same, planEndpoints, validateJournal, restore, trial, startControlBridge };
