const PLAN = Object.freeze({
  ESSENTIAL: 'essential',
  FAMILY: 'family',
  CARE: 'care',
});

const FEATURE = Object.freeze({
  LIVE_GPS: 'live_gps',
  SOS_ALERTS: 'sos_alerts',
  LOCATION_HISTORY: 'location_history',
  TWO_WAY_CALLS: 'two_way_calls',
  SAFE_ZONES: 'safe_zones',
  BATTERY_ALERTS: 'battery_alerts',
  FAMILY_CAREGIVERS: 'family_caregivers',
  GUARDIAN_AI: 'guardian_ai',
  WHATSAPP_QA: 'whatsapp_questions_answers',
  WHATSAPP_SAFETY_ALERTS: 'whatsapp_safety_alerts',
  PROACTIVE_SMART_NOTIFICATIONS: 'proactive_smart_notifications',
  VOICE_ASSISTANT: 'voice_assistant',
  WHATSAPP_WATCH_COMMANDS: 'whatsapp_watch_commands',
  ACTIVITY_STEPS: 'activity_steps',
  MEDICATION_REMINDERS: 'medication_reminders',
  REMINDER_ACKNOWLEDGEMENTS: 'reminder_acknowledgements',
  WELLBEING_ACTIVITY_SUMMARIES: 'wellbeing_activity_summaries',
  WEEKLY_CARE_SUMMARIES: 'weekly_care_summaries',
  SHAREABLE_WELLBEING_REPORTS: 'shareable_wellbeing_reports',
  PROACTIVE_ROUTINE_ALERTS: 'proactive_routine_alerts',
  PRIORITY_SUPPORT: 'priority_support',
});

const ESSENTIAL_FEATURES = Object.freeze([
  FEATURE.LIVE_GPS,
  FEATURE.SOS_ALERTS,
  FEATURE.LOCATION_HISTORY,
  FEATURE.TWO_WAY_CALLS,
  FEATURE.SAFE_ZONES,
  FEATURE.BATTERY_ALERTS,
  FEATURE.FAMILY_CAREGIVERS,
]);

const FAMILY_FEATURES = Object.freeze([
  ...ESSENTIAL_FEATURES,
  FEATURE.GUARDIAN_AI,
  FEATURE.WHATSAPP_QA,
  FEATURE.WHATSAPP_SAFETY_ALERTS,
  FEATURE.PROACTIVE_SMART_NOTIFICATIONS,
  FEATURE.VOICE_ASSISTANT,
  FEATURE.WHATSAPP_WATCH_COMMANDS,
  FEATURE.ACTIVITY_STEPS,
]);

const CARE_FEATURES = Object.freeze([
  ...FAMILY_FEATURES,
  FEATURE.MEDICATION_REMINDERS,
  FEATURE.REMINDER_ACKNOWLEDGEMENTS,
  FEATURE.WELLBEING_ACTIVITY_SUMMARIES,
  FEATURE.WEEKLY_CARE_SUMMARIES,
  FEATURE.SHAREABLE_WELLBEING_REPORTS,
  FEATURE.PROACTIVE_ROUTINE_ALERTS,
  FEATURE.PRIORITY_SUPPORT,
]);

const PLAN_POLICY = Object.freeze({
  [PLAN.ESSENTIAL]: Object.freeze({
    label: 'Guardian Essential',
    features: ESSENTIAL_FEATURES,
    limits: Object.freeze({ caregivers: 1, locationHistoryDays: 7 }),
  }),
  [PLAN.FAMILY]: Object.freeze({
    label: 'Guardian Family',
    features: FAMILY_FEATURES,
    limits: Object.freeze({ caregivers: 5, locationHistoryDays: null }),
  }),
  [PLAN.CARE]: Object.freeze({
    label: 'Guardian Care',
    features: CARE_FEATURES,
    limits: Object.freeze({ caregivers: 5, locationHistoryDays: null }),
  }),
});

const TRUSTED_SUBSCRIPTION_MANAGERS = new Set([
  'guardian_admin',
  'billing',
  'migration',
]);

const ACCESS_STATUSES = new Set(['active', 'trialing', 'grace_period', 'past_due', 'cancelled']);

function asDate(value) {
  if (!value) return null;
  const date = value?.toDate?.() || (value instanceof Date ? value : new Date(value));
  return Number.isFinite(date?.getTime?.()) ? date : null;
}

function inactiveContext(reason, details = {}) {
  return Object.freeze({
    serviceActive: false,
    plan: null,
    planLabel: null,
    status: details.status || 'inactive',
    reason,
    ownerUid: details.ownerUid || null,
    accessThrough: null,
    features: Object.freeze([]),
    limits: Object.freeze({ caregivers: 0, locationHistoryDays: 0 }),
  });
}

