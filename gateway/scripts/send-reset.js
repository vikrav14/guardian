/**
 * Trigger RESET (device restart) via the gateway HTTP API.
 * Requires gateway running with an active device TCP session.
 *
 * Vendor: V28C Communication Protocol.pdf section II.16 — server sends
 * [SG*YYYYYYYYYY*0005*RESET] (10-digit protocol id, not 15-digit IMEI).
 *
 * Usage:
 *   node scripts/send-reset.js
 *   node scripts/send-reset.js 861397053141170
 *   node scripts/send-reset.js --imei 9705314117 --host 127.0.0.1 --port 9001
 */
const http = require('http');

const args = process.argv.slice(2);
let imei = '861397053141170';
let host = '127.0.0.1';
let port = 9001;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--imei' && args[i + 1]) imei = args[++i];
  else if (args[i] === '--host' && args[i + 1]) host = args[++i];
  else if (args[i] === '--port' && args[i + 1]) port = Number(args[++i]);
  else if (/^\d{10,15}$/.test(args[i])) imei = args[i];
}

const path = `/dev/downlink?imei=${encodeURIComponent(imei)}&command=RESET`;

const req = http.request({ hostname: host, port, path, method: 'POST' }, (res) => {
  let body = '';
  res.on('data', (c) => {
    body += c;
  });
  res.on('end', () => {
    console.log(`HTTP ${res.statusCode}`);
    try {
      console.log(JSON.stringify(JSON.parse(body), null, 2));
    } catch {
      console.log(body);
    }
    process.exit(res.statusCode === 200 ? 0 : 1);
  });
});

req.on('error', (err) => {
  console.error(`request failed: ${err.message}`);
  process.exit(1);
});

req.end();
