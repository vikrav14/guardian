'use strict';

const SERVICE_CONTRACT = Object.freeze({
  serviceId: 'admin-controls',
  displayName: 'Protected V52 device administration',
  minimumPlan: 'operator',
  lifecycle: 'backbone',
  enabledByDefault: false,
  customerVisible: false,
  protocolCommands: Object.freeze(['VERNO', 'RESET', 'POWEROFF', 'FACTORY', 'gprsgps', 'LZ', 'UPGRADE', 'APN', 'IP', 'PW', 'ANY', 'CENTER', 'SLAVE']),
  safetyControls: Object.freeze(['operator role only', 'step-up authentication', 'typed confirmation for destructive commands', 'immutable audit and reason code', 'rate limits rollback and recovery runbook']),
  backendMilestones: Object.freeze(['separate diagnostics from destructive operations', 'validate command-specific arguments', 'queue commands with approval state', 'record actor reason result and recovery status']),
  frontendMilestones: Object.freeze(['hide from customer navigation', 'provide operator capability and risk labels', 'require confirmation and reason', 'show command lifecycle and recovery guidance']),
  acceptanceGates: Object.freeze(['confirm each command against exact V52 firmware and vendor support', 'prove customer accounts cannot discover or invoke controls', 'exercise reset power-off and upgrade only on lab hardware', 'complete rollback incident and recovery drills']),
});

module.exports = { SERVICE_CONTRACT };