function evaluateSubscription(subscription, { now = new Date(), ownerUid = null, accessThrough = 'owner' } = {}) {
  if (!subscription || typeof subscription !== 'object') {
    return inactiveContext('missing_subscription', { ownerUid });
  }

  const version = Number(subscription.version);
  const managedBy = String(subscription.managedBy || '').trim().toLowerCase();
  if (version !== 1 || !TRUSTED_SUBSCRIPTION_MANAGERS.has(managedBy)) {
    return inactiveContext('untrusted_legacy_subscription', { ownerUid });
  }

  const plan = String(subscription.plan || '').trim().toLowerCase();
  const policy = PLAN_POLICY[plan];
  if (!policy) return inactiveContext('unknown_plan', { ownerUid });

  const status = String(subscription.status || '').trim().toLowerCase();
  if (!ACCESS_STATUSES.has(status)) {
    return inactiveContext('inactive_subscription_status', { ownerUid, status });
  }

  const currentPeriodEnd = asDate(subscription.currentPeriodEnd);
  const trialEndsAt = asDate(subscription.trialEndsAt);
  const graceEndsAt = asDate(subscription.graceEndsAt);
  let active = false;
  let accessUntil = currentPeriodEnd;

  if (status === 'active') {
    active = !currentPeriodEnd || currentPeriodEnd > now;
  } else if (status === 'trialing') {
    active = Boolean(trialEndsAt && trialEndsAt > now);
    accessUntil = trialEndsAt;
  } else if (status === 'grace_period' || status === 'past_due') {
    active = Boolean(graceEndsAt && graceEndsAt > now);
    accessUntil = graceEndsAt;
  } else if (status === 'cancelled') {
    active = Boolean(currentPeriodEnd && currentPeriodEnd > now);
  }

  if (!active) {
    return inactiveContext('subscription_access_ended', { ownerUid, status });
  }

  return Object.freeze({
    serviceActive: true,
    plan,
    planLabel: policy.label,
    status,
    reason: null,
    ownerUid,
    accessThrough,
    accessUntil,
    features: policy.features,
    limits: policy.limits,
  });
}

function verifiedFamilyMember(owner, memberUid) {
  if (!owner || !memberUid) return false;
  // `familyMembers` is a legacy client-maintained display list and is not a
  // trustworthy authorization source. Only backend-managed memberUids can
  // grant inherited service access.
  return Array.isArray(owner.memberUids) && owner.memberUids
    .map(String)
    .includes(String(memberUid));
}

async function loadEntitlementsForUser(db, user, { now = new Date() } = {}) {
  if (!db || !user?.uid) return inactiveContext('missing_user');
  const ownerUid = String(user.serviceOwnerUid || user.uid);
  let accessThrough = 'owner';
  if (ownerUid === String(user.uid)) {
    accessThrough = 'owner';
  } else {
    const ownerSnap = await db.collection('users').doc(ownerUid).get();
    if (!ownerSnap.exists) return inactiveContext('service_owner_not_found', { ownerUid });
    const owner = { uid: ownerUid, ...(ownerSnap.data() || {}) };
    if (!verifiedFamilyMember(owner, user.uid)) {
      return inactiveContext('family_membership_not_verified', { ownerUid });
    }
    accessThrough = 'family_membership';
  }

  const subscriptionSnap = await db.collection('serviceSubscriptions').doc(ownerUid).get();
  if (!subscriptionSnap.exists) return inactiveContext('missing_subscription', { ownerUid });
  return evaluateSubscription(subscriptionSnap.data() || {}, {
    now,
    ownerUid,
    accessThrough,
  });
}

function hasEntitlement(context, feature) {
  return Boolean(context?.serviceActive && context.features?.includes(feature));
}

function minimumPlanFor(feature) {
  if (ESSENTIAL_FEATURES.includes(feature)) return PLAN.ESSENTIAL;
  if (FAMILY_FEATURES.includes(feature)) return PLAN.FAMILY;
  if (CARE_FEATURES.includes(feature)) return PLAN.CARE;
  return null;
}

function featureForWhatsAppIntent(intentType) {
  const type = String(intentType || '').trim().toUpperCase();
  if (type === 'ACTIVITY_QUERY') return FEATURE.ACTIVITY_STEPS;
  if (type === 'REMINDER_REQUEST') return FEATURE.MEDICATION_REMINDERS;
  if (type === 'DAILY_SUMMARY') return FEATURE.WELLBEING_ACTIVITY_SUMMARIES;
  if (type === 'DEVICE_COMMAND' || type === 'VOICE_MONITOR') {
    return FEATURE.WHATSAPP_WATCH_COMMANDS;
  }
  if (type === 'CRITICAL') return null;
  return FEATURE.WHATSAPP_QA;
}

function planBoundaryReply(context, feature) {
  if (!context?.serviceActive) {
    return 'Guardian service is not active for this family account. Open the Guardian app or contact Guardian support to review the subscription.';
  }
  const required = minimumPlanFor(feature);
  const requiredLabel = required ? PLAN_POLICY[required].label : 'a different Guardian plan';
  return `${requiredLabel} includes this service. Your ${context.planLabel} plan has not been changed.`;
}

module.exports = {
  PLAN,
  FEATURE,
  PLAN_POLICY,
  asDate,
  evaluateSubscription,
  loadEntitlementsForUser,
  hasEntitlement,
  minimumPlanFor,
  featureForWhatsAppIntent,
  planBoundaryReply,
  verifiedFamilyMember,
};
