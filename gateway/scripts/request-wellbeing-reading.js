'use strict';

function readArgument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function buildRequestPayload({ imei, metricSet, scheduleSeconds, stop }) {
  if (stop && scheduleSeconds != null) {
    throw new Error('Choose either --stop or --schedule-seconds, not both');
  }
  if (stop) return { imei, metricSet, action: 'stop' };
  if (scheduleSeconds != null) {
    const intervalSeconds = Number(scheduleSeconds);
    if (!Number.isInteger(intervalSeconds) || intervalSeconds < 300 || intervalSeconds > 65535) {
      throw new Error('--schedule-seconds must be a whole number from 300 to 65535');
    }
    return { imei, metricSet, action: 'schedule', intervalSeconds };
  }
  return { imei, metricSet, action: 'single' };
}

async function main() {
  const imei = String(readArgument('imei') || '').trim();
  if (!/^\d{15}$/.test(imei)) {
    throw new Error('--imei requires the 15-digit hardware IMEI');
  }
  const config = require('../src/config');
  if (!config.adminApiKey) throw new Error('ADMIN_API_KEY is required');
  const metricSet = readArgument('metric') || 'heart_rate_blood_pressure';
  const requestPayload = buildRequestPayload({
    imei,
    metricSet,
    scheduleSeconds: readArgument('schedule-seconds'),
    stop: hasFlag('stop'),
  });
  const url = `http://127.0.0.1:${config.httpPort}/admin/device-wellbeing/request`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Key': config.adminApiKey,
    },
    body: JSON.stringify(requestPayload),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  console.log(JSON.stringify({
    ok: payload.ok,
    protocolId: payload.protocolId,
    command: payload.command,
    action: payload.action,
    intervalSeconds: payload.intervalSeconds,
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

module.exports = { buildRequestPayload };
