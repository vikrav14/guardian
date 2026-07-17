/**
 * Fake V28C / GT06 pendant — sends login, GPS, heartbeat (and optional SOS)
 * to the local Guardian gateway. No hardware required.
 *
 * Usage (gateway must already be running):
 *   npm run simulate
 *   npm run simulate -- --host 127.0.0.1 --port 9000 --imei 359633100123456
 */
const net = require('net');
const { appendCrc } = require('../src/protocol/crc');

function parseArgs(argv) {
  const args = {
    host: '127.0.0.1',
    port: 9000,
    imei: '359633100123456',
    lat: -20.2642,
    lng: 57.4791,
    intervalMs: 5000,
    sos: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--host') args.host = argv[++i];
    else if (a === '--port') args.port = Number(argv[++i]);
    else if (a === '--imei') args.imei = String(argv[++i]);
    else if (a === '--lat') args.lat = Number(argv[++i]);
    else if (a === '--lng') args.lng = Number(argv[++i]);
    else if (a === '--interval') args.intervalMs = Number(argv[++i]);
    else if (a === '--sos') args.sos = true;
  }
  return args;
}

function packFrame(protocol, info, serial) {
  const infoBuf = Buffer.isBuffer(info) ? info : Buffer.from(info || []);
  // length = protocol(1) + info + serial(2) + crc(2)
  const length = 1 + infoBuf.length + 2 + 2;
  const body = Buffer.alloc(1 + 1 + infoBuf.length + 2);
  body[0] = length;
  body[1] = protocol;
  infoBuf.copy(body, 2);
  body.writeUInt16BE(serial & 0xffff, 2 + infoBuf.length);
  const withCrc = appendCrc(body);
  return Buffer.concat([Buffer.from([0x78, 0x78]), withCrc, Buffer.from([0x0d, 0x0a])]);
}

function imeiToBcd(imei) {
  const digits = String(imei).replace(/\D/g, '');
  const padded = digits.padStart(16, '0').slice(-16);
  const out = Buffer.alloc(8);
  for (let i = 0; i < 8; i += 1) {
    out[i] = parseInt(padded.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function datetimeBuf(date = new Date()) {
  const b = Buffer.alloc(6);
  b[0] = date.getUTCFullYear() - 2000;
  b[1] = date.getUTCMonth() + 1;
  b[2] = date.getUTCDate();
  b[3] = date.getUTCHours();
  b[4] = date.getUTCMinutes();
  b[5] = date.getUTCSeconds();
  return b;
}

function buildLogin(imei, serial) {
  return packFrame(0x01, imeiToBcd(imei), serial);
}

function buildLocation({ lat, lng, speedKmh = 5, serial }) {
  const info = Buffer.alloc(18);
  datetimeBuf().copy(info, 0);
  info[6] = 0xc0 | 8;
  const latRaw = Math.round(Math.abs(lat) * 1800000);
  const lngRaw = Math.round(Math.abs(lng) * 1800000);
  info.writeUInt32BE(latRaw, 7);
  info.writeUInt32BE(lngRaw, 11);
  info[15] = Math.max(0, Math.min(255, speedKmh));
  let courseStatus = 45;
  courseStatus |= 0x1000;
  if (lat < 0) courseStatus |= 0x0400;
  if (lng < 0) courseStatus |= 0x0800;
  info.writeUInt16BE(courseStatus, 16);
  return packFrame(0x12, info, serial);
}

function buildHeartbeat(serial, voltageLevel = 5) {
  const info = Buffer.from([
    0x40,
    voltageLevel & 0xff,
    0x04,
    0x00,
    0x01,
  ]);
  return packFrame(0x13, info, serial);
}

function buildSos({ lat, lng, serial }) {
  const info = Buffer.alloc(19);
  datetimeBuf().copy(info, 0);
  info[6] = 0xc0 | 8;
  info.writeUInt32BE(Math.round(Math.abs(lat) * 1800000), 7);
  info.writeUInt32BE(Math.round(Math.abs(lng) * 1800000), 11);
  info[15] = 0;
  let courseStatus = 0x1000;
  if (lat < 0) courseStatus |= 0x0400;
  if (lng < 0) courseStatus |= 0x0800;
  info.writeUInt16BE(courseStatus, 16);
  info[18] = 0x01;
  return packFrame(0x16, info, serial);
}

function hex(buf) {
  return Buffer.from(buf).toString('hex');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let serial = 1;

  console.log(`[simulate] connecting to ${args.host}:${args.port} as IMEI ${args.imei}`);
  console.log(`[simulate] location ${args.lat}, ${args.lng}`);

  const socket = net.connect({ host: args.host, port: args.port }, () => {
    console.log('[simulate] connected');

    const login = buildLogin(args.imei, serial++);
    console.log('[simulate] → LOGIN', hex(login));
    socket.write(login);

    setTimeout(() => {
      const loc = buildLocation({ lat: args.lat, lng: args.lng, serial: serial++ });
      console.log('[simulate] → LOCATION', hex(loc));
      socket.write(loc);
    }, 300);

    setTimeout(() => {
      const hb = buildHeartbeat(serial++);
      console.log('[simulate] → HEARTBEAT', hex(hb));
      socket.write(hb);
    }, 600);

    if (args.sos) {
      setTimeout(() => {
        const sos = buildSos({ lat: args.lat, lng: args.lng, serial: serial++ });
        console.log('[simulate] → SOS', hex(sos));
        socket.write(sos);
      }, 900);
    }

    setInterval(() => {
      // Walk ~25–40 m each tick so the map marker clearly moves.
      const stepMeters = 25 + Math.random() * 15;
      const bearing = Math.random() * Math.PI * 2;
      const dLat = (stepMeters * Math.cos(bearing)) / 111320;
      const dLng =
        (stepMeters * Math.sin(bearing)) /
        (111320 * Math.cos((args.lat * Math.PI) / 180));
      args.lat += dLat;
      args.lng += dLng;
      const speedKmh = Math.max(3, Math.round((stepMeters / (args.intervalMs / 1000)) * 3.6));
      const loc = buildLocation({
        lat: args.lat,
        lng: args.lng,
        speedKmh,
        serial: serial++,
      });
      console.log('[simulate] → LOCATION', args.lat.toFixed(5), args.lng.toFixed(5), `${speedKmh} km/h`);
      socket.write(loc);
      socket.write(buildHeartbeat(serial++, 4 + Math.floor(Math.random() * 3)));
    }, args.intervalMs);
  });

  socket.on('data', (chunk) => {
    console.log('[simulate] ← ACK', hex(chunk));
  });

  socket.on('error', (err) => {
    console.error('[simulate] error:', err.message);
    console.error('[simulate] Is the gateway running?  cd gateway && npm start');
    process.exit(1);
  });

  socket.on('close', () => {
    console.log('[simulate] connection closed');
    process.exit(0);
  });
}

main();
