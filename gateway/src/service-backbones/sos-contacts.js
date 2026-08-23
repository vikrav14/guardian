'use strict';

const SERVICE_CONTRACT = Object.freeze({
  serviceId: 'sos-contacts',
  displayName: 'Multi-contact SOS routing',
  minimumPlan: 'essential',
  lifecycle: 'backbone',
  enabledByDefault: false,
  customerVisible: true,
  protocolCommands: Object.freeze(['SOS1', 'SOS2', 'SOS3']),
  safetyControls: Object.freeze(['one verified primary guardian', 'explicit contact ordering', 'deduplicate phone numbers', 'failed-sync visibility', 'full contact-change audit']),
  backendMilestones: Object.freeze(['persist ordered SOS contacts', 'validate and normalize numbers', 'sync SOS1 through SOS3', 'surface per-slot sync status']),
  frontendMilestones: Object.freeze(['edit and reorder SOS contacts', 'show primary and fallback roles', 'show device-sync state', 'link callback behaviour to PR #109']),
  acceptanceGates: Object.freeze(['confirm SOS1/SOS2/SOS3 support on exact V52 firmware', 'verify fallback order with controlled test numbers', 'verify coexistence with PR #109 callback alarm mode', 'confirm no unapproved number is written']),
});

module.exports = { SERVICE_CONTRACT };
