'use strict';

const { normalizeCallingPhone } = require('./commands');

const AUDIO_CHECKIN_REASON = Object.freeze({
  READY: 'ready',
  FEATURE_DISABLED: 'feature_disabled',
  SERVICE_INACTIVE: 'service_inactive',
  PLAN_REQUIRED: 'plan_required',
  ACCESS_DENIED: 'access_denied',
  DESTINATION_OVERRIDE_FORBIDDEN: 'destination_override_forbidden',
  CONSENT_REQUIRED: 'consent_required',
  DESTINATION_UNVERIFIED: 'destination_unverified',
  PROTOCOL_UNACCEPTED: 'protocol_unaccepted',
  ACTIVE_REQUEST: 'active_request',
  RATE_LIMITED: 'rate_limited',
});

const ACCEPTED_PROTOCOL_VARIANTS = new Set([
  'master',
  'explicit_destination',
]);

function result(allowed, reason, details = {}) {
  return Object.freeze({ allowed, reason, ...details });
}

function validDate(value) {
  if (!value) return false;
  const date = value?.toDate?.() || (value instanceof Date ? value : new Date(value));
  return Number.isFinite(date?.getTime?.());
}

/**
 * Fail-closed eligibility check for the future audio safety check-in service.
 *
 * This function deliberately does not send MONITOR. It accepts only a
 * backend-owned verifiedCallback record; a phone supplied in the customer
 * request is always rejected. The feature flag and physical protocol gate
 * must both be explicitly opened by later, evidence-backed work.
 */
function evaluateAudioCheckinEligibility({
  featureEnabled = false,
  entitlements,
  request,
  requester,
  consentGrant,
  verifiedCallback,
  protocolAcceptance,
  hasActiveRequest = false,
  requestsInWindow = 0,
  maxRequestsPerWindow = 2,
} = {}) {
  if (featureEnabled !== true) {
    return result(false, AUDIO_CHECKIN_REASON.FEATURE_DISABLED);
  }

  if (entitlements?.serviceActive !== true) {
    return result(false, AUDIO_CHECKIN_REASON.SERVICE_INACTIVE);
  }

  if (!['family', 'care'].includes(String(entitlements?.plan || '').toLowerCase())) {
    return result(false, AUDIO_CHECKIN_REASON.PLAN_REQUIRED);
  }

  const imei = String(request?.imei || '');
  const requesterUid = String(requester?.uid || '');
  const requesterRole = String(requester?.role || '').toLowerCase();
  const linkedImeis = Array.isArray(requester?.linkedImeis)
    ? requester.linkedImeis.map(String)
    : [];

  if (
    !imei ||
    !requesterUid ||
    !['guardian', 'admin'].includes(requesterRole) ||
    !linkedImeis.includes(imei)
  ) {
    return result(false, AUDIO_CHECKIN_REASON.ACCESS_DENIED);
  }

  if (
    Object.hasOwn(request || {}, 'phone') ||
    Object.hasOwn(request || {}, 'callbackPhone') ||
    Object.hasOwn(request || {}, 'destination')
  ) {
    return result(false, AUDIO_CHECKIN_REASON.DESTINATION_OVERRIDE_FORBIDDEN);
  }

  if (
    consentGrant?.status !== 'granted' ||
    String(consentGrant?.imei || '') !== imei ||
    !validDate(consentGrant?.wearerConfirmedAt) ||
    consentGrant?.revokedAt
  ) {
    return result(false, AUDIO_CHECKIN_REASON.CONSENT_REQUIRED);
  }

  let callbackPhone;
  try {
    callbackPhone = normalizeCallingPhone(verifiedCallback?.phone);
  } catch {
    callbackPhone = null;
  }
  if (
    !callbackPhone ||
    String(verifiedCallback?.ownerUid || '') !== requesterUid ||
    !validDate(verifiedCallback?.verifiedAt) ||
    verifiedCallback?.revokedAt
  ) {
    return result(false, AUDIO_CHECKIN_REASON.DESTINATION_UNVERIFIED);
  }

  const protocolVariant = String(protocolAcceptance?.variant || '');
  if (
    protocolAcceptance?.status !== 'accepted' ||
    !ACCEPTED_PROTOCOL_VARIANTS.has(protocolVariant)
  ) {
    return result(false, AUDIO_CHECKIN_REASON.PROTOCOL_UNACCEPTED);
  }

  if (hasActiveRequest === true) {
    return result(false, AUDIO_CHECKIN_REASON.ACTIVE_REQUEST);
  }

  const limit = Number(maxRequestsPerWindow);
  const attempts = Number(requestsInWindow);
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    !Number.isInteger(attempts) ||
    attempts < 0 ||
    attempts >= limit
  ) {
    return result(false, AUDIO_CHECKIN_REASON.RATE_LIMITED);
  }

  return result(true, AUDIO_CHECKIN_REASON.READY, {
    imei,
    requesterUid,
    callbackPhone,
    protocolVariant,
  });
}

module.exports = {
  AUDIO_CHECKIN_REASON,
  evaluateAudioCheckinEligibility,
};
