'use strict';
const { asBool } = require('./safety-snapshot-runtime');

// App capture access and approval to use new Meta copy are separate decisions.
// Preserve previous deployments that enabled the window with APPROVED alone.
function readIncidentPhotoRollout(env = process.env) {
  const compactTemplatesApproved = asBool(env.INCIDENT_PHOTO_GUARDIAN_WINDOW_APPROVED);
  return {
    guardianWindowEnabled: asBool(env.INCIDENT_PHOTO_GUARDIAN_WINDOW_ENABLED, compactTemplatesApproved),
    compactTemplatesApproved,
    initialSosSettleEnabled: asBool(env.INCIDENT_PHOTO_SOS_SETTLE_ENABLED),
  };
}
module.exports = { readIncidentPhotoRollout };
