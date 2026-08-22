'use strict';

const SERVICE_CONTRACT = Object.freeze({
  serviceId: 'activity-steps',
  displayName: 'Steps and daily activity',
  minimumPlan: 'family',
  lifecycle: 'backbone',
  enabledByDefault: false,
  customerVisible: true,
  protocolCommands: Object.freeze(['PEDO', 'WALKTIME']),
  safetyControls: Object.freeze(['wearer-controlled activity visibility', 'timezone-aware day boundaries', 'counter-reset detection', 'no medical claims', 'bounded retention by plan']),
  backendMilestones: Object.freeze(['normalize pedometer uploads', 'aggregate steps and active minutes by local day', 'detect resets and implausible jumps', 'serve privacy-filtered daily and weekly summaries']),
  frontendMilestones: Object.freeze(['show steps and active-time cards', 'show last sync and data gaps', 'provide day and week views', 'explain estimates and non-medical status']),
  acceptanceGates: Object.freeze(['confirm PEDO and WALKTIME payloads on exact V52 firmware', 'compare watch counters against controlled walks', 'test midnight timezone and reboot resets', 'measure battery and data impact']),
});

module.exports = { SERVICE_CONTRACT };
