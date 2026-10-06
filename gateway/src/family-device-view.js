'use strict';
// Explicit allowlist: the shared location card must never expose wellbeing,
// diagnostic counters, intelligence summaries, SIM numbers or configuration.
const FIELDS = Object.freeze(['imei', 'name', 'nickname', 'relationship', 'avatarUrl',
  'online', 'batteryPercent', 'batteryUpdatedAt', 'cellularSignalPercent', 'cellularSignalUpdatedAt',
  'speedKmh', 'course', 'accuracySource', 'location', 'lastLocationObservation', 'lastSatelliteLocation',
  'lastApproximateLocation', 'homeWifiPresence', 'lastHomeWifiDetection', 'lastHeartbeatAt',
  'disconnectedAt', 'connectionState', 'connectingAt', 'updatedAt']);
function deviceView(data) {
  return Object.fromEntries(FIELDS.filter(key => Object.hasOwn(data, key)).map(key => [key, data[key]]));
}
// Identity/status contains no position or care readings. A member may need the
// wearer selector and their permitted actions without being allowed to locate them.
const PROFILE_FIELDS = Object.freeze(['imei', 'name', 'nickname', 'relationship', 'avatarUrl',
  'online', 'batteryPercent', 'batteryUpdatedAt', 'cellularSignalPercent', 'cellularSignalUpdatedAt',
  'lastHeartbeatAt', 'disconnectedAt', 'connectionState', 'connectingAt']);
function deviceProfile(data) {
  return Object.fromEntries(PROFILE_FIELDS.filter(key => Object.hasOwn(data, key)).map(key => [key, data[key]]));
}
function deviceSettings(data) {
  const fields = ['fallDetection', 'watchAlertProfile', 'locationReportingMode',
    'locationReportingIntervalSeconds', 'manualReportingIntervalSeconds', 'careProfile', 'carePriorities'];
  return { ...deviceProfile(data),
    ...Object.fromEntries(fields.filter(key => Object.hasOwn(data, key)).map(key => [key, data[key]])) };
}
module.exports = { deviceView, deviceProfile, deviceSettings, FIELDS, PROFILE_FIELDS };
