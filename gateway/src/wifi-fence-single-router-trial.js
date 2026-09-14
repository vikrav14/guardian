'use strict';

const { buildAckFrame } = require('./protocol/gt06');
const { normalizeRouterId, fingerprintRouter } = require('./wifi-home-observer');

// Operator-requested experiment: II.35 shows indexed entries but does NOT
// explicitly document a one-entry list. Keep this out of commands.js and the
// documented three-slot builder. Never guess deletion, padding or a fallback.
function experimentalCommand(routerId) {
  const id = normalizeRouterId(routerId);
  if (!id) throw new Error('invalid_router');
  return `WIFIFENCE,1,${id}`;
}

function preview() {
  return { experiment: 'single_router_slot_1', experimental: true,
    payload: 'WIFIFENCE,1,<enrolled-2.4GHz-radio>', payloadBytes: 29, lengthHex: '001D',
    singleRouterSyntaxConfirmed: false, hardwareCommandsSent: 0,
    settingMayPersist: true, rollbackKnown: false,
    nativeFenceAccepted: false, homeClaim: false };
}

function createSingleRouterTrial({ getConfig, getCapture, findSessions }) {
  let attempt = null;
  function status() {
    return { supported: true, attempted: attempt != null,
      ...(attempt || {}), settingMayPersist: true, rollbackKnown: false,
      settingsApplied: null, nativeFenceAccepted: false, homeClaim: false };
  }
  function send(input, nowMs = Date.now()) {
    if (!input || typeof input !== 'object' || Array.isArray(input) ||
        Object.keys(input).some(key => !['routerId', 'captureId', 'experimental'].includes(key)) ||
        input.experimental !== true) throw new Error('invalid_trial');
    const config = getConfig();
    if (config.wifiHomeObserveEnabled !== true ||
        !/^\d{15}$/.test(config.wifiHomePilotImei || '') ||
        !/^[0-9a-f]{64}$/i.test(config.wifiHomeRouterHash || '') ||
        !/^[0-9a-f]{64}$/i.test(config.wifiHomeHashKey || '')) {
      throw new Error('pilot_not_configured');
    }
    if (attempt) throw new Error('trial_already_attempted');
    const command = experimentalCommand(input.routerId);
    if (fingerprintRouter({ imei: config.wifiHomePilotImei, routerId: input.routerId,
      hashKey: config.wifiHomeHashKey }) !== config.wifiHomeRouterHash.toLowerCase()) {
      throw new Error('router_does_not_match_enrollment');
    }
    const capture = getCapture();
    const recording = capture?.snapshot(nowMs, true);
    const lastCaptureAt = Date.parse(recording?.timeline?.at(-1)?.at || recording?.startedAt);
    if (!Number.isFinite(nowMs) || !input.captureId || recording?.phase !== 'recording' ||
        recording.captureId !== input.captureId || !Number.isFinite(lastCaptureAt) || nowMs < lastCaptureAt ||
        Date.parse(recording.endsAt) - nowMs < 60_000) {
      throw new Error('fresh_capture_required');
    }
    const sessions = findSessions(config.wifiHomePilotImei)
      .filter(({ socket }) => !socket.destroyed);
    if (sessions.length !== 1) throw new Error('exactly_one_session_required');
    const { socket, session } = sessions[0];
    if (session.imei !== config.wifiHomePilotImei ||
        !/^\d{10}$/.test(session.protocolId || '') || socket.writable !== true) {
      throw new Error('verified_writable_session_required');
    }
    const frame = buildAckFrame(session.protocolId, command);
    // Set before write, without an intervening await. An exception or lost HTTP
    // response cannot make a second request send again in this gateway process.
    attempt = { captureId: recording.captureId, requestedAt: new Date(nowMs).toISOString(),
      phase: 'handoff_unknown', captureRecorded: false };
    try {
      socket.write(frame);
      attempt.phase = 'queued'; // OS/socket buffering, not watch acceptance.
    } catch {
      return status();
    }
    try {
      capture.recordCommand(command, nowMs);
      attempt.captureRecorded = true;
    } catch { /* A diagnostic failure never retries the hardware write. */ }
    return status();
  }
  return { status, send };
}

module.exports = { experimentalCommand, preview, createSingleRouterTrial };
