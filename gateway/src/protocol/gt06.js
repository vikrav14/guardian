/**
 * ReachFar V28C ASCII protocol decoder.
 * Format: [CS*YYYYYYYYYY*LEN*command,data...]
 * - CS: 2-byte factory code (e.g., "3G", "SG")
 * - YYYYYYYYYY: 10-digit device ID (protocol id; full IMEI is 15 digits — see imei.js)
 * - LEN: 4-char ASCII hex content length
 * - command,data: payload (LK, UD_LTE, AL_LTE, etc.)
 */

const {
  bindSessionImei,
  extractFullImeiFromPayload,
  isFullImei,
} = require('../imei');
const { parseLteExtras, isPlaceholderCoords } = require('../geolocate/google');

// Commands only ever sent server->tracker (section II of the protocol doc).
// If one shows up as an *incoming* command, the device echoed it back.
const SERVER_ONLY_COMMANDS = new Set([
  'CR', 'UPLOAD', 'CALL', 'MONITOR', 'SOS1', 'SOS2', 'SOS3', 'PHBX',
  'SMSONOFF', 'profile', 'REMIND', 'HSW', 'FIND', 'FALLDOWN', 'LSSET',
  'SPOF', 'LZ', 'RESET', 'POWEROFF', 'VERNO', 'PEDO', 'WALKTIME',
  'TAKEPILLS', 'WIFIFENCE', 'rcapture',
]);

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

  const gpsFlag = fields.length > 2 ? fields[2] : null;
  const gpsValid = gpsFlag === 'A'; // A=valid satellite fix; V=WiFi/LBS raw data

  let lat = null;
  let lng = null;
  let course = 0;
  let speedKmh = null;

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

  // UD_LTE field order after lngDir: speed (km/h), course (degrees), then LTE extras.
  if (fields.length > 7) {
    const speed = parseFloat(fields[7]);
    if (!Number.isNaN(speed)) {
      speedKmh = speed;
    }
  }

  if (fields.length > 8) {
    const c = parseInt(fields[8], 10);
    if (!Number.isNaN(c)) course = c;
  }

  if (!gpsValid) {
    if (gpsFlag !== 'V') {
      return { error: 'gps_flag_missing' };
    }

    const { wifiAccessPoints, cellTowers } = parseLteExtras(fields.slice(9));
    if (wifiAccessPoints.length === 0 && cellTowers.length === 0) {
      return { error: 'gps_not_fixed' };
    }

    const positioningMode = wifiAccessPoints.length > 0
      ? 'wifi'
      : (cellTowers.length > 0 ? 'lbs' : 'unknown');

    return {
      gpsValid: false,
      positioningMode,
      wifiAccessPoints,
      cellTowers,
      needsGeolocation: true,
      location: {
        lat: isPlaceholderCoords(lat, lng) ? null : lat,
        lng: isPlaceholderCoords(lat, lng) ? null : lng,
        altitude: null,
        recordedAt,
        satellites: null,
      },
      speedKmh,
      course,
      accuracySource: positioningMode === 'wifi' ? 'wifi' : 'lbs',
    };
  }

  return {
    gpsValid: true,
    location: { lat, lng, altitude: null, recordedAt, satellites: null },
    speedKmh,
    course,
    accuracySource: 'gps',
  };
}

