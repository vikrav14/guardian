'use strict';

const SERVICE_CONTRACT = Object.freeze({
  serviceId: 'remote-photo',
  displayName: 'Secure safety photo requests',
  minimumPlan: 'family',
  lifecycle: 'backbone',
  enabledByDefault: false,
  customerVisible: true,
  protocolCommands: Object.freeze(['FTPIP', 'FTPPWD', 'PIC']),
  safetyControls: Object.freeze(['explicit household consent', 'approved guardians only', 'private isolated media ingress', 'short automatic expiry', 'request rate limits and immutable audit']),
  backendMilestones: Object.freeze(['issue one-time photo request authorization', 'isolate V52 FTP ingress from public storage', 'validate and scan uploads', 'store encrypted media with automatic expiry']),
  frontendMilestones: Object.freeze(['require safety-purpose confirmation', 'show request and upload progress', 'display access and expiry notice', 'support immediate photo deletion']),
  acceptanceGates: Object.freeze(['confirm FTPIP FTPPWD and PIC behaviour on exact V52 firmware', 'complete privacy and security review', 'verify upload isolation and expiry', 'measure image size latency and SIM data use']),
});

module.exports = { SERVICE_CONTRACT };
