'use strict';

const config = require('./config');
const { createWifiFenceCapture } = require('./wifi-fence-validation');

let capture;
let capturePilot;

function configured() {
  return config.wifiHomeObserveEnabled === true && /^\d{15}$/.test(config.wifiHomePilotImei || '') &&
    /^[0-9a-f]{64}$/i.test(config.wifiHomeRouterHash || '') &&
    /^[0-9a-f]{64}$/i.test(config.wifiHomeHashKey || '');
}

function getWifiFenceValidation(nowMs = Date.now(), timeline = false) {
  const { findSocketsForDevice } = require('./sessions');
  return { version: 1, configured: configured(),
    sessionConnected: configured() && findSocketsForDevice(config.wifiHomePilotImei)
      .some(({ socket }) => !socket.destroyed),
    liveProvisioningAvailable: false,
    capture: capturePilot === config.wifiHomePilotImei ? capture?.snapshot(nowMs, timeline) || null : null,
  };
}

function controlWifiFenceValidation({ action, captureId, marker }, nowMs = Date.now()) {
  if (!configured()) throw new Error('Private observer configuration required.');
  if (action === 'start') {
    if (capture?.snapshot(nowMs).phase === 'recording') throw new Error('A capture is already running.');
    capture = createWifiFenceCapture({ imei: config.wifiHomePilotImei,
      routerHash: config.wifiHomeRouterHash, hashKey: config.wifiHomeHashKey, startedAtMs: nowMs });
    capturePilot = config.wifiHomePilotImei;
  } else {
    if (!capture || capturePilot !== config.wifiHomePilotImei || capture.snapshot(nowMs).captureId !== captureId) {
      throw new Error('Capture changed; read the current status before retrying.');
    }
    if (action === 'mark') capture.mark(marker, nowMs);
    else if (action === 'stop') capture.stop(nowMs);
    else throw new Error('Unknown capture operation.');
  }
  return getWifiFenceValidation(nowMs);
}

// These hooks must never propagate a diagnostic failure into ACK, SOS, downlink
// or tracking work. Nothing is collected until an administrator starts a window.
function observeWifiFencePacket(decoded, events, nowMs = Date.now()) {
  try {
    if (!configured() || capturePilot !== config.wifiHomePilotImei || !capture) return;
    for (const event of events) {
      capture.recordPacket(event, { command: decoded.command,
        trackerState: decoded.args?.[15] ?? null }, nowMs);
    }
  } catch { /* Diagnostics are never on the safety delivery path. */ }
}

function noteWifiFenceDownlink(command, sessions, nowMs = Date.now()) {
  try {
    if (!configured() || capturePilot !== config.wifiHomePilotImei || !capture ||
        !sessions.some(({ session }) => session.imei === capturePilot)) return;
    capture.recordCommand(command, nowMs);
  } catch { /* A diagnostic failure must not cause a command retry. */ }
}

module.exports = { getWifiFenceValidation, controlWifiFenceValidation,
  observeWifiFencePacket, noteWifiFenceDownlink };
