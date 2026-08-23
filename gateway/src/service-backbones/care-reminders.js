'use strict';

const SERVICE_CONTRACT = Object.freeze({
  serviceId: 'care-reminders',
  displayName: 'Care routines and accessibility reminders',
  minimumPlan: 'care',
  lifecycle: 'implementation-disabled',
  enabledByDefault: false,
  customerVisible: false,
  protocolCommands: Object.freeze(['SEDENTARY', 'REMIND', 'HSW']),
  acceptedProtocolCommands: Object.freeze([]),
  safetyControls: Object.freeze([
    'Care-plan entitlement',
    'wearer-visible schedules',
    'quiet hours and rate limits',
    'caregiver change audit',
    'no claim that reminders prove adherence',
    'no device command until exact-V52 acceptance',
  ]),
  backendMilestones: Object.freeze([
    'canonical schedule validation',
    'quiet-hour evaluation',
    'delivery-versus-acknowledgement separation',
    'fail-closed device sync gate',
    'caregiver change audit',
  ]),
  frontendMilestones: Object.freeze([
    'hidden schedule presentation model',
    'show watch-sync state',
    'provide accessible clock options',
    'separate delivered from acknowledged',
  ]),
  acceptanceGates: Object.freeze([
    'confirm SEDENTARY REMIND and HSW syntax on exact V52 firmware',
    'verify display audio and vibration behaviour',
    'test overlapping reminders and reboots',
    'confirm the UI never invents acknowledgements',
  ]),
});

module.exports = { SERVICE_CONTRACT };