function truncatePayloadPreview(args, maxLen = 200) {
  const s = args.join(',');
  return s.length <= maxLen ? s : `${s.slice(0, maxLen)}…`;
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
    console.log(`[protocol] invalid frame delimiters: ${frameStr.substring(0, 50)}`);
    return { error: 'invalid_frame_delimiters' };
  }

  const content = frameStr.slice(1, -1); // Remove brackets
  const parts = content.split('*');
  if (parts.length < 4) {
    console.log(`[protocol] incomplete frame (${parts.length} parts): ${frameStr.substring(0, 50)}`);
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
  const { imei: rawId, command, args, payload } = decoded;
  const acks = [];
  const events = [];

  if (!rawId) {
    events.push({ type: 'parse_error', error: 'no_imei' });
    return { acks, events };
  }

  let fullImeiHint = null;
  if (command === 'RYIMEI' || command === 'CONFIG') {
    fullImeiHint = extractFullImeiFromPayload(args, payload);
  }

  const { protocolId, imei } = bindSessionImei(session, rawId, fullImeiHint);
  session.imei = imei;

  const eventMeta = { imei, protocolId };

  // Route by command type
  if (command === 'LK') {
    // Link keep-alive / heartbeat
    const hb = parseLkData([command, ...args]);
    acks.push(buildAckFrame(protocolId, 'LK'));
    events.push({ type: 'heartbeat', ...eventMeta, ...hb });
  } else if (command.startsWith('UD')) {
    // Location upload: UD, UD_LTE, UD_WCDMA, etc.
    const loc = parseLocationData(args);
    acks.push(buildAckFrame(protocolId, 'UD'));
    if (loc && !loc.error) {
      events.push({ type: 'location', ...eventMeta, ...loc });
    } else {
      events.push({
        type: 'location_parse_error',
        ...eventMeta,
        command,
        reason: loc?.error || 'invalid_location',
        gpsFlag: args[2] || null,
        argCount: args.length,
        payloadPreview: truncatePayloadPreview(args),
      });
    }
  } else if (command.startsWith('AL')) {
    // Alarm upload: AL, AL_LTE, AL_WCDMA, etc.
    const alarmStateField = args.length > 0 ? args[args.length - 1] : null;
    const locArgs =
      alarmStateField && /^[0-9a-f]+$/i.test(alarmStateField)
        ? args.slice(0, -1)
        : args;
    const loc = parseLocationData(locArgs);
    acks.push(buildAckFrame(protocolId, 'AL'));
    let alarmType = 'other';
    let alarmCode = null;
    if (args.length > 0) {
      const stateField = alarmStateField ?? args[args.length - 1];
      alarmCode = stateField;
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
      ...eventMeta,
      alarmType,
      ...(alarmCode != null ? { alarmCode } : {}),
      severity: alarmType === 'sos' || alarmType === 'fall' ? 'critical' : 'warning',
      ...(loc && !loc.error ? loc : {}),
    });
  } else if (command === 'RYIMEI') {
    acks.push(buildAckFrame(protocolId, command));
    if (fullImeiHint && isFullImei(fullImeiHint)) {
      events.push({ type: 'imei_report', ...eventMeta, fullImei: fullImeiHint });
    }
  } else if (command === 'CONFIG') {
    // Vendor PDF: reply CONFIG,1 (not bare CONFIG)
    acks.push(buildAckFrame(protocolId, 'CONFIG,1'));
    if (fullImeiHint && isFullImei(fullImeiHint)) {
      events.push({ type: 'imei_report', ...eventMeta, fullImei: fullImeiHint });
    }
  } else if (command === 'ICCID' || command === 'WT_LTE') {
    // Config / provisioning response — ACK only; may carry full IMEI in payload
    acks.push(buildAckFrame(protocolId, command));
    if (fullImeiHint && isFullImei(fullImeiHint)) {
      events.push({ type: 'imei_report', ...eventMeta, fullImei: fullImeiHint });
    }
  } else if (SERVER_ONLY_COMMANDS.has(command)) {
    // Device echoed back a command we sent it (e.g. CR). These are
    // server->tracker only; acking the echo would just bounce it back
    // again and loop forever, so drop it silently.
    events.push({ type: 'command_echo', ...eventMeta, command });
  } else {
    // Unknown command — still ACK for compatibility
    acks.push(buildAckFrame(protocolId, command));
    events.push({ type: 'unknown_command', ...eventMeta, command });
  }

  return { acks, events };
}

module.exports = {
  extractFrames,
  decodeFrame,
  handlePacket,
  buildAckFrame,
  parseLocationData,
};
