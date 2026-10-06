'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PLANS, POLICY_VERSION, permissions, can, checkCapacity, memberPatch, monthKey } = require('../src/family-policy');
const { deviceView } = require('../src/family-device-view');
test('new per-watch limits count the owner and leave legacy contracts separate', () => {
  assert.deepEqual(PLANS.family, { monthlyMur: 1000, people: 3, whatsappRecipients: 2, answers: 50 });
  assert.deepEqual(PLANS.care, { monthlyMur: 1300, people: 5, whatsappRecipients: 3, answers: 100 });
  const service = { policyVersion: POLICY_VERSION, subscription: { plan: 'family' }, members: {
    owner: { status: 'active' }, one: { status: 'active' }, two: { status: 'active' },
  } };
  assert.throws(() => checkCapacity(service), /people_limit_reached/);
  // No function removes existing people, even after an edition downgrade.
  assert.equal(Object.keys(service.members).length, 3);
});
test('roles start with least privilege and reject unknown permissions/dependencies', () => {
  assert.equal(permissions('viewer').history, false);
  assert.equal(permissions('caregiver').settings, false);
  assert.equal(permissions('alerts').location, false);
  assert.throws(() => permissions('owner'), /invalid_role/);
  assert.throws(() => permissions('viewer', { billing: true }), /invalid_permissions/);
  assert.throws(() => permissions('viewer', { history: true, location: false }), /location_required/);
});
test('revoked, expired and cross-wearer access fails, including the owner record', () => {
  const service = { ownerUid: 'owner', members: {
    owner: { status: 'active' }, member: { status: 'active', permissions: permissions('viewer'), untilMs: 100 },
  } };
  assert.equal(can(service, 'owner', 'photos', 200), true);
  assert.equal(can(service, 'member', 'location', 99), true);
  assert.equal(can(service, 'member', 'history', 99), false);
  assert.equal(can(service, 'member', 'location', 100), false);
  assert.equal(can({ ...service, members: {} }, 'member', 'location', 99), false);
  service.members.member.status = 'revoked';
  assert.equal(can(service, 'member', 'location', 99), false);
  assert.throws(() => memberPatch({ role: 'viewer', untilMs: 10 }, 20), /invalid_access_expiry/);
});
test('allowance resets on the Mauritius month boundary', () => {
  assert.equal(monthKey(Date.parse('2026-10-31T19:59:59Z')), '2026-10');
  assert.equal(monthKey(Date.parse('2026-10-31T20:00:00Z')), '2026-11');
});
test('shared device view excludes wellbeing, configuration and diagnostic data', () => {
  assert.deepEqual(deviceView({ imei: '123', nickname: 'Wearer', batteryPercent: 52,
    intelligence: { private: true }, stepsRaw: 42, careProfile: 'senior', simNumber: 'private',
    token: 'private', capabilities: ['private'] }), { imei: '123', nickname: 'Wearer', batteryPercent: 52 });
});
