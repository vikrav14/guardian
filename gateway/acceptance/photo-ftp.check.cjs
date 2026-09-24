'use strict';
// Explicit acceptance test: Python is not a dependency of ordinary npm test.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const http = require('node:http');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { readValidatedReceipt } = require('../scripts/photo-trial-firebase');

test('isolated FTP receiver: real transfers through distinct control/data proxies', { timeout: 30000 }, () => {
  const python = process.env.GUARDIAN_PHOTO_PYTHON;
  assert.ok(python, 'Set GUARDIAN_PHOTO_PYTHON to Python with photo-ftp-requirements.txt installed.');
  const result = spawnSync(python, [path.resolve(__dirname, '../scripts/check_photo_ftp.py')],
    { encoding: 'utf8', timeout: 25000, maxBuffer: 20000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const evidence = JSON.parse(result.stdout.trim());
  assert.equal(evidence.event, 'ftp_self_test_passed');
  assert.ok(evidence.checks.length >= 9);
  assert.equal(evidence.watchCommandsSent, false);
  assert.equal(evidence.firebaseWrites, 0);
});

test('Firebase receipt reader fully decodes the JPEG and rejects changed bytes', () => {
  const python = process.env.GUARDIAN_PHOTO_PYTHON;
  assert.ok(python);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardian-receipt-check-'));
  try {
    const jpeg = require('../test/fixtures/photo-synthetic');
    fs.mkdirSync(path.join(root, 'incoming'));
    const fileName = '9705254749_20260924223000.JPG';
    const file = path.join(root, 'incoming', fileName), receiptPath = path.join(root, 'receipt.json');
    fs.writeFileSync(file, jpeg);
    fs.writeFileSync(receiptPath, JSON.stringify({ version: 1, imei: '861397052547492', protocolId: '9705254749',
      source: 'ftp_trial', validation: 'pillow_full_decode', receivedAt: Date.now() / 1000, fileName,
      sha256: crypto.createHash('sha256').update(jpeg).digest('hex') }));
    const result = readValidatedReceipt(receiptPath, python);
    assert.equal(result.decoded.validation, 'pillow_full_decode');
    assert.equal(result.decoded.width, 32);
    assert.deepEqual(result.jpeg, jpeg);
    fs.writeFileSync(file, Buffer.from('not a photo'));
    assert.throws(() => readValidatedReceipt(receiptPath, python));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('public-check CLI drives real FTP through a local fake agent and restores its routes', { timeout: 20000 }, async () => {
  const python = process.env.GUARDIAN_PHOTO_PYTHON;
  assert.ok(python);
  const rows = new Map();
  const sockets = new Set();
  const proxy = target => net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    const upstream = net.connect(target(), '127.0.0.1');
    sockets.add(upstream); upstream.on('close', () => sockets.delete(upstream));
    upstream.on('error', () => socket.destroy()); socket.on('error', () => upstream.destroy());
    socket.pipe(upstream).pipe(socket);
  });
  const control = proxy(() => Number(rows.get('guardian-answer-capture').upstream.url.split(':').pop()));
  const data = proxy(() => 2122);
  const listen = (server, port) => new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(port, '127.0.0.1', resolve);
  });
  let runner, journal;
  const agent = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const name = decodeURIComponent(req.url.split('/').pop());
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET') { res.end(JSON.stringify({ endpoints: [...rows.values()] })); return; }
    assert.notEqual(name, 'command_line');
    if (req.method === 'DELETE') { rows.delete(name); res.statusCode = 204; res.end(); return; }
    const body = JSON.parse(raw);
    assert.notEqual(body.name, 'command_line');
    if (body.url === 'tcp://') body.url = `tcp://127.0.0.1:${data.address().port}`;
    rows.set(body.name, body); res.end(JSON.stringify(body));
  });
  try {
    await listen(control, 0); await listen(data, 0); await listen(agent, 4040);
    rows.set('command_line', { name: 'command_line', url: 'tcp://127.0.0.1:19000', upstream: { url: 'localhost:9000' }, inspect: false });
    rows.set('guardian-answer-capture', { name: 'guardian-answer-capture', url: `tcp://127.0.0.1:${control.address().port}`, upstream: { url: '127.0.0.1:9002' }, inspect: false });
    rows.set('guardian-wa-https', { name: 'guardian-wa-https', url: 'https://example.ngrok-free.dev', upstream: { url: 'http://localhost:9001' }, inspect: true });
    runner = spawn(process.execPath, [path.resolve(__dirname, '../scripts/check-photo-ftp-public.js'), '--run', '--pause-whatsapp'],
      { env: { ...process.env, GUARDIAN_PHOTO_PYTHON: python }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    runner.stdout.on('data', bytes => stdout += bytes); runner.stderr.on('data', bytes => stderr += bytes);
    const code = await new Promise((resolve, reject) => { runner.once('error', reject); runner.once('close', resolve); });
    const evidence = stdout.trim().split('\n').map(line => JSON.parse(line));
    journal = evidence.find(row => row.restoreJournal)?.restoreJournal;
    assert.equal(code, 0, stdout + stderr);
    const result = evidence.at(-1);
    assert.equal(result.outcome, 'public_ftp_probe_passed');
    assert.equal(result.probeResult.bytesVerified, 1024);
    assert.equal(result.restoration.endpointConfigurationRestored, true);
    assert.equal(rows.size, 3);
    assert.equal(rows.get('guardian-answer-capture').upstream.url, '127.0.0.1:9002');
    assert.ok(rows.has('guardian-wa-https'));
  } finally {
    if (runner && runner.exitCode === null) runner.kill();
    for (const socket of sockets) socket.destroy();
    for (const server of [agent, control, data]) if (server.listening) await new Promise(resolve => server.close(resolve));
    if (journal) fs.rmSync(path.dirname(journal), { recursive: true, force: true });
  }
});
