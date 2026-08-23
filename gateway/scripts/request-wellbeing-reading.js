'use strict';

function readArgument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function main() {
  const imei = String(readArgument('imei') || '').trim();
  if (!/^\d{15}$/.test(imei)) {
    throw new Error('--imei requires the 15-digit hardware IMEI');
  }
  const config = require('../src/config');
  if (!config.adminApiKey) throw new Error('ADMIN_API_KEY is required');
  const metricSet = readArgument('metric') || 'heart_rate_blood_pressure';
  const url = `http://127.0.0.1:${config.httpPort}/admin/device-wellbeing/request`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Key': config.adminApiKey,
    },
    body: JSON.stringify({ imei, metricSet }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  console.log(JSON.stringify({
    ok: payload.ok,
    protocolId: payload.protocolId,
    command: payload.command,
    sessions: payload.sessions,
    pilotOnly: true,
  }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  });
}
