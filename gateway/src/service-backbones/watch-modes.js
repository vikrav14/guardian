'use strict';

const SERVICE_CONTRACT = Object.freeze({
  serviceId: 'watch-modes',
  displayName: 'Answer and scene controls',
  minimumPlan: 'family',
  lifecycle: 'backbone',
  enabledByDefault: false,
  customerVisible: true,
  protocolCommands: Object.freeze(['profile', 'APPLOCK', 'ACALL']),
  safetyControls: Object.freeze(['explicit caregiver authorization', 'safe default ring mode', 'time-bounded silent mode', 'wearer-visible state', 'audit every remote change']),
  backendMilestones: Object.freeze(['model supported answer and scene modes', 'validate mode transitions', 'dispatch supported profile commands', 'restore safe defaults after expiry']),
  frontendMilestones: Object.freeze(['show current watch mode', 'offer firmware-supported choices only', 'confirm silent-mode changes', 'show sync and expiry state']),
  acceptanceGates: Object.freeze(['accept Calls app flow after pilot Auto/Manual pass', 'verify caller exclusivity and unknown-caller rejection', 'verify ring vibrate and silent results', 'prove safe recovery after reboot and timeout']),
});

module.exports = { SERVICE_CONTRACT };
