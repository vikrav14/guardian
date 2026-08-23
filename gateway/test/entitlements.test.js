const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PLAN, FEATURE, PLAN_POLICY, evaluateSubscription, loadEntitlementsForUser,
  hasEntitlement, minimumPlanFor, featureForWhatsAppIntent,
} = require('../src/entitlements');

const NOW = new Date('2026-08-14T00:00:00Z');

function subscription(plan, status = 'active', extra = {}) {
  return { version: 1, managedBy: 'guardian_admin', plan, status, ...extra };
}

function fakeDb(users, subscriptions = {}) {
  return {
    collection(name) {
      return {
        doc(uid) {
          return {
            async get() {
              const data = name === 'users' ? users[uid] : subscriptions[uid];
              return { exists: Boolean(data), data: () => data };
            },
          };
        },
      };
    },
  };
}

test('plan catalogue exactly inherits advertised services and limits', () => {
  assert.equal(PLAN_POLICY.essential.limits.caregivers, 1);
  assert.equal(PLAN_POLICY.essential.limits.locationHistoryDays, 7);
  assert.equal(PLAN_POLICY.family.limits.caregivers, 5);
  assert.equal(PLAN_POLICY.family.limits.locationHistoryDays, null);
  assert.equal(PLAN_POLICY.care.limits.caregivers, 5);
  for (const feature of PLAN_POLICY.essential.features) {
    assert.equal(PLAN_POLICY.family.features.includes(feature), true, feature);
  }
  for (const feature of PLAN_POLICY.family.features) {
    assert.equal(PLAN_POLICY.care.features.includes(feature), true, feature);
  }
});

test('missing and legacy client-writable subscriptions fail closed', () => {
  assert.equal(evaluateSubscription(null, { now: NOW }).serviceActive, false);
  assert.equal(evaluateSubscription({ tier: 'premium', status: 'active' }, { now: NOW }).reason, 'untrusted_legacy_subscription');
});

test('active Essential receives core services but no WhatsApp', () => {
  const result = evaluateSubscription(subscription(PLAN.ESSENTIAL), { now: NOW });
  assert.equal(hasEntitlement(result, FEATURE.LIVE_GPS), true);
  assert.equal(hasEntitlement(result, FEATURE.WHATSAPP_QA), false);
  assert.equal(hasEntitlement(result, FEATURE.MEDICATION_REMINDERS), false);
});

test('Family receives WhatsApp but not Care medication services', () => {
  const result = evaluateSubscription(subscription(PLAN.FAMILY), { now: NOW });
  assert.equal(hasEntitlement(result, FEATURE.WHATSAPP_QA), true);
  assert.equal(hasEntitlement(result, FEATURE.WHATSAPP_WATCH_COMMANDS), true);
  assert.equal(hasEntitlement(result, FEATURE.WATCH_REMOVAL_ALERTS), true);
  assert.equal(hasEntitlement(result, FEATURE.MEDICATION_REMINDERS), false);
});

test('Care receives all inherited and care-only services', () => {
  const result = evaluateSubscription(subscription(PLAN.CARE), { now: NOW });
  for (const feature of PLAN_POLICY.care.features) assert.equal(hasEntitlement(result, feature), true, feature);
});

test('trial, grace, past-due and cancelled access require a future boundary', () => {
  const future = new Date('2026-08-15T00:00:00Z');
  const past = new Date('2026-08-13T00:00:00Z');
  assert.equal(evaluateSubscription(subscription(PLAN.FAMILY, 'trialing', { trialEndsAt: future }), { now: NOW }).serviceActive, true);
  assert.equal(evaluateSubscription(subscription(PLAN.FAMILY, 'trialing', { trialEndsAt: past }), { now: NOW }).serviceActive, false);
  assert.equal(evaluateSubscription(subscription(PLAN.FAMILY, 'past_due', { graceEndsAt: future }), { now: NOW }).serviceActive, true);
  assert.equal(evaluateSubscription(subscription(PLAN.FAMILY, 'grace_period', { graceEndsAt: past }), { now: NOW }).serviceActive, false);
  assert.equal(evaluateSubscription(subscription(PLAN.FAMILY, 'cancelled', { currentPeriodEnd: future }), { now: NOW }).serviceActive, true);
  assert.equal(evaluateSubscription(subscription(PLAN.FAMILY, 'cancelled', { currentPeriodEnd: past }), { now: NOW }).serviceActive, false);
});

test('family caregiver inherits the verified service owner plan', async () => {
  const db = fakeDb({
    owner: {
      memberUids: ['member'],
    },
  }, { owner: subscription(PLAN.CARE) });
  const result = await loadEntitlementsForUser(db, { uid: 'member', serviceOwnerUid: 'owner' }, { now: NOW });
  assert.equal(result.plan, PLAN.CARE);
  assert.equal(result.ownerUid, 'owner');
  assert.equal(result.accessThrough, 'family_membership');
});

test('forged service owner relationship fails closed', async () => {
  const db = fakeDb({
    owner: {
      memberUids: [],
      familyMembers: [{ uid: 'attacker', displayName: 'Forged display member' }],
    },
  }, { owner: subscription(PLAN.CARE) });
  const result = await loadEntitlementsForUser(db, { uid: 'attacker', serviceOwnerUid: 'owner' }, { now: NOW });
  assert.equal(result.serviceActive, false);
  assert.equal(result.reason, 'family_membership_not_verified');
});

test('minimum plan is deterministic for every advertised feature', () => {
  assert.equal(minimumPlanFor(FEATURE.LIVE_GPS), PLAN.ESSENTIAL);
  assert.equal(minimumPlanFor(FEATURE.WHATSAPP_QA), PLAN.FAMILY);
  assert.equal(minimumPlanFor(FEATURE.MEDICATION_REMINDERS), PLAN.CARE);
});

test('WhatsApp intent mapping protects Care-only summaries and reminders', () => {
  assert.equal(featureForWhatsAppIntent('LOCATION_REQUEST'), FEATURE.WHATSAPP_QA);
  assert.equal(featureForWhatsAppIntent('DEVICE_COMMAND'), FEATURE.WHATSAPP_WATCH_COMMANDS);
  assert.equal(featureForWhatsAppIntent('REMINDER_REQUEST'), FEATURE.MEDICATION_REMINDERS);
  assert.equal(featureForWhatsAppIntent('DAILY_SUMMARY'), FEATURE.WELLBEING_ACTIVITY_SUMMARIES);
  assert.equal(featureForWhatsAppIntent('CRITICAL'), null);
});
