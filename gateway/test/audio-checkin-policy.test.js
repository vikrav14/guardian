'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  AUDIO_CHECKIN_REASON,
  evaluateAudioCheckinEligibility,
} = require('../src/audio-checkin-policy');

const IMEI = '999999999999999';
const UID = 'guardian-test-user';

function acceptedInput(overrides = {}) {
  return {
    featureEnabled: true,
    entitlements: { serviceActive: true, plan: 'family' },
    request: { imei: IMEI },
    requester: { uid: UID, role: 'guardian', linkedImeis: [IMEI] },
    consentGrant: {
      status: 'granted',
      imei: IMEI,
      wearerConfirmedAt: '2026-08-23T00:00:00.000Z',
    },
    verifiedCallback: {
      ownerUid: UID,
      phone: '+99912345678',
      verifiedAt: '2026-08-23T00:05:00.000Z',
    },
    protocolAcceptance: {
      status: 'accepted',
      variant: 'explicit_destination',
    },
    hasActiveRequest: false,
    requestsInWindow: 0,
    maxRequestsPerWindow: 2,
    ...overrides,
  };
}

test('audio check-in is denied by default even when every other gate passes', () => {
  const decision = evaluateAudioCheckinEligibility({
    ...acceptedInput(),
    featureEnabled: false,
  });
  assert.deepEqual(decision, {
    allowed: false,
    reason: AUDIO_CHECKIN_REASON.FEATURE_DISABLED,
  });
});

test('accepted Family request returns only the backend-verified destination', () => {
  const decision = evaluateAudioCheckinEligibility(acceptedInput());
  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, AUDIO_CHECKIN_REASON.READY);
  assert.equal(decision.callbackPhone, '+99912345678');
  assert.equal(decision.protocolVariant, 'explicit_destination');
  assert.ok(Object.isFrozen(decision));
});

test('Essential plan cannot use the Family audio check-in backbone', () => {
  const decision = evaluateAudioCheckinEligibility(acceptedInput({
    entitlements: { serviceActive: true, plan: 'essential' },
  }));
  assert.equal(decision.reason, AUDIO_CHECKIN_REASON.PLAN_REQUIRED);
});

test('unlinked and non-guardian requesters fail authorization', () => {
  for (const requester of [
    { uid: UID, role: 'guardian', linkedImeis: [] },
    { uid: UID, role: 'emergency_contact', linkedImeis: [IMEI] },
  ]) {
    const decision = evaluateAudioCheckinEligibility(acceptedInput({ requester }));
    assert.equal(decision.reason, AUDIO_CHECKIN_REASON.ACCESS_DENIED);
  }
});

test('a customer request can never override the callback destination', () => {
  const decision = evaluateAudioCheckinEligibility(acceptedInput({
    request: { imei: IMEI, callbackPhone: '+99987654321' },
  }));
  assert.equal(decision.reason, AUDIO_CHECKIN_REASON.DESTINATION_OVERRIDE_FORBIDDEN);
});

test('consent, verified callback and physical protocol acceptance each fail closed', () => {
  const cases = [
    {
      patch: { consentGrant: { status: 'revoked', imei: IMEI } },
      reason: AUDIO_CHECKIN_REASON.CONSENT_REQUIRED,
    },
    {
      patch: { verifiedCallback: { ownerUid: UID, phone: '+99912345678' } },
      reason: AUDIO_CHECKIN_REASON.DESTINATION_UNVERIFIED,
    },
    {
      patch: { protocolAcceptance: { status: 'pending', variant: 'master' } },
      reason: AUDIO_CHECKIN_REASON.PROTOCOL_UNACCEPTED,
    },
  ];

  for (const { patch, reason } of cases) {
    assert.equal(
      evaluateAudioCheckinEligibility(acceptedInput(patch)).reason,
      reason,
    );
  }
});

test('concurrency and rate limits deny dispatch eligibility', () => {
  assert.equal(
    evaluateAudioCheckinEligibility(acceptedInput({ hasActiveRequest: true })).reason,
    AUDIO_CHECKIN_REASON.ACTIVE_REQUEST,
  );
  assert.equal(
    evaluateAudioCheckinEligibility(acceptedInput({ requestsInWindow: 2 })).reason,
    AUDIO_CHECKIN_REASON.RATE_LIMITED,
  );
});
