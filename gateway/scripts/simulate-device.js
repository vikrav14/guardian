/**
 * Fake ReachFar V28C pendant — sends ASCII protocol packets (login, GPS, heartbeat, optional SOS)
 * to the local Guardian gateway. No hardware required.
 *
 * Uses the actual ReachFar V28C ASCII protocol: [CS*IMEI*LEN*command,data...]
 *
 * Usage (gateway must already be running):
 *   npm run simulate
 *   npm run simulate -- --host 127.0.0.1 --port 9000 --imei 861397053139877
 */
const net = require('net');

function parseArgs(argv) {
  const args = {
    host: '127.0.0.1',
    port: 9000,
    imei: '861397053139877',
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

function formatTime(date = new Date()) {
  const d = String(date.getUTCDate()).padStart(2, '0');
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const y = String(date.getUTCFullYear()).slice(-2);
  const h = String(date.getUTCHours()).padStart(2, '0');
  const min = String(date.getUTCMinutes()).padStart(2, '0');
  const s = String(date.getUTCSeconds()).padStart(2, '0');
  return { dateStr: `${d}${m}${y}`, timeStr: `${h}${min}${s}` };
}

function buildAsciiFrame(factory, imei, command, payload = '') {
  // [factory*imei*LEN*command,payload...]
  const content = payload ? `${command},${payload}` : command;
  const lenHex = content.length.toString(16).toUpperCase().padStart(4, '0');
  const frame = `[${factory}*${imei}*${lenHex}*${content}]`;
  return Buffer.from(frame, 'ascii');
}

function buildHeartbeat(imei, battery = 80) {
  return buildAsciiFrame('3G', imei, 'LK', `0,0,${battery}`);
}

function buildLocation(imei, { lat, lng, speedKmh = 5 }) {
  const { dateStr, timeStr } = formatTime();
  const latAbs = Math.abs(lat).toFixed(6);
  const lngAbs = Math.abs(lng).toFixed(6);
  const latDir = lat >= 0 ? 'N' : 'S';
  const lngDir = lng >= 0 ? 'E' : 'W';
  const course = '45';
  const payload = `${dateStr},${timeStr},A,${latAbs},${latDir},${lngAbs},${lngDir},${speedKmh.toFixed(2)},${course}`;
  return buildAsciiFrame('3G', imei, 'UD_LTE', payload);
}

function buildAlarm(imei, { lat, lng }) {
  const { dateStr, timeStr } = formatTime();
  const latAbs = Math.abs(lat).toFixed(6);
  const lngAbs = Math.abs(lng).toFixed(6);
  const latDir = lat >= 0 ? 'N' : 'S';
  const lngDir = lng >= 0 ? 'E' : 'W';
  const payload = `${dateStr},${timeStr},A,${latAbs},${latDir},${lngAbs},${lngDir},0,0,00010000`;
  return buildAsciiFrame('3G', imei, 'AL_LTE', payload);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  console.log(`[simulate] connecting to ${args.host}:${args.port} as IMEI ${args.imei}`);
  console.log(`[simulate] location ${args.lat}, ${args.lng}`);

  const socket = net.connect({ host: args.host, port: args.port }, () => {
    console.log('[simulate] connected, sending: LK → LOCATION → HEARTBEAT');

    // Send heartbeat/keep-alive (LK)
    socket.write(buildHeartbeat(args.imei, 80));

    // Send location after 300ms
    setTimeout(() => {
      const loc = buildLocation(args.imei, { lat: args.lat, lng: args.lng });
      console.log(`[simulate] → UD_LTE ${args.lat.toFixed(5)} ${args.lng.toFixed(5)}`);
      socket.write(loc);
    }, 300);

    // Send another heartbeat after 600ms
    setTimeout(() => {
      socket.write(buildHeartbeat(args.imei, 80));
      console.log('[simulate] → LK');
    }, 600);

    // Send SOS alarm if --sos flag
    if (args.sos) {
      setTimeout(() => {
        const sos = buildAlarm(args.imei, { lat: args.lat, lng: args.lng });
        console.log('[simulate] → AL_LTE (SOS)');
        socket.write(sos);
      }, 900);
    }

    // Periodically send location and heartbeat
    setInterval(() => {
      // Simulate movement: walk ~25–40 m each tick
      const stepMeters = 25 + Math.random() * 15;
      const bearing = Math.random() * Math.PI * 2;
      const dLat = (stepMeters * Math.cos(bearing)) / 111320;
      const dLng =
        (stepMeters * Math.sin(bearing)) /
        (111320 * Math.cos((args.lat * Math.PI) / 180));
      args.lat += dLat;
      args.lng += dLng;
      const speedKmh = Math.max(3, Math.round((stepMeters / (args.intervalMs / 1000)) * 3.6));

      const loc = buildLocation(args.imei, {
        lat: args.lat,
        lng: args.lng,
        speedKmh,
      });
      console.log(`[simulate] → UD_LTE ${args.lat.toFixed(5)} ${args.lng.toFixed(5)} ${speedKmh} km/h`);
      socket.write(loc);

      // Also send heartbeat with random battery level
      socket.write(buildHeartbeat(args.imei, 40 + Math.floor(Math.random() * 50)));
    }, args.intervalMs);
  });

  socket.on('data', (chunk) => {
    console.log('[simulate] ← ACK', chunk.toString('ascii'));
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
