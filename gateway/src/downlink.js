const { buildAckFrame } = require('./protocol/gt06');
const { findSocketsForDevice } = require('./sessions');

/**
 * Write a downlink command frame on every active TCP session for the device.
 * Uses the 10-digit protocol id in the frame (e.g. CR → [SG*9705314117*0002*CR]).
 */
function sendDownlinkCommand(imeiOrProtocolId, command) {
  const matches = findSocketsForDevice(imeiOrProtocolId);
  if (matches.length === 0) {
    return { ok: false, error: 'no_active_session', imeiOrProtocolId, command };
  }

  const protocolId =
    matches[0].session.protocolId ||
    (String(imeiOrProtocolId).length === 15
      ? String(imeiOrProtocolId).slice(3, 13)
      : String(imeiOrProtocolId));

  const frame = buildAckFrame(protocolId, command);
  const frameStr = frame.toString('ascii');

  for (const { socket } of matches) {
    socket.write(frame);
  }

  console.log(
    `[downlink] sent ${command} to ${protocolId} (${matches.length} session(s)): ${frameStr}`
  );

  return {
    ok: true,
    imeiOrProtocolId,
    protocolId,
    command,
    frame: frameStr,
    sessions: matches.length,
  };
}

function sendContinuousReporting(imeiOrProtocolId) {
  return sendDownlinkCommand(imeiOrProtocolId, 'CR');
}

module.exports = {
  sendDownlinkCommand,
  sendContinuousReporting,
};
