'use strict';

const SERVICE_CONTRACT = Object.freeze({
  serviceId: 'removal-alerts',
  displayName: 'Watch-removal safety alerts',
  minimumPlan: 'family',
  lifecycle: 'implementation_disabled',
  enabledByDefault: false,
  customerVisible: false,
  protocolCommands: Object.freeze(['REMOVESMS']),
  safetyControls: Object.freeze(['wearer-visible configuration', 'debounced removal events', 'configurable quiet periods', 'alert deduplication', 'privacy-safe event audit']),
  backendMilestones: Object.freeze(['accept backend-owned removal settings', 'normalize protocol alarm bit 20', 'debounce and persist state transitions', 'route accepted alerts by verified plan and caregiver']),
  frontendMilestones: Object.freeze(['read accepted removal state', 'show removal and restored states', 'explain false-positive handling', 'show alert delivery history']),
  acceptanceGates: Object.freeze(['confirm REMOVESMS syntax on exact V52 firmware', 'measure wrist-off detection and restore timing', 'test sleep and charging false positives', 'verify only linked caregivers receive alerts']),
});

module.exports = { SERVICE_CONTRACT };
