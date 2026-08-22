'use strict';

const SERVICE_CONTRACT = Object.freeze({
  serviceId: 'care-reminders',
  displayName: 'Care routines and accessibility reminders',
  minimumPlan: 'care',
  lifecycle: 'backbone',
  enabledByDefault: false,
  customerVisible: true,
  protocolCommands: Object.freeze(['SEDENTARY', 'REMIND', 'HSW']),
  safetyControls: Object.freeze(['Care-plan entitlement', 'wearer-visible schedules', 'quiet hours and rate limits', 'caregiver change audit', 'no claim that reminders prove adherence']),
  backendMilestones: Object.freeze(['model sedentary and clock reminder schedules', 'validate firmware schedule limits', 'sync commands with per-item state', 'record delivery without inferring acknowledgement']),
  frontendMilestones: Object.freeze(['configure routines and quiet hours', 'show watch-sync state', 'provide accessible clock options', 'separate delivered from acknowledged']),
  acceptanceGates: Object.freeze(['confirm SEDENTARY REMIND and HSW syntax on exact V52 firmware', 'verify display audio and vibration behaviour', 'test overlapping reminders and reboots', 'confirm the UI never invents acknowledgements']),
});

module.exports = { SERVICE_CONTRACT };
