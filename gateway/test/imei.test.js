const test = require('node:test');
const assert = require('node:assert/strict');
const {
  fullImeiFromProtocolId,
  protocolIdFromFullImei,
  normalizeImei,
  bindSessionImei,
  extractFullImeiFromPayload,
} = require('../src/imei');

test('protocolIdFromFullImei extracts the 10-digit id from a ReachFar IMEI', () => {
  assert.equal(protocolIdFromFullImei('861397052547400'), '9705254740');
  assert.equal(protocolIdFromFullImei('861397052547492'), '9705254749');
});

test('fullImeiFromProtocolId derives the configured-shape V52 IMEI with default suffix', () => {
  assert.equal(fullImeiFromProtocolId('9705254740'), '861397052547400');
});

test('normalizeImei prefers session fullImei when set', () => {
  const session = { fullImei: '861397052547492' };
  assert.equal(normalizeImei('9705254749', session), '861397052547492');
});

test('bindSessionImei maps a 10-digit frame id to canonical 15-digit imei', () => {
  const session = {};
  const bound = bindSessionImei(session, '9705254740');
  assert.equal(bound.protocolId, '9705254740');
  assert.equal(bound.imei, '861397052547400');
  assert.equal(session.fullImei, '861397052547400');
});

test('bindSessionImei accepts a 15-digit simulator id unchanged', () => {
  const session = {};
  const bound = bindSessionImei(session, '861397052547400');
  assert.equal(bound.protocolId, '9705254740');
  assert.equal(bound.imei, '861397052547400');
});

test('extractFullImeiFromPayload finds a 15-digit IMEI in CONFIG payloads', () => {
  assert.equal(
    extractFullImeiFromPayload(['861397052547492'], 'CONFIG,861397052547492'),
    '861397052547492'
  );
});
