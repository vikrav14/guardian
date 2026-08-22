'use strict';

const SERVICE_CONTRACT = Object.freeze({
  serviceId: 'removal-alerts',
  displayName: 'Watch-removal safety alerts',
  minimumPlan: 'family',
  lifecycle: 'backbone',
  enabledByDefault: false,
  customerVisible: true,
  protocolCommands: Object.freeze(['REMOVESMS']),
  safetyControls: Object.freeze(['wearer-visible configuration', 'debounced removal events', 'configurable quiet periods', 'alert deduplication', 'privacy-safe event audit']),
  backendMilestones: Object.freeze(['manage removal detection settings', 'normalize protocol alarm bit 20', 'deduplicate and persist events', 'route alerts by verified plan and caregiver']),
  frontendMilestones: Object.freeze(['configure removal alerts', 'show removal and restored states', 'explain false-positive handling', 'show alert delivery history']),
  acceptanceGates: Object.freeze(['confirm REMOVESMS syntax on exact V52 firmware', 'measure wrist-off detection and restore timing', 'test sleep and charging false positives', 'verify only linked caregivers receive alerts']),
});

module.exports = { SERVICE_CONTRACT };
