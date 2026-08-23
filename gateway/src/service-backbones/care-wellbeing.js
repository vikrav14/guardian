'use strict';

const SERVICE_CONTRACT = Object.freeze({
  serviceId: 'care-wellbeing',
  displayName: 'Care wellbeing readings',
  minimumPlan: 'care',
  lifecycle: 'device_acceptance',
  enabledByDefault: false,
  customerVisible: false,
  protocolCommands: Object.freeze(['bphrt', 'oxygen', 'hrtstart']),
  acceptedUploads: Object.freeze(['bphrt', 'oxygen']),
  pilotOnlyRequests: Object.freeze(['hrtstart,1']),
  blockedUntilCaptured: Object.freeze(['bodytemp', 'bodytemp2', 'BTTIMESET']),
  safetyControls: Object.freeze(['non-medical wording', 'no diagnosis or emergency clearance', 'durable wearer consent', 'measurement quality and freshness labels', 'no automatic normal or abnormal classification']),
  backendMilestones: Object.freeze(['consent-gated ingestion', 'normalize confirmed heart blood pressure and SpO2 uploads', 'store source quality freshness and retention', 'provide deterministic Care-only reads']),
  frontendMilestones: Object.freeze(['show accepted wearer-initiated measurements', 'show quality freshness and device limitations', 'keep customer UI compile-disabled', 'direct concerns to a human or appropriate medical help']),
  acceptanceGates: Object.freeze(['confirm every command and upload shape on exact V52 firmware', 'compare repeated readings for consistency only', 'complete medical-language and privacy review', 'test missing stale implausible and failed measurements']),
});

module.exports = { SERVICE_CONTRACT };
