'use strict';

const SERVICE_CONTRACT = Object.freeze({
  serviceId: 'audio-checkin',
  displayName: 'Consent-based audio safety check-in',
  minimumPlan: 'family',
  lifecycle: 'backbone',
  enabledByDefault: false,
  customerVisible: true,
  protocolCommands: Object.freeze(['MONITOR']),
  safetyControls: Object.freeze(['explicit household consent', 'approved guardians only', 'no recording or transcription', 'one active request at a time', 'rate limits and immutable audit']),
  backendMilestones: Object.freeze(['authorize each request', 'validate callback destination', 'dispatch time-limited monitor command', 'record requester and outcome']),
  frontendMilestones: Object.freeze(['show consent and privacy disclosure', 'require positive confirmation', 'show request and failure states', 'provide revoke-access control']),
  acceptanceGates: Object.freeze(['confirm exact V52 MONITOR behaviour and carrier charging', 'verify access denial for non-guardians', 'verify audit and rate limits', 'complete privacy and legal review before activation']),
});

module.exports = { SERVICE_CONTRACT };
