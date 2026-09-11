'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { experimentalCommand, preview, createSingleRouterTrial } = require('../src/wifi-fence-single-router-trial');
const { createWifiFenceCapture } = require('../src/wifi-fence-validation');
const { fingerprintRouter } = require('../src/wifi-home-observer');

const imei = '359633100123456';
const protocolId = '6331001234';
const routerId = '02:00:00:00:00:01';
const hashKey = 'ab'.repeat(32);
const start = Date.parse('2026-09-08T12:00:00Z');
const settings = { wifiHomeObserveEnabled: true, wifiHomePilotImei: imei,
  wifiHomeHashKey: hashKey, wifiHomeRouterHash: fingerprintRouter({ imei, routerId, hashKey }) };

function fixture() {
  const writes = [];
  const config = { ...settings };
  let capture = createWifiFenceCapture({ imei, hashKey, routerHash: config.wifiHomeRouterHash, startedAtMs: start });
  let sessions = [{ socket: { destroyed: false, writable: true, write: frame => { writes.push(frame); return false; } },
    session: { imei, protocolId } }];
  const trial = createSingleRouterTrial({ getConfig: () => config, getCapture: () => capture,
    findSessions: () => sessions });
  return { writes, config, trial, get capture() { return capture; }, set capture(v) { capture = v; },
    get sessions() { return sessions; }, set sessions(v) { sessions = v; },
    input: () => ({ experimental: true, routerId, captureId: capture.snapshot(start).captureId }) };
}

test('inferred one-entry command is framed separately from the documented builder and never pads slots', () => {
  const f = fixture();
  const result = f.trial.send(f.input(), start);
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].toString(), `[SG*${protocolId}*001D*WIFIFENCE,1,${routerId}]`);
  assert.equal(result.phase, 'queued'); // socket backpressure false is not rejection.
  assert.equal(result.settingsApplied, null);
  assert.equal(result.homeClaim, false);
  assert.equal(result.rollbackKnown, false);
  assert.equal(f.capture.snapshot(start).counts.fenceHandoffs, 1);
  assert.equal(f.capture.snapshot(start).counts.crHandoffs, 0);
  assert.equal(f.capture.snapshot(start).counts.uploadHandoffs, 0);
  assert.equal(preview().singleRouterSyntaxConfirmed, false);
  for (const secret of [imei, protocolId, routerId, hashKey, settings.wifiHomeRouterHash]) {
    assert.ok(!JSON.stringify(result).includes(secret));
  }
  for (const value of ['', 'Home', '00:00:00:00:00:00', 'ff:ff:ff:ff:ff:ff', `${routerId},2,${routerId}`, `${routerId}]CR`]) {
    assert.throws(() => experimentalCommand(value));
  }
});

test('invalid input, enrollment, capture and ambiguous or unbound sessions cannot send', () => {
  for (const change of [
    f => { f.config.wifiHomeObserveEnabled = false; },
    f => { f.config.wifiHomeRouterHash = 'cd'.repeat(32); },
    f => { f.capture = null; },
    f => { f.capture.stop(start); },
    f => { f.sessions = []; },
    f => { f.sessions = [...f.sessions, ...f.sessions]; },
    f => { f.sessions[0].socket.writable = false; },
    f => { f.sessions[0].socket.destroyed = true; },
    f => { f.sessions[0].session.imei = '359633100123457'; },
    f => { f.sessions[0].session.protocolId = ''; },
  ]) {
    const f = fixture(); const input = f.input(); change(f);
    assert.throws(() => f.trial.send(input, start));
    assert.equal(f.writes.length, 0);
    assert.equal(f.trial.status().attempted, false);
  }
  for (const edit of [v => ({ ...v, experimental: false }), v => ({ ...v, captureId: 'old' }),
    v => ({ ...v, command: 'CR' }), () => [], () => null]) {
    const f = fixture(); assert.throws(() => f.trial.send(edit(f.input()), start));
    assert.equal(f.writes.length, 0);
  }
  const f = fixture();
  assert.throws(() => f.trial.send(f.input(), start - 1));
  f.capture.mark('at_home', start + 1000);
  assert.throws(() => f.trial.send(f.input(), start + 500));
  assert.throws(() => f.trial.send(f.input(), start + 30 * 60_000 - 10_000));
  assert.equal(f.writes.length, 0);
});

