const { crc16Itu, appendCrc } = require('./crc');

const PROTO = {
  LOGIN: 0x01,
  LOCATION: 0x12,
  HEARTBEAT: 0x13,
  ALARM: 0x16,
  GPS_ADDRESS: 0x1a,
};

const ALARM_TYPES = {
  0x01: 'sos',
  0x02: 'other', // power cut
  0x03: 'other', // vibration
  0x04: 'geofence_enter',
  0x05: 'geofence_exit',
  0x06: 'other', // overspeed
  0x09: 'other', // moving
  0x0c: 'other', // gps antenna cut
  0x0d: 'low_battery', // device low battery sometimes 0x13/status
  0x17: 'fall', // some firmwares use custom; treat unknown carefully
};

function bcdImei(buf) {
  let imei = '';
  for (let i = 0; i < buf.length; i += 1) {
    imei += buf[i].toString(16).padStart(2, '0');
  }
  // GT06 often prefixes with 0 nibble
  if (imei.startsWith('0') && imei.length === 16) {
    imei = imei.slice(1);
  }
  return imei.replace(/^0+/, '') || imei;
}

function parseDateTime(buf, offset) {
  // YY MM DD HH MM SS — each byte is the numeric value (not always BCD on all firmwares;
  // Concox uses year/month/... as binary decimals in many GT06 docs)
  const year = 2000 + buf[offset];
  const month = buf[offset + 1];
  const day = buf[offset + 2];
  const hour = buf[offset + 3];
  const minute = buf[offset + 4];
  const second = buf[offset + 5];
  const iso = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return Number.isNaN(iso.getTime()) ? new Date() : iso;
}

function parseCoordinate(latRaw, lngRaw, courseStatus) {
  // lat/lng: 4 bytes each, degrees * 1_800_000
  const lat = latRaw / 1800000;
  const lng = lngRaw / 1800000;
  const south = (courseStatus & 0x0400) !== 0;
  const west = (courseStatus & 0x0800) !== 0;
  return {
    lat: south ? -lat : lat,
    lng: west ? -lng : lng,
    course: courseStatus & 0x03ff,
    gpsFixed: (courseStatus & 0x1000) !== 0,
  };
}

function accuracyFromCourseStatus(courseStatus) {
  // Bit 12 often indicates GPS positioning; without WiFi/LBS flags treat as gps or lbs
  return (courseStatus & 0x1000) !== 0 ? 'gps' : 'lbs';
}

function buildAck(protocol, serial) {
  // 78 78 | len=05 | proto | serial(2) | crc(2) | 0D 0A
  const body = Buffer.alloc(4);
  body[0] = 0x05; // length from proto through serial (inclusive of serial, exclusive of crc in some docs)
  // Concox: packet length = protocol(1) + info(0) + serial(2) + crc(2) = 5
  body[0] = 0x05;
  body[1] = protocol;
  body.writeUInt16BE(serial, 2);
  const withCrc = appendCrc(body);
  return Buffer.concat([Buffer.from([0x78, 0x78]), withCrc, Buffer.from([0x0d, 0x0a])]);
}

function parseLocationInfo(info) {
  if (info.length < 12) return null;
  const recordedAt = parseDateTime(info, 0);
  const sats = info[6] & 0x0f;
  const latRaw = info.readUInt32BE(7);
  const lngRaw = info.readUInt32BE(11);
  const speedKmh = info.length > 15 ? info[15] : null;
  const courseStatus = info.length > 17 ? info.readUInt16BE(16) : 0;
  const coords = parseCoordinate(latRaw, lngRaw, courseStatus);

  return {
    location: {
      lat: coords.lat,
      lng: coords.lng,
      altitude: null,
      recordedAt,
      satellites: sats,
    },
    speedKmh,
    course: coords.course,
    accuracySource: accuracyFromCourseStatus(courseStatus),
    gpsFixed: coords.gpsFixed,
  };
}

function parseHeartbeat(info) {
  // Terminal info (1) + voltage level (1) + gsm (1) + language/alarm (2) typical
  const terminalInfo = info[0] || 0;
  const voltageLevel = info.length > 1 ? info[1] : null;
  // Map voltage level 0–6 to rough percent
  const batteryMap = [0, 10, 20, 40, 60, 80, 100];
  const batteryPercent =
    voltageLevel != null && voltageLevel >= 0 && voltageLevel <= 6
      ? batteryMap[voltageLevel]
      : null;

  const charging = (terminalInfo & 0x04) !== 0;
  const gpsTracking = (terminalInfo & 0x40) !== 0;
  const alarmBit = terminalInfo & 0x38; // bits 3-5 alarm type on some firmwares

  return {
    batteryPercent,
    charging,
    accuracySource: gpsTracking ? 'gps' : null,
    terminalInfo,
    alarmBit,
  };
}

