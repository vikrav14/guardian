const http = require('http');
const { URL } = require('url');
const config = require('./config');
const { getDb } = require('./firestore');
const { resolveCallerContext } = require('./assistant/tools');
const { answerWithAssistant } = require('./assistant/claude');
const { sendWhatsApp, normalizeE164 } = require('./notify');
const { sendContinuousReporting, sendDownlinkCommand } = require('./downlink');
const { estimateMonthlyCost } = require('./cost-engine');
const {
  checkAdminAuth,
  getMetricsResponse,
  recordAssistantUsage,
  increment: incrementMetric,
} = require('./ops-metrics');

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key, Authorization',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendOptions(res) {
  res.writeHead(204, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key, Authorization',
  });
  res.end();
}

function parseBoolParam(value, defaultValue) {
  if (value == null || value === '') return defaultValue;
  return String(value).toLowerCase() === 'true';
}

function sendTwiml(res, message) {
  const escaped = String(message || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`;
  res.writeHead(200, { 'Content-Type': 'text/xml' });
  res.end(xml);
}

async function handleChat({ from, text }) {
  const db = getDb();
  const ctx = await resolveCallerContext(db, from);
  console.log(`[assistant] from=${ctx.from} devices=${ctx.linkedImeis.length} text=${JSON.stringify(text)}`);

  if (!ctx.uid) {
    return {
      ctx,
      reply:
        "This number isn't registered with any Guardian family yet. Ask your guardian to add you as a contact in the app first.",
    };
  }

  const assistantResult = await answerWithAssistant(db, ctx, text);
  if (assistantResult.usage) {
    recordAssistantUsage(assistantResult.usage);
  } else {
    incrementMetric('assistantRequests');
  }
  return { ctx, reply: assistantResult.reply };
}

function startHttpServer() {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

      if (req.method === 'OPTIONS') {
        sendOptions(res);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/health') {
        sendJson(res, 200, { ok: true, service: 'guardian-gateway-http' });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/ops/metrics') {
        const auth = checkAdminAuth(req);
        if (!auth.ok) {
          sendJson(res, auth.status, { error: auth.error });
          return;
        }
        sendJson(res, 200, getMetricsResponse());
        return;
      }

      if (req.method === 'GET' && url.pathname === '/ops/cost-estimate') {
        const auth = checkAdminAuth(req);
        if (!auth.ok) {
          sendJson(res, auth.status, { error: auth.error });
          return;
        }
        const estimate = estimateMonthlyCost({
          users: Number(url.searchParams.get('users') || 500),
          gpsIntervalSec: Number(url.searchParams.get('gpsIntervalSec') || 60),
          historyOn: parseBoolParam(url.searchParams.get('historyOn'), false),
          journeyCompression: parseBoolParam(url.searchParams.get('journeyCompression'), true),
          whatsappPct: Number(url.searchParams.get('whatsappPct') || 15),
          aiNarrationOn: parseBoolParam(url.searchParams.get('aiNarrationOn'), true),
        });
        sendJson(res, 200, estimate);
        return;
      }

      // Force GPS continuous reporting (CR) on an active TCP session
      if (
        (req.method === 'POST' || req.method === 'GET') &&
        (url.pathname === '/dev/send-cr' || url.pathname === '/dev/downlink')
      ) {
        const imei =
          url.searchParams.get('imei') ||
          url.searchParams.get('protocolId') ||
          '861397053141170';
        const command = url.searchParams.get('command') || 'CR';
        const result =
          command === 'CR'
            ? sendContinuousReporting(imei)
            : sendDownlinkCommand(imei, command);
        sendJson(res, result.ok ? 200 : 404, result);
        return;
      }

      // Local / ngrok test without Twilio
      if (req.method === 'POST' && url.pathname === '/dev/chat') {
        const raw = await readBody(req);
        const payload = raw ? JSON.parse(raw) : {};
        const from = payload.from || '+23050000000';
        const text = payload.text || payload.body || '';
        if (!text.trim()) {
          sendJson(res, 400, { error: 'text required' });
          return;
        }
        const { reply } = await handleChat({ from, text: text.trim() });
        sendJson(res, 200, { reply });
        return;
      }

      // Twilio WhatsApp inbound webhook
      if (req.method === 'POST' && url.pathname === '/webhooks/twilio/whatsapp') {
        const raw = await readBody(req);
        const params = new URLSearchParams(raw);
        const from = params.get('From') || '';
        const text = (params.get('Body') || '').trim();

        if (!text) {
          sendTwiml(res, 'Send a question like “Where’s mum?” or “Battery?”');
          return;
        }

        // Reply async via API when possible (avoids Twilio 15s timeout on slow LLM).
        // Still return a short TwiML ack immediately if sendWhatsApp is not configured.
        incrementMetric('whatsappInbound');
        const { reply } = await handleChat({ from, text });
        const wa = await sendWhatsApp(from.replace(/^whatsapp:/i, ''), reply);
        if (wa.ok || wa.skipped) {
          // If skipped (no Twilio out), fall back to TwiML so sandbox still answers.
          if (wa.skipped) {
            sendTwiml(res, reply);
          } else {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end();
          }
        } else {
          console.error('[assistant] whatsapp send failed', wa);
          sendTwiml(res, reply);
        }
        return;
      }

      sendJson(res, 404, { error: 'not found' });
    } catch (err) {
      console.error('[http]', err);
      if (!res.headersSent) {
        sendJson(res, 500, { error: err.message || 'server error' });
      }
    }
  });

  server.listen(config.httpPort, config.host, () => {
    console.log(`[guardian-http] listening on ${config.host}:${config.httpPort}`);
    console.log('[guardian-http] POST /webhooks/twilio/whatsapp');
    console.log('[guardian-http] POST /dev/chat  { "from": "+2305…", "text": "Where is mum?" }');
    console.log('[guardian-http] GET  /ops/metrics  (admin key if ADMIN_API_KEY set)');
    console.log('[guardian-http] GET  /ops/cost-estimate?users=500');
  });

  return server;
}

module.exports = {
  startHttpServer,
  handleChat,
  normalizeE164,
};
