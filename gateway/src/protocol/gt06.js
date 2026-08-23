/**
 * ReachFar V52 protocol decoder.
 *
 * Frames use [CS*YYYYYYYYYY*LEN*command,data...] and V52 Annex I's fixed
 * positioning layout. Alarm decoding deliberately follows the V52 tracker
 * state bitmap only; older model bit assignments are not accepted.
 * - CS: 2-byte factory code (for example, "3G" or "SG")
 * - YYYYYYYYYY: 10-digit protocol id; full IMEI is resolved separately
 * - LEN: 4-character ASCII hexadecimal content length
 * - command,data: payload (normally ASCII; TK carries escaped binary AMR)
 */

const {
  bindSessionImei,
  extractFullImeiFromPayload,
  isFullImei,
} = require('../imei');
const { parseLteExtras, isPlaceholderCoords } = require('../geolocate/google');
const {
  unescapeV52VoiceData,
  validateSosVoiceClip,
} = require('../service-backbones/voice-messages');

function parseFiniteNumber(value) {
  if (value == null || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseIntegerInRange(value, min, max) {
  if (value == null || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : null;
}

function parseV52Telemetry(fields) {
  // V52 Annex I fixed positioning fields. Do not infer these values from the
  // variable LTE/WiFi tail that starts after the tracker-state field.
  return {
    altitude: parseFiniteNumber(fields[9]),
    satellites: parseIntegerInRange(fields[10], 0, 99),
    cellularSignalPercent: parseIntegerInRange(fields[11], 0, 100),
    batteryPercent: parseIntegerInRange(fields[12], 0, 100),
    stepsRaw: parseIntegerInRange(fields[13], 0, Number.MAX_SAFE_INTEGER),
    rollCountRaw: parseIntegerInRange(fields[14], 0, Number.MAX_SAFE_INTEGER),
  };
}

// Commands only ever sent server->tracker (section II of the protocol doc).
// If one shows up as an *incoming* command, the device echoed it back.
// Includes commands confirmed in the V52 vendor protocol and companion
// captures. 'profile'/'PROFILE' and 'oxygen'/'hrtstart' case variants are
// both listed because the vendor examples are inconsistent about ack case.
const SERVER_ONLY_COMMANDS = new Set([
  'CR', 'UPLOAD', 'CALL', 'MONITOR', 'SOS1', 'SOS2', 'SOS3', 'SOS', 'PHBX',
  'SMSONOFF', 'profile', 'PROFILE', 'REMIND', 'HSW', 'FIND', 'FALLDOWN', 'LSSET',
  'SPOF', 'LZ', 'RESET', 'POWEROFF', 'VERNO', 'PEDO', 'WALKTIME',
  'TAKEPILLS', 'WIFIFENCE', 'rcapture',
  // Additional commands documented for the V52 data protocol/captures.
  'hrtstart', 'SEDENTARY', 'REMOVESMS', 'APPLOCK', 'DEVREFUSEPHONESWITCH',
  'SLAVE', 'PW', 'ANY', 'APN', 'IP', 'MOD', 'FACTORY', 'FON', 'gprsgps',
  'UPGRADE', 'BTTIMESET', 'bodytemp', 'bodytemp2', 'FTPIP', 'FTPPWD', 'PIC',
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
  const telemetry = parseV52Telemetry(fields);

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
        altitude: telemetry.altitude,
        recordedAt,
        satellites: telemetry.satellites,
        source: positioningMode,
        gpsValid: false,
        accuracyMeters: null,
      },
      speedKmh,
      course,
      accuracySource: positioningMode === 'wifi' ? 'wifi' : 'lbs',
      cellularSignalPercent: telemetry.cellularSignalPercent,
      batteryPercent: telemetry.batteryPercent,
      stepsRaw: telemetry.stepsRaw,
      rollCountRaw: telemetry.rollCountRaw,
    };
  }

  return {
    gpsValid: true,
    location: {
      lat,
      lng,
      altitude: telemetry.altitude,
      recordedAt,
      satellites: telemetry.satellites,
      source: 'gps',
      gpsValid: true,
      // The V52 A packet proves satellite validity but does not include a
      // dependable accuracy radius. Never retain a previous WiFi/LBS radius.
      accuracyMeters: null,
    },
    speedKmh,
    course,
    accuracySource: 'gps',
    cellularSignalPercent: telemetry.cellularSignalPercent,
    batteryPercent: telemetry.batteryPercent,
    stepsRaw: telemetry.stepsRaw,
    rollCountRaw: telemetry.rollCountRaw,
  };
}

function truncatePayloadPreview(args, maxLen = 200) {
  const s = args.join(',');
  return s.length <= maxLen ? s : `${s.slice(0, maxLen)}…`;
}

const V52_TRACKER_STATE_INDEX = 15;
const V52_TRACKER_STATE_HEX = /^[0-9A-F]{8}$/i;

function extractV52TrackerState(args) {
  if (!Array.isArray(args)) return null;
  const candidate = args[V52_TRACKER_STATE_INDEX];
  return V52_TRACKER_STATE_HEX.test(candidate || '')
    ? candidate.toUpperCase()
    : null;
}

function classifyV52Alarm(alarmCode) {
  if (!alarmCode) return 'other';

  const stateBits = Number.parseInt(alarmCode, 16);
  if (!Number.isFinite(stateBits)) return 'other';

  // ReachFar V52 Appendix I: alarm flags occupy the high 16 bits.
  // Bit 21 belongs to a different model and is intentionally not decoded.
  if ((stateBits & (1 << 16)) !== 0) return 'sos';
  if ((stateBits & (1 << 22)) !== 0) return 'fall';
  if ((stateBits & (1 << 17)) !== 0) return 'low_battery';
  if ((stateBits & (1 << 18)) !== 0) return 'geofence_exit';
  if ((stateBits & (1 << 19)) !== 0) return 'geofence_enter';
  if ((stateBits & (1 << 20)) !== 0) return 'bracelet_removed';
  return 'other';
}

function parseLkData(fields) {
  // LK,steps,rolls,battery
  return {
    stepsRaw: parseIntegerInRange(fields[1], 0, Number.MAX_SAFE_INTEGER),
    rollCountRaw: parseIntegerInRange(fields[2], 0, Number.MAX_SAFE_INTEGER),
    batteryPercent: parseIntegerInRange(fields[3], 0, 100),
  };
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
  // Parse [CS*IMEI*LEN*cmd,data...]. Do not convert the entire frame to a
  // string: TK embeds escaped AMR bytes and ASCII conversion corrupts bytes
  // above 0x7f before they can be persisted or sent to WhatsApp.
  if (
    !Buffer.isBuffer(frame)
    || frame.length < 8
    || frame[0] !== 0x5b
    || frame[frame.length - 1] !== 0x5d
  ) {
    console.log('[protocol] invalid frame delimiters');
    return { error: 'invalid_frame_delimiters' };
  }

  const firstStar = frame.indexOf(0x2a, 1);
  const secondStar = firstStar < 0 ? -1 : frame.indexOf(0x2a, firstStar + 1);
  const thirdStar = secondStar < 0 ? -1 : frame.indexOf(0x2a, secondStar + 1);
  if (firstStar < 0 || secondStar < 0 || thirdStar < 0) {
    console.log('[protocol] incomplete frame header');
    return { error: 'incomplete_frame' };
  }

  const factory = frame.subarray(1, firstStar).toString('ascii');
  const imei = frame.subarray(firstStar + 1, secondStar).toString('ascii');
  const lenHex = frame.subarray(secondStar + 1, thirdStar).toString('ascii');
  const payloadBuffer = frame.subarray(thirdStar + 1, frame.length - 1);

  const expectedLen = parseInt(lenHex, 16);
  if (!Number.isFinite(expectedLen) || payloadBuffer.length !== expectedLen) {
    return { error: 'length_mismatch' };
  }

  const commaIndex = payloadBuffer.indexOf(0x2c);
  const commandBuffer = commaIndex < 0
    ? payloadBuffer
    : payloadBuffer.subarray(0, commaIndex);
  const command = commandBuffer.toString('ascii');

  if (command === 'TK') {
    const wireData = commaIndex < 0
      ? Buffer.alloc(0)
      : payloadBuffer.subarray(commaIndex + 1);
    const resultText = wireData.toString('ascii');
    const voiceResult = wireData.length === 1 && (resultText === '0' || resultText === '1')
      ? Number(resultText)
      : null;

    if (voiceResult != null) {
      return {
        factory,
        imei,
        command,
        args: [resultText],
        payload: `TK,${resultText}`,
        voiceResult,
      };
    }

    let voiceData;
    try {
      voiceData = unescapeV52VoiceData(wireData);
    } catch (err) {
      return { error: err.message || 'invalid_v52_tk_escape' };
    }

    return {
      factory,
      imei,
      command,
      args: [],
      payload: 'TK,<binary-amr>',
      voiceData,
      voiceWireBytes: wireData.length,
    };
  }

  const payload = payloadBuffer.toString('ascii');
  const argParts = commaIndex < 0
    ? []
    : payloadBuffer.subarray(commaIndex + 1).toString('ascii').split(',');

  return {
    factory,
    imei,
    command,
    args: argParts,
    payload,
  };
}

function handlePacket(decoded, session) {
  if (decoded?.error) {
    return {
      acks: [],
      events: [{ type: 'parse_error', error: decoded.error }],
    };
  }

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
  if (command === 'TK') {
    if (decoded.voiceResult != null) {
      events.push({
        type: 'voice_message_receipt',
        ...eventMeta,
        accepted: decoded.voiceResult === 1,
      });
    } else {
      const inspection = validateSosVoiceClip(decoded.voiceData);
      if (!inspection.ok) {
        acks.push(buildAckFrame(protocolId, 'TK,0'));
        events.push({
          type: 'voice_message_rejected',
          ...eventMeta,
          reason: inspection.reason,
        });
      } else {
        // ACK is deliberately deferred until the clip is bound to an active
        // SOS and stored. TK,1 must mean Guardian accepted the clip, not only
        // that its bytes happened to parse.
        events.push({
          type: 'voice_message',
          ...eventMeta,
          audio: Buffer.from(decoded.voiceData),
          codec: inspection.codec,
          contentType: inspection.contentType,
          byteLength: inspection.byteLength,
          durationMs: inspection.durationMs,
          voiceWireBytes: decoded.voiceWireBytes,
          deferredAck: true,
        });
      }
    }
  } else if (command === 'LK') {
    // Link keep-alive / heartbeat
    const hb = parseLkData([command, ...args]);
    acks.push(buildAckFrame(protocolId, 'LK'));
    events.push({ type: 'heartbeat', ...eventMeta, ...hb });
  } else if (command === 'TKQ') {
    // V52: lightweight heartbeat/keepalive (sent immediately after LK during connection handshake)
    // Treat as a valid session keepalive event to allow "connecting" → "live" transition.
    // TKQ does not include battery data, so omit it (LK provides battery if available).
    acks.push(buildAckFrame(protocolId, 'TKQ'));
    events.push({ type: 'heartbeat', ...eventMeta, batteryPercent: null });
  } else if (command === 'UD2') {
    // V52: blind-spot re-upload (data buffered while offline).
    // "Server no need reply" per the protocol doc — no ack pushed.
    const loc = parseLocationData(args);
    if (loc && !loc.error) {
      events.push({ type: 'location', ...eventMeta, ...loc, blindSpotReupload: true });
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
  } else if (command === 'oxygen') {
    // V52: SpO2 upload. [type, oxy]. Server must reply with a
    // status code: 1=normal, 0=process disorderly, 2=parameter error.
    const [oxyType, oxyValue] = args;
    const oxy = parseFloat(oxyValue);
    acks.push(buildAckFrame(protocolId, `oxygen,${Number.isNaN(oxy) ? 2 : 1}`));
    if (!Number.isNaN(oxy)) {
      events.push({
        type: 'health_reading',
        ...eventMeta,
        metric: 'spo2',
        value: oxy,
        measurementType: oxyType ?? null,
      });
    }
  } else if (command === 'bphrt') {
    // V52: heart rate + blood pressure upload after `hrtstart`.
    // Only 3 leading fields are confirmed from the vendor's example
    // (systolic, diastolic, heart rate); trailing fields are unconfirmed
    // and left unparsed rather than guessed. No documented ack for this
    // one specifically — sending a bare ack defensively, matching this
    // decoder's existing fallback behavior for undocumented-ack uploads.
    const [systolic, diastolic, heartRate] = args;
    acks.push(buildAckFrame(protocolId, 'bphrt'));
    const hr = parseInt(heartRate, 10);
    const sys = parseInt(systolic, 10);
    const dia = parseInt(diastolic, 10);
    events.push({
      type: 'health_reading',
      ...eventMeta,
      metric: 'heart_rate_bp',
      heartRate: Number.isNaN(hr) ? null : hr,
      systolic: Number.isNaN(sys) ? null : sys,
      diastolic: Number.isNaN(dia) ? null : dia,
    });
  } else if (command.startsWith('AL')) {
    // V52 Annex I fixes tracker state at positioning field 15. LTE, cell,
    // WiFi, delay, and voltage fields follow it, so the final argument is
    // never a safe alarm-code heuristic.
    const alarmCode = extractV52TrackerState(args);
    const alarmType = classifyV52Alarm(alarmCode);
    const loc = parseLocationData(args);
    acks.push(buildAckFrame(protocolId, 'AL'));
    events.push({
      type: 'alarm',
      ...eventMeta,
      alarmType,
      ...(alarmCode != null
        ? {
            alarmCode,
            alarmStateIndex: V52_TRACKER_STATE_INDEX,
          }
        : {}),
      alarmCommand: command,
      alarmArgCount: args.length,
      severity: alarmType === 'sos' || alarmType === 'fall' ? 'critical' : 'warning',
      ...(loc && !loc.error ? loc : {}),
    });
  } else if (command === 'RYIMEI') {
    acks.push(buildAckFrame(protocolId, command));
    if (fullImeiHint && isFullImei(fullImeiHint)) {
      events.push({ type: 'imei_report', ...eventMeta, fullImei: fullImeiHint });
    }
  } else if (command === 'CONFIG') {
    // Device firmware self-test packet — contains device state including UL (upload interval).
    // Per the V52 vendor protocol: reply CONFIG,1 (not bare CONFIG).
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
  parseLkData,
  parseV52Telemetry,
  extractV52TrackerState,
  classifyV52Alarm,
  V52_TRACKER_STATE_INDEX,
};
