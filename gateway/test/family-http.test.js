'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createFamilyHandler } = require('../src/family-http');
function request(path, token = 'Bearer signed', method = 'GET', value = {}) {
  const req = Readable.from([Buffer.from(JSON.stringify(value))]); req.method = method; req.headers = { authorization: token };
  const res = { writeHead(status, headers) { this.status = status; this.headers = headers; }, end(value) { this.body = JSON.parse(value); } };
  return { req, res, url: new URL(path, 'https://example.test') };
}
test('family HTTP defaults off and authenticates revocation-checked bearer identity before any store action', async () => {
  let calls = 0;
  const dependencies = { getDb: () => ({}), verifyToken: async token => { if (token !== 'signed') throw Error('bad token'); return { uid: 'verified' }; },
    storeFactory: () => ({ list: async uid => { calls++; assert.equal(uid, 'verified'); return { services: [] }; } }) };
  const disabled = createFamilyHandler({ ...dependencies, enabled: false }), on = createFamilyHandler({ ...dependencies, enabled: true });
  const one = request('/app/family'); await disabled(one.req, one.res, one.url); assert.equal(one.res.status, 503);
  for (const token of ['', 'Bearer invalid', 'admin-key']) {
    const two = request('/app/family', token); await on(two.req, two.res, two.url); assert.equal(two.res.status, 401);
  }
  assert.equal(calls, 0);
  const three = request('/app/family'); await on(three.req, three.res, three.url); assert.equal(three.res.status, 200);
  assert.equal(three.res.headers['Cache-Control'], 'no-store, private'); assert.equal(calls, 1);
});
test('family HTTP does not trust a body UID or leak internal errors', async () => {
  let captured;
  const on = createFamilyHandler({ enabled: true, getDb: () => ({}), verifyToken: async () => ({ uid: 'verified' }),
    storeFactory: () => ({ update: async (uid, imei) => { captured = { uid, imei }; throw Error('private database details'); } }) });
  const row = request('/app/family/member?imei=999999999999999', 'Bearer signed', 'POST', { uid: 'owner' });
  await on(row.req, row.res, row.url);
  assert.deepEqual(captured, { uid: 'verified', imei: '999999999999999' });
  assert.deepEqual(row.res.body, { error: 'gateway_unavailable' });
});
