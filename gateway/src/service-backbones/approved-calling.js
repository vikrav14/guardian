'use strict';

const SERVICE_CONTRACT = Object.freeze({
  serviceId: 'approved-calling',
  displayName: 'Approved family calling',
  minimumPlan: 'essential',
  lifecycle: 'backbone',
  enabledByDefault: false,
  customerVisible: false,
  callDirection: 'approved-guardian-to-watch-only',
  protocolCommands: Object.freeze(['PHBX']),
  pendingProtocolCommands: Object.freeze(['DEVREFUSEPHONESWITCH']),
  safetyControls: Object.freeze([
    'incoming approved-contact allowlist',
    'administrator-only phonebook provisioning',
    'unknown callers blocked',
    'wearer outbound calling unavailable',
    'carrier voice-cost disclosure',
  ]),
  provenBehaviors: Object.freeze([
    'approved phonebook number rings watch',
    'unknown number is blocked',
    'clear two-way audio after wearer answers',
    'phonebook entry persists after reboot',
  ]),
  backendMilestones: Object.freeze([
    'persist approved contacts without client-written commands',
    'sync V52 phonebook through administrator-only provisioning',
    'verify safe-mode state on each new watch',
    'record provisioning and physical acceptance outcomes',
  ]),
  frontendMilestones: Object.freeze([
    'manage approved family contacts',
    'show call-watch action only',
    'explain that the wearer cannot call out',
    'show sync and failure states',
  ]),
  acceptanceGates: Object.freeze([
    'repeat approved and unknown incoming-call checks on a second production watch',
    'confirm safe replacement or removal with ReachFar',
    'complete privacy, billing and contact-management acceptance',
  ]),
});

module.exports = { SERVICE_CONTRACT };
