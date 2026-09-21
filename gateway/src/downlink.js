const { buildAckFrame } = require('./protocol/gt06');
const { findSocketsForDevice } = require('./sessions');
const { noteWifiFenceDownlink } = require('./wifi-fence-runtime');

function redactPhone(value) {
  const phone = String(value || '');
  return phone.length <= 4 ? '***' : `***${phone.slice(-4)}`;
}

/** Keep contact data and call destinations out of routine gateway logs. */
function redactDownlinkCommand(command) {
  const text = String(command || '');
  if (/^WIFIFENCE(?:,|$)/i.test(text)) return 'WIFIFENCE,<radios-redacted>';
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
function sendDownlinkCommand(imeiOrProtocolId, command, { frameFormat = 'default' } = {}) {
  // Explicit operator comparison only. Keep normal framing and every other
  // command unchanged; do not expose an arbitrary raw-frame override.
  if (!['default', 'applock-example'].includes(frameFormat)) {
    return { ok: false, error: 'unsupported_frame_format' };
  }
  if (frameFormat === 'applock-example' && !/^APPLOCK,JT-[01]$/.test(command)) {
    return { ok: false, error: 'frame_format_command_rejected' };
  }
  const matches = findSocketsForDevice(imeiOrProtocolId);
  if (matches.length === 0) {
    return { ok: false, error: 'no_active_session', imeiOrProtocolId, command };
  }

  const protocolId =
    matches[0].session.protocolId ||
    (String(imeiOrProtocolId).length === 15
      ? String(imeiOrProtocolId).slice(3, 13)
      : String(imeiOrProtocolId));

  if (frameFormat === 'applock-example' && !/^\d{10}$/.test(protocolId)) {
    return { ok: false, error: 'invalid_protocol_id' };
  }
  // Supplier Communication Example, page 2: literal lowercase "000c".
  // This changes one header byte, never JT polarity or the payload.
  const frame = frameFormat === 'applock-example'
    ? Buffer.from(`[SG*${protocolId}*000c*${command}]`, 'ascii')
    : buildAckFrame(protocolId, command);
  const frameStr = frame.toString('ascii');

  for (const { socket } of matches) {
    socket.write(frame);
  }

  noteWifiFenceDownlink(command, matches);

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
    ...(frameFormat === 'applock-example' ? { frameFormat } : {}),
    sessions: matches.length,
  };
}

function sendContinuousReporting(imeiOrProtocolId) {
  // Historical helper name. Supplier section II.2 describes a temporary GPS
  // wake-up: reports every 30 seconds for about three minutes, not indefinitely.
  return sendDownlinkCommand(imeiOrProtocolId, 'CR');
}

module.exports = {
  redactDownlinkCommand,
  sendDownlinkCommand,
  sendContinuousReporting,
};
