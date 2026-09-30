'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const { handleOpsHttpRequest } = require('../src/http');
function response() {
  return { headers: {}, setHeader(name, value) { this.headers[name] = value; },
    writeHead(status) { this.status = status; }, end(text) { this.body = JSON.parse(text); } };
}
test('incident worker diagnostics require strict admin, exclude credentials and expose no write route', async t => {
  const before = { key: config.adminApiKey, env: process.env.ADMIN_API_KEY, mode: process.env.NODE_ENV };
  t.after(() => {
    config.adminApiKey = before.key;
    for (const [key, value] of [['ADMIN_API_KEY', before.env], ['NODE_ENV', before.mode]]) {
      if (value == null) delete process.env[key]; else process.env[key] = value;
    }
  });
  delete process.env.ADMIN_API_KEY; delete process.env.NODE_ENV;
  config.adminApiKey = '';
  const url = new URL('http://localhost/ops/incident-photos');
  const open = response();
  await handleOpsHttpRequest({ method: 'GET', headers: {} }, open, url);
  assert.equal(open.status, 503);
  config.adminApiKey = 'synthetic-private-key';
  for (const headers of [{}, { 'x-admin-key': 'incorrect' }]) {
    const denied = response();
    await handleOpsHttpRequest({ method: 'GET', headers }, denied, url);
    assert.equal(denied.status, 401);
    assert.equal(denied.body.workerStarted, undefined);
  }
  const allowed = response();
  const headers = { 'x-admin-key': config.adminApiKey };
  await handleOpsHttpRequest({ method: 'GET', headers }, allowed, url);
  assert.equal(allowed.status, 200);
  assert.deepEqual(allowed.body, { version: 1, workerStarted: false });
  assert.equal(allowed.headers['Cache-Control'], 'no-store');
  assert.ok(!JSON.stringify(allowed.body).includes(config.adminApiKey));
  assert.equal(await handleOpsHttpRequest({ method: 'POST', headers }, response(), url), false);
});
