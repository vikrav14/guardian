const { buildAckFrame } = require('./protocol/gt06');
const { findSocketsForDevice } = require('./sessions');

function redactPhone(value) {
  const phone = String(value || '');
  return phone.length <= 4 ? '***' : `***${phone.slice(-4)}`;
}

/** Keep contact data and call destinations out of routine gateway logs. */
function redactDownlinkCommand(command) {
  const text = String(command || '');
  if (text.startsWith('PHBX,')) {
    const fields = text.split(',');
    return [
      'PHBX',
      fields[1] || '',
      '<name-redacted>',
      redactPhone(fields[3]),
      fields[4] ? '<picture-redacted>' : '',
    ].join(',');
  }

  const phoneCommand = text.match(/^(CALL|MONITOR|CENTER|SOS[123]),(.+)$/);
  if (phoneCommand) {
    return `${phoneCommand[1]},${redactPhone(phoneCommand[2])}`;
  }

  return text;
}

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

  const safeCommand = redactDownlinkCommand(command);
  const frameLog = safeCommand === command ? `: ${frameStr}` : ' (frame redacted)';
  console.log(
    `[downlink] sent ${safeCommand} to ${protocolId} (${matches.length} session(s))${frameLog}`
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
  redactDownlinkCommand,
  sendDownlinkCommand,
  sendContinuousReporting,
};
