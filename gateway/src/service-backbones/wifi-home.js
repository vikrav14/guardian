'use strict';

const SERVICE_CONTRACT = Object.freeze({
  serviceId: 'wifi-home',
  displayName: 'Wi-Fi home-presence detection',
  minimumPlan: 'family',
  lifecycle: 'backbone',
  enabledByDefault: false,
  customerVisible: true,
  protocolCommands: Object.freeze(['WIFIFENCE']),
  safetyControls: Object.freeze(['store no Wi-Fi password', 'hash or minimize network identifiers', 'owner-controlled enrollment', 'location fallback when confidence is low', 'home-status access limited to linked caregivers']),
  backendMilestones: Object.freeze(['enroll supported 2.4 GHz identifiers', 'normalize WIFIFENCE events', 'combine Wi-Fi and location confidence', 'persist bounded home-presence history']),
  frontendMilestones: Object.freeze(['guide 2.4 GHz home enrollment', 'show confidence and last update', 'explain location fallback', 'allow immediate network removal']),
  acceptanceGates: Object.freeze(['confirm WIFIFENCE syntax and event format on exact V52 firmware', 'verify identifier privacy at rest', 'test enter leave and router-restart cases', 'test phones with split and combined Wi-Fi SSIDs']),
});

module.exports = { SERVICE_CONTRACT };
