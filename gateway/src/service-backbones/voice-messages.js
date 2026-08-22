'use strict';

const SERVICE_CONTRACT = Object.freeze({
  serviceId: 'voice-messages',
  displayName: 'Family voice messages',
  minimumPlan: 'family',
  lifecycle: 'backbone',
  enabledByDefault: false,
  customerVisible: true,
  protocolCommands: Object.freeze(['TK', 'AMR']),
  safetyControls: Object.freeze(['approved caregivers only', 'bounded clip duration and size', 'malware-safe media handling', 'private expiring storage', 'data-usage disclosure']),
  backendMilestones: Object.freeze(['ingest supported watch audio format', 'transcode only when required', 'store clips privately with expiry', 'deliver authenticated metadata and playback URLs']),
  frontendMilestones: Object.freeze(['record and send bounded voice clips', 'play received watch messages', 'show delivery and expiry state', 'show mobile-data disclosure']),
  acceptanceGates: Object.freeze(['confirm exact V52 uplink and downlink framing', 'validate codec and maximum payload on real hardware', 'measure data consumption', 'verify expired media cannot be fetched']),
});

module.exports = { SERVICE_CONTRACT };
