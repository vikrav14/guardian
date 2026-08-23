'use strict';

const SERVICE_CONTRACT = Object.freeze({
  serviceId: 'audio-checkin',
  displayName: 'Consent-based audio safety check-in',
  minimumPlan: 'family',
  lifecycle: 'backbone',
  enabledByDefault: false,
  customerVisible: false,
  protocolCommands: Object.freeze(['MONITOR']),
  documentedProtocolVariants: Object.freeze(['MONITOR', 'MONITOR,<verified callback>']),
  protocolEvidence: 'vendor-conflict-unproven',
  safetyControls: Object.freeze(['explicit household consent', 'approved guardians only', 'no recording or transcription', 'one active request at a time', 'rate limits and immutable audit']),
  backendMilestones: Object.freeze(['authorize each request', 'load a backend-verified callback destination', 'rate-limit command initiation', 'record requester, socket handoff and physical outcome']),
  frontendMilestones: Object.freeze(['show consent and privacy disclosure', 'require positive confirmation', 'show request and failure states', 'provide revoke-access control']),
  acceptanceGates: Object.freeze(['resolve the conflicting V52 MONITOR variants on physical hardware', 'confirm wearer indication, callback behaviour and carrier charging', 'verify access denial for non-guardians', 'verify audit and rate limits', 'complete privacy and legal review before activation']),
});

module.exports = { SERVICE_CONTRACT };
