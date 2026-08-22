'use strict';

const SERVICE_CONTRACT = Object.freeze({
  serviceId: 'care-wellbeing',
  displayName: 'Care wellbeing readings',
  minimumPlan: 'care',
  lifecycle: 'backbone',
  enabledByDefault: false,
  customerVisible: true,
  protocolCommands: Object.freeze(['hrtstart', 'oxygen', 'bodytemp', 'bodytemp2', 'BTTIMESET']),
  safetyControls: Object.freeze(['wellness-only wording', 'no diagnosis or emergency clearance', 'explicit wearer consent', 'measurement quality and freshness labels', 'clinically unsafe values trigger human-check guidance']),
  backendMilestones: Object.freeze(['authorize on-demand measurements', 'normalize heart blood pressure SpO2 and temperature uploads', 'store source quality and freshness', 'produce bounded trends without diagnostic interpretation']),
  frontendMilestones: Object.freeze(['request supported measurements', 'show quality freshness and device limitations', 'display trends with non-medical disclosure', 'direct concerning situations to appropriate human help']),
  acceptanceGates: Object.freeze(['confirm every command and upload shape on exact V52 firmware', 'compare repeated readings for consistency only', 'complete medical-language and privacy review', 'test missing stale implausible and failed measurements']),
});

module.exports = { SERVICE_CONTRACT };