function parseAlarm(info) {
  // Often similar to location + alarm code; many firmwares: datetime + sats + lat/lng + speed + course + lbs + alarm
  const locationPart = parseLocationInfo(info);
  let alarmCode = null;
  if (info.length >= 25) {
    alarmCode = info[24];
  } else if (info.length > 0) {
    alarmCode = info[info.length - 1];
  }
  const type = ALARM_TYPES[alarmCode] || 'other';
  const severity = type === 'sos' || type === 'fall' ? 'critical' : 'warning';
  return {
    ...locationPart,
    alarmCode,
    type,
    severity,
  };
}

/**
 * Extract complete GT06 frames from a sliding buffer.
 * Supports 0x7878 (1-byte length) and 0x7979 (2-byte length) headers.
 */
function extractFrames(buffer) {
  const frames = [];
  let offset = 0;

  while (offset + 5 <= buffer.length) {
    if (buffer[offset] === 0x78 && buffer[offset + 1] === 0x78) {
      const length = buffer[offset + 2];
      const total = 2 + 1 + length + 2; // start + len + body + stop
      if (offset + total > buffer.length) break;
      const frame = buffer.subarray(offset, offset + total);
      const stopOk = frame[frame.length - 2] === 0x0d && frame[frame.length - 1] === 0x0a;
      if (stopOk) frames.push(frame);
      offset += total;
      continue;
    }

    if (buffer[offset] === 0x79 && buffer[offset + 1] === 0x79) {
      if (offset + 4 > buffer.length) break;
      const length = buffer.readUInt16BE(offset + 2);
      const total = 2 + 2 + length + 2;
      if (offset + total > buffer.length) break;
      const frame = buffer.subarray(offset, offset + total);
      const stopOk = frame[frame.length - 2] === 0x0d && frame[frame.length - 1] === 0x0a;
      if (stopOk) frames.push(frame);
      offset += total;
      continue;
    }

    offset += 1;
  }

  return { frames, rest: buffer.subarray(offset) };
}

function decodeFrame(frame) {
  const isExt = frame[0] === 0x79 && frame[1] === 0x79;
  const lengthOffset = 2;
  const lengthSize = isExt ? 2 : 1;
  const packetLength = isExt ? frame.readUInt16BE(2) : frame[2];
  const protoOffset = lengthOffset + lengthSize;
  const protocol = frame[protoOffset];

  // Body for CRC: length field through serial number (exclude start bits, crc, stop)
  const crcOffset = frame.length - 4; // 2 crc + 2 stop
  const crcExpected = frame.readUInt16BE(crcOffset);
  const crcData = frame.subarray(2, crcOffset);
  const crcActual = crc16Itu(crcData);
  const crcOk = crcExpected === crcActual;

  const infoStart = protoOffset + 1;
  const serialOffset = crcOffset - 2;
  const info = frame.subarray(infoStart, serialOffset);
  const serial = frame.readUInt16BE(serialOffset);

  return {
    protocol,
    info,
    serial,
    crcOk,
    packetLength,
  };
}

function handlePacket(decoded, session) {
  const { protocol, info, serial, crcOk } = decoded;
  const acks = [];
  const events = [];

  if (!crcOk) {
    events.push({ type: 'crc_error' });
    return { acks, events };
  }

  switch (protocol) {
    case PROTO.LOGIN: {
      const imei = bcdImei(info.subarray(0, Math.min(8, info.length)));
      session.imei = imei;
      acks.push(buildAck(PROTO.LOGIN, serial));
      events.push({ type: 'login', imei });
      break;
    }
    case PROTO.LOCATION: {
      const loc = parseLocationInfo(info);
      acks.push(buildAck(PROTO.LOCATION, serial));
      if (loc) events.push({ type: 'location', imei: session.imei, ...loc });
      break;
    }
    case PROTO.HEARTBEAT: {
      const hb = parseHeartbeat(info);
      acks.push(buildAck(PROTO.HEARTBEAT, serial));
      events.push({ type: 'heartbeat', imei: session.imei, ...hb });
      break;
    }
    case PROTO.ALARM:
    case PROTO.GPS_ADDRESS: {
      const alarm = parseAlarm(info);
      acks.push(buildAck(protocol, serial));
      events.push({
        type: 'alarm',
        imei: session.imei,
        alarmType: alarm.type,
        severity: alarm.severity,
        alarmCode: alarm.alarmCode,
        location: alarm.location,
        speedKmh: alarm.speedKmh,
        course: alarm.course,
        accuracySource: alarm.accuracySource,
      });
      break;
    }
    default: {
      // Still ACK unknown to keep some devices happy
      acks.push(buildAck(protocol, serial));
      events.push({ type: 'unknown', protocol, imei: session.imei });
      break;
    }
  }

  return { acks, events };
}

module.exports = {
  PROTO,
  extractFrames,
  decodeFrame,
  handlePacket,
  buildAck,
};
