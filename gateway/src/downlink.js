const { buildAckFrame } = require('./protocol/gt06');
const { findSocketsForDevice } = require('./sessions');
const { noteWifiFenceDownlink } = require('./wifi-fence-runtime');
const { noteDeviceWrite } = require('./photo-command-timeline');
const { commandCoordinator } = require('./command-coordinator');

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
 * Write a downlink command frame on one unambiguous active device session.
 * Uses the 10-digit protocol id in the frame (e.g. CR → [SG*9705314117*0002*CR]).
 */
function sendDownlinkCommand(imeiOrProtocolId, command, options = {}) {
  if (require('./watch-sms-policy').disallowedSmsCommand(command)) {
    return { ok: false, error: 'watch_sms_fixed_off' };
  }
  const matches = findSocketsForDevice(imeiOrProtocolId)
    .filter(({ socket }) => !socket.destroyed && socket.writable !== false);
  if (matches.length === 0) {
    return { ok: false, error: 'no_active_session', imeiOrProtocolId, command };
  }
  // Commands are actions, not broadcasts. Never duplicate one across sockets.
  if (matches.length !== 1) return { ok: false, error: 'ambiguous_session' };
  if (options.expectedSocket && matches[0].socket !== options.expectedSocket) {
    return { ok: false, error: 'session_changed' };
  }
  const decision = commandCoordinator.decide(matches[0].session.imei || imeiOrProtocolId, command, options);
  if (!decision.ok) {
    console.info(`[command-coordination] ${decision.status} reason=${decision.error}`);
    return decision;
  }

  const protocolId =
    matches[0].session.protocolId ||
    (String(imeiOrProtocolId).length === 15
      ? String(imeiOrProtocolId).slice(3, 13)
      : String(imeiOrProtocolId));

  const frame = buildAckFrame(protocolId, command);
  const frameStr = frame.toString('ascii');

  for (const { socket, session } of matches) {
    noteDeviceWrite(socket, session, frame, 'downlink');
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
