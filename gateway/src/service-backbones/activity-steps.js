'use strict';

const SERVICE_CONTRACT = Object.freeze({
  serviceId: 'activity-steps',
  displayName: 'Steps and daily activity',
  minimumPlan: 'family',
  lifecycle: 'implementation_complete_disabled',
  enabledByDefault: false,
  customerVisible: false,
  protocolCommands: Object.freeze(['LK.stepsRaw', 'PEDO', 'WALKTIME']),
  safetyControls: Object.freeze(['wearer-controlled activity visibility', 'timezone-aware day boundaries', 'counter-reset detection', 'stale-packet rejection', 'no medical claims', 'fixed retention']),
  completedBackendCapabilities: Object.freeze(['normalize passive V52 counters', 'aggregate steps by local day', 'detect resets and implausible jumps', 'serve privacy-filtered daily and weekly summaries']),
  completedFrontendCapabilities: Object.freeze(['show accepted step cards', 'show last sync and data gaps', 'provide day and week views', 'explain estimates and non-medical status']),
  acceptanceGates: Object.freeze(['confirm raw counter semantics on exact V52 firmware', 'compare watch counters against controlled walks', 'test midnight timezone and reboot resets', 'measure battery and data impact']),
});

module.exports = { SERVICE_CONTRACT };
