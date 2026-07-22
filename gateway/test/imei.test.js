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
  assert.equal(protocolIdFromFullImei('861397053141170'), '9705314117');
  assert.equal(protocolIdFromFullImei('861397053139877'), '9705313987');
});

test('fullImeiFromProtocolId derives the 15-digit IMEI for ReachFar V28C ids', () => {
  assert.equal(fullImeiFromProtocolId('9705314117'), '861397053141170');
});

test('normalizeImei prefers session fullImei when set', () => {
  const session = { fullImei: '861397053141170' };
  assert.equal(normalizeImei('9705314117', session), '861397053141170');
});

test('bindSessionImei maps a 10-digit frame id to canonical 15-digit imei', () => {
  const session = {};
  const bound = bindSessionImei(session, '9705314117');
  assert.equal(bound.protocolId, '9705314117');
  assert.equal(bound.imei, '861397053141170');
  assert.equal(session.fullImei, '861397053141170');
});

test('bindSessionImei accepts a 15-digit simulator id unchanged', () => {
  const session = {};
  const bound = bindSessionImei(session, '861397053139877');
  assert.equal(bound.protocolId, '9705313987');
  assert.equal(bound.imei, '861397053139877');
});

test('extractFullImeiFromPayload finds a 15-digit IMEI in CONFIG payloads', () => {
  assert.equal(
    extractFullImeiFromPayload(['861397053141170'], 'CONFIG,861397053141170'),
    '861397053141170'
  );
});
