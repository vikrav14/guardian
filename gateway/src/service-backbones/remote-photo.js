'use strict';

const SERVICE_CONTRACT = Object.freeze({
  serviceId: 'remote-photo',
  displayName: 'Safety snapshot',
  minimumPlan: 'family',
  lifecycle: 'controlled_app_integration',
  enabledByDefault: false,
  customerVisible: false,
  protocolCommands: Object.freeze(['FTPIP', 'FTPPWD', 'PIC', 'rcapture']),
  acceptedProtocolCommands: Object.freeze(['rcapture']),
  safetyControls: Object.freeze([
    'explicit household consent',
    'approved guardians only',
    'one-time authorization bound to one device and requester',
    'private isolated media ingress',
    'short automatic expiry and immediate deletion',
    'request cooldown and immutable audit',
    'no live camera and no continuous capture',
  ]),
  backendMilestones: Object.freeze([
    'issue one-time safety snapshot authorization',
    'bind any upload to an unexpired authorization',
    'isolate media ingress from public storage',
    'validate media metadata before acceptance',
    'store private media with automatic expiry',
    'record request access expiry and deletion audit evidence',
  ]),
  frontendMilestones: Object.freeze([
    'require safety-purpose confirmation',
    'show requested waiting available expired and deleted states',
    'display capture time and expiry notice',
    'support immediate deletion',
    'never imply a snapshot proves the wearer is safe',
  ]),
  acceptanceGates: Object.freeze([
    'complete direct Guardian capture and deletion on each enabled V52',
    'prove whether the wearer receives a visible or audible capture indication',
    'verify upload transport image type size latency and SIM data use',
    'verify private ingress expiry deletion and access logging',
    'repeat on a second production-equivalent V52',
    'complete privacy security and product acceptance',
  ]),
});

module.exports = { SERVICE_CONTRACT };