test('an uncertain write or failed capture cannot retry, including after starting another capture', () => {
  for (const mode of ['write_throws', 'capture_throws']) {
    const f = fixture(); const input = f.input();
    if (mode === 'write_throws') f.sessions[0].socket.write = frame => {
      f.writes.push(frame); throw new Error(`private failure ${routerId}`);
    };
    else { const original = f.capture;
      f.capture = { snapshot: (...args) => original.snapshot(...args), recordCommand: () => { throw new Error('private capture failure'); } };
    }
    const result = f.trial.send(input, start);
    assert.equal(result.phase, mode === 'write_throws' ? 'handoff_unknown' : 'queued');
    assert.equal(result.captureRecorded, false);
    assert.throws(() => f.trial.send(input, start + 1), /already_attempted/);
    f.capture = createWifiFenceCapture({ imei, hashKey, routerHash: settings.wifiHomeRouterHash, startedAtMs: start });
    assert.throws(() => f.trial.send(f.input(), start + 2), /already_attempted/);
    assert.equal(f.writes.length, 1);
  }
});

test('live HTTP trial is strict-admin, pilot-bound, body-only and accepts at most one concurrent send', async t => {
  const config = require('../src/config');
  const { handleOpsHttpRequest } = require('../src/http');
  const { getActiveSessions } = require('../src/sessions');
  const saved = { ...config };
  const oldKey = process.env.ADMIN_API_KEY;
  const oldNodeEnv = process.env.NODE_ENV;
  delete process.env.ADMIN_API_KEY; delete process.env.NODE_ENV;
  Object.assign(config, settings, { adminApiKey: '' });
  const writes = [];
  const socket = { writable: true, destroyed: false, write: frame => { writes.push(frame.toString()); return true; } };
  getActiveSessions().set(socket, { imei, protocolId });
  t.after(() => { Object.assign(config, saved); getActiveSessions().delete(socket);
    if (oldKey == null) delete process.env.ADMIN_API_KEY; else process.env.ADMIN_API_KEY = oldKey;
    if (oldNodeEnv == null) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldNodeEnv;
  });
  const server = http.createServer(async (req, res) => {
    await handleOpsHttpRequest(req, res, new URL(req.url, 'http://localhost'));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const trialPath = `/ops/wifi-fence-single-router-trial?imei=${imei}`;
  async function call(path, body, key = config.adminApiKey, method = 'POST') {
    const response = await fetch(base + path, { method, headers: key ? { 'X-Admin-Key': key } : {},
      ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) });
    return { code: response.status, body: await response.json() };
  }
  assert.equal((await call(trialPath, {})).code, 503);
  config.adminApiKey = 'synthetic-trial-admin';
  assert.equal((await call(trialPath, {}, '')).code, 401);
  assert.equal((await call(trialPath, {}, 'wrong')).code, 401);
  assert.equal((await call(trialPath, undefined, config.adminApiKey, 'GET')).code, 405);
  const began = await call(`/ops/wifi-fence-validation?imei=${imei}&action=start`);
  const input = { experimental: true, routerId, captureId: began.body.capture.captureId };
  assert.equal((await call(trialPath + '&command=CR', input)).code, 409);
  assert.equal((await call(trialPath.replace(imei, '359633100123457'), input)).code, 409);
  assert.equal((await call(trialPath, '{"routerId":"private-broken-input"')).code, 409);
  assert.equal((await call(trialPath, { ...input, routerId: '02:00:00:00:00:02' })).code, 409);
  assert.equal((await call(trialPath, { ...input, command: 'UPLOAD,20' })).code, 409);
  // A valid body with excessive whitespace must be stopped by the size limit,
  // not merely by validation of an extra property. Closing the stream is valid.
  const oversized = await call(trialPath, ' '.repeat(1024) + JSON.stringify(input)).catch(() => null);
  assert.ok(oversized == null || oversized.code === 409);
  assert.equal(writes.length, 0);
  const results = await Promise.all([call(trialPath, input), call(trialPath, input)]);
  assert.deepEqual(results.map(r => r.code).sort(), [200, 409]);
  assert.equal(writes.length, 1);
  const report = await call(`/ops/wifi-fence-validation?imei=${imei}&timeline=1`, undefined, config.adminApiKey, 'GET');
  assert.equal(report.body.capture.counts.fenceHandoffs, 1);
  assert.equal(report.body.singleRouterTrial.attempted, true);
  assert.equal(report.body.liveProvisioningAvailable, false);
  for (const secret of [imei, protocolId, routerId, hashKey, config.adminApiKey]) {
    assert.ok(!JSON.stringify([results, report]).includes(secret));
  }
});
