/**
 * On startup, detect a local ngrok TCP tunnel and print the vendor SMS to
 * point a pendant at the current host/port (free ngrok URLs rotate on restart).
 */

const NGROK_API_PORTS = [4040, 4041];

function parseTcpPublicUrl(publicUrl) {
  const match = String(publicUrl || '').match(/^tcp:\/\/([^:]+):(\d+)$/i);
  if (!match) return null;
  return { host: match[1], port: Number(match[2]) };
}

/**
 * @param {object} payload ngrok /api/tunnels JSON
 * @param {number} localPort gateway TCP port (default 9000)
 */
function findTcpTunnelForPort(payload, localPort = 9000) {
  const tunnels = payload?.tunnels;
  if (!Array.isArray(tunnels)) return null;

  for (const tunnel of tunnels) {
    if (tunnel.proto !== 'tcp') continue;
    const addr = tunnel.config?.addr || '';
    const normalized = addr.replace(/^localhost:/i, '127.0.0.1:');
    if (normalized !== `127.0.0.1:${localPort}` && addr !== `localhost:${localPort}`) {
      continue;
    }
    const parsed = parseTcpPublicUrl(tunnel.public_url);
    if (parsed) return parsed;
  }
  return null;
}

function formatServerSwitchSms({ host, port }) {
  // Switch-Server PDF: ip command has no pw prefix (unlike center/apn/ts).
  return `ip,${host},${port}#`;
}

async function fetchNgrokTunnels(apiPort) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const res = await fetch(`http://127.0.0.1:${apiPort}/api/tunnels`, {
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function discoverNgrokTunnel(localPort = 9000) {
  for (const apiPort of NGROK_API_PORTS) {
    const payload = await fetchNgrokTunnels(apiPort);
    const tunnel = findTcpTunnelForPort(payload, localPort);
    if (tunnel) return tunnel;
  }
  return null;
}

async function logNgrokHint(localPort = 9000) {
  const tunnel = await discoverNgrokTunnel(localPort);
  if (!tunnel) {
    console.log(
      '[ngrok-hint] no local ngrok TCP tunnel found — run: ngrok tcp ' +
        `${localPort}  then SMS: ip,{host},{port}#`
    );
    return;
  }

  const sms = formatServerSwitchSms(tunnel);
  console.log(
    `[ngrok-hint] pendant server SMS (send to SIM in device): ${sms}`
  );
  console.log(
    `[ngrok-hint] tcp://${tunnel.host}:${tunnel.port} → localhost:${localPort}`
  );
  console.log(
    '[ngrok-hint] re-send after every ngrok restart — old URLs stop working'
  );
}

module.exports = {
  parseTcpPublicUrl,
  findTcpTunnelForPort,
  formatServerSwitchSms,
  discoverNgrokTunnel,
  logNgrokHint,
};
