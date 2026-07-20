/**
 * ReachFar V28C ASCII protocol decoder.
 * Format: [CS*YYYYYYYYYY*LEN*command,data...]
 * - CS: 2-byte factory code (e.g., "3G", "SG")
 * - YYYYYYYYYY: 10-digit device ID (IMEI)
 * - LEN: 4-char ASCII hex content length
 * - command,data: payload (LK, UD_LTE, AL_LTE, etc.)
 */

function parseLocationData(fields) {
  if (fields.length < 2) return null;
  const date = fields[0]; // DDMMYY
  const time = fields[1]; // HHMMSS
  if (!date || !time || date.length !== 6 || time.length !== 6) return null;

  const day = parseInt(date.substring(0, 2), 10);
  const month = parseInt(date.substring(2, 4), 10);
  const year = 2000 + parseInt(date.substring(4, 6), 10);
  const hour = parseInt(time.substring(0, 2), 10);
  const minute = parseInt(time.substring(2, 4), 10);
  const second = parseInt(time.substring(4, 6), 10);

  const recordedAt = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (Number.isNaN(recordedAt.getTime())) return null;

  const gpsValid = fields.length > 2 && fields[2] === 'A'; // A=valid, V=invalid
  if (!gpsValid) return null; // GPS not fixed

  let lat = null, lng = null, course = 0;
  if (fields.length > 5) {
    lat = parseFloat(fields[3]);
    const latDir = fields[4];
    if (Number.isNaN(lat)) return null;
    if (latDir === 'S') lat = -lat;

    lng = parseFloat(fields[5]);
    const lngDir = fields.length > 6 ? fields[6] : 'E';
    if (Number.isNaN(lng)) return null;
    if (lngDir === 'W') lng = -lng;
  }

  if (fields.length > 8) {
    const speed = parseFloat(fields[8]);
    if (!Number.isNaN(speed)) {
      var speedKmh = speed;
    }
  }

  if (fields.length > 9) {
    const c = parseInt(fields[9], 10);
    if (!Number.isNaN(c)) course = c;
  }

  return {
    location: { lat, lng, altitude: null, recordedAt, satellites: null },
    speedKmh: speedKmh || null,
    course,
    accuracySource: 'gps',
  };
}

function parseLkData(fields) {
  // LK,steps,rolls,battery
  let battery = null;
  if (fields.length > 3) {
    const b = parseInt(fields[3], 10);
    if (!Number.isNaN(b)) battery = b;
  }
  return { batteryPercent: battery };
}

function buildAckFrame(imei, command) {
  // [SG*IMEI*LEN*command]
  const content = command;
  const lenHex = content.length.toString(16).toUpperCase().padStart(4, '0');
  const ack = `[SG*${imei}*${lenHex}*${content}]`;
  return Buffer.from(ack, 'ascii');
}

function extractFrames(buffer) {
  const frames = [];
  let offset = 0;

  while (offset < buffer.length) {
    // Find opening bracket
    const start = buffer.indexOf(0x5b, offset); // 0x5b = '['
    if (start === -1) break;

    // Find closing bracket
    const end = buffer.indexOf(0x5d, start); // 0x5d = ']'
    if (end === -1) break;

    // Extract frame including brackets
    const frame = buffer.subarray(start, end + 1);
    frames.push(frame);
    offset = end + 1;
  }

  return { frames, rest: buffer.subarray(offset) };
}

function decodeFrame(frame) {
  // Parse ASCII frame: [CS*IMEI*LEN*cmd,data...]
  const frameStr = frame.toString('ascii');
  if (!frameStr.startsWith('[') || !frameStr.endsWith(']')) {
    return { error: 'invalid_frame_delimiters' };
  }

  const content = frameStr.slice(1, -1); // Remove brackets
  const parts = content.split('*');
  if (parts.length < 4) {
    return { error: 'incomplete_frame' };
  }

  const factory = parts[0]; // CS (2 chars)
  const imei = parts[1]; // YYYYYYYYYY (10 digits)
  const lenHex = parts[2]; // LEN (4 hex digits)
  const payload = parts.slice(3).join('*'); // Everything after 3rd *

  const expectedLen = parseInt(lenHex, 16);
  if (payload.length !== expectedLen) {
    return { error: 'length_mismatch' };
  }

  // Split payload on first comma to separate command from args
  const [command, ...argParts] = payload.split(',');

  return {
    factory,
    imei,
    command,
    args: argParts,
    payload,
  };
}

function handlePacket(decoded, session) {
  const { imei, command, args } = decoded;
  const acks = [];
  const events = [];

  if (!imei) {
    events.push({ type: 'parse_error', error: 'no_imei' });
    return { acks, events };
  }

  session.imei = imei;

  // Route by command type
  if (command === 'LK') {
    // Link keep-alive / heartbeat
    const hb = parseLkData([command, ...args]);
    acks.push(buildAckFrame(imei, 'LK'));
    events.push({ type: 'heartbeat', imei, ...hb });
  } else if (command.startsWith('UD')) {
    // Location upload: UD, UD_LTE, UD_WCDMA, etc.
    const loc = parseLocationData(args);
    acks.push(buildAckFrame(imei, 'UD'));
    if (loc) {
      events.push({ type: 'location', imei, ...loc });
    } else {
      events.push({ type: 'location_parse_error', imei, command });
    }
  } else if (command.startsWith('AL')) {
    // Alarm upload: AL, AL_LTE, AL_WCDMA, etc.
    const loc = parseLocationData(args);
    acks.push(buildAckFrame(imei, 'AL'));
    let alarmType = 'other';
    if (args.length > 0) {
      const stateField = args[args.length - 1];
      const stateBits = parseInt(stateField, 16);
      if (!Number.isNaN(stateBits)) {
        if ((stateBits & (1 << 16)) !== 0) alarmType = 'sos';
        else if ((stateBits & (1 << 21)) !== 0) alarmType = 'fall';
        else if ((stateBits & (1 << 20)) !== 0) alarmType = 'geofence_exit';
        else if ((stateBits & (1 << 19)) !== 0) alarmType = 'geofence_enter';
        else if ((stateBits & (1 << 17)) !== 0) alarmType = 'low_battery';
      }
    }
    events.push({
      type: 'alarm',
      imei,
      alarmType,
      severity: alarmType === 'sos' || alarmType === 'fall' ? 'critical' : 'warning',
      ...(loc || {}),
    });
  } else if (command === 'CONFIG' || command === 'ICCID' || command === 'WT_LTE') {
    // Config / provisioning response — ACK only, no events
    acks.push(buildAckFrame(imei, command));
  } else {
    // Unknown command — still ACK for compatibility
    acks.push(buildAckFrame(imei, command));
    events.push({ type: 'unknown_command', imei, command });
  }

  return { acks, events };
}

module.exports = {
  extractFrames,
  decodeFrame,
  handlePacket,
  buildAckFrame,
};
