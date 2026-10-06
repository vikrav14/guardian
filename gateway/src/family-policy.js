'use strict';

// Versioned commercial policy: changing this table does not rewrite a contract.
const POLICY_VERSION = '2026-10';
const PLANS = Object.freeze({
  family: Object.freeze({ monthlyMur: 1000, people: 3, whatsappRecipients: 2, answers: 50 }),
  care: Object.freeze({ monthlyMur: 1300, people: 5, whatsappRecipients: 3, answers: 100 }),
});
const PERMISSIONS = Object.freeze([
  'location', 'alerts', 'history', 'wellbeing', 'voice', 'reminders', 'zones', 'settings', 'photos',
]);
const PRESETS = Object.freeze({
  caregiver: ['location', 'alerts', 'voice'],
  viewer: ['location', 'alerts'],
  alerts: ['alerts'],
});
class FamilyError extends Error {
  constructor(code, status = 409) { super(code); this.code = code; this.status = status; }
}
const fail = (code, status) => { throw new FamilyError(code, status); };
const millis = value => value?.toMillis?.() ?? (value == null ? null : +new Date(value));
const emailKey = value => String(value || '').trim().toLowerCase();
function permissions(role, overrides = {}) {
  if (!Object.hasOwn(PRESETS, role)) fail('invalid_role', 400);
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides) ||
      Object.keys(overrides).some(key => !PERMISSIONS.includes(key) || typeof overrides[key] !== 'boolean'))
    fail('invalid_permissions', 400);
  const result = Object.fromEntries(PERMISSIONS.map(key => [key, overrides[key] ?? PRESETS[role].includes(key)]));
  // History and zone configuration reveal locations themselves.
  if ((result.history || result.zones) && !result.location) fail('location_required', 400);
  return result;
}
function activeMember(service, uid, now = Date.now()) {
  const member = service?.members?.[uid];
  if (!member || member.status !== 'active' || (member.untilMs != null && member.untilMs <= now)) return null;
  return member;
}
function can(service, uid, permission, now = Date.now()) {
  const member = activeMember(service, uid, now);
  return !!member && (service.ownerUid === uid || member.permissions?.[permission] === true);
}
function policy(service) {
  if (service?.policyVersion !== POLICY_VERSION || !PLANS[service?.subscription?.plan]) fail('service_needs_review', 403);
  return PLANS[service.subscription.plan];
}
function activePeople(service, now = Date.now()) {
  return Object.keys(service?.members || {}).filter(uid => activeMember(service, uid, now));
}
function checkOwner(service, uid, now) {
  if (service?.ownerUid !== uid || !activeMember(service, uid, now)) fail('owner_required', 403);
}
function checkCapacity(service, now) {
  if (activePeople(service, now).length >= policy(service).people) fail('people_limit_reached');
}
function memberPatch(input, now = Date.now()) {
  const untilMs = input.untilMs ?? null;
  if (untilMs != null && (!Number.isSafeInteger(untilMs) || untilMs <= now || untilMs > now + 366 * 86400000))
    fail('invalid_access_expiry', 400);
  return { role: input.role, permissions: permissions(input.role, input.permissions), untilMs };
}
function serviceEntitlements(service, now = Date.now()) {
  return require('./entitlements').evaluateSubscription(service?.subscription, {
    now: new Date(now), ownerUid: service?.ownerUid,
  });
}
async function watchAccess(db, uid, imei, permission, { read = ref => ref.get(), now = Date.now() } = {}) {
  const snapshot = await read(db.collection('familyServices').doc(imei));
  if (!snapshot.exists) return { managed: false };
  const service = snapshot.data();
  const entitlements = serviceEntitlements(service, now);
  if (!entitlements.serviceActive || !can(service, uid, permission, now)) fail('access_not_shared', 403);
  return { managed: true, service, entitlements };
}
function monthKey(now = Date.now()) {
  // Contract allowance resets at midnight on the first in Mauritius (UTC+4).
  return new Date(now + 4 * 3600000).toISOString().slice(0, 7);
}
module.exports = { POLICY_VERSION, PLANS, PERMISSIONS, PRESETS, FamilyError, fail, millis,
  emailKey, permissions, activeMember, activePeople, can, policy, checkOwner,
  checkCapacity, memberPatch, serviceEntitlements, watchAccess, monthKey };
