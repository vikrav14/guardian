'use strict';

const SERVICE_CONTRACT = Object.freeze({
  serviceId: 'approved-calling',
  displayName: 'Approved family calling',
  minimumPlan: 'essential',
  lifecycle: 'backbone',
  enabledByDefault: false,
  customerVisible: true,
  protocolCommands: Object.freeze(['CALL', 'PHBX', 'DEVREFUSEPHONESWITCH']),
  safetyControls: Object.freeze(['approved-contact allowlist', 'authenticated guardian changes', 'arbitrary dialling disabled by default', 'call attempt audit trail', 'carrier voice-cost disclosure']),
  backendMilestones: Object.freeze(['persist approved contacts', 'sync V52 phonebook and whitelist', 'dispatch wearer call requests safely', 'record command and call outcomes']),
  frontendMilestones: Object.freeze(['manage approved family contacts', 'show call-watch and allowed-call actions', 'explain carrier voice usage', 'show sync and failure states']),
  acceptanceGates: Object.freeze(['confirm exact V52 command forms on the target firmware', 'verify wearer-to-approved-contact and guardian-to-watch calls', 'verify unknown-number rejection behaviour', 'test two supported SIM/carrier configurations']),
});

module.exports = { SERVICE_CONTRACT };
