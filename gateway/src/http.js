const http = require('http');
const { URL } = require('url');
const config = require('./config');
const { getDb } = require('./firestore');
const { resolveCallerContext } = require('./assistant/tools');
const { answerWithAssistant } = require('./assistant/claude');
const { sendWhatsApp, normalizeE164 } = require('./notify');
const { sendContinuousReporting, sendDownlinkCommand } = require('./downlink');
const { recordAiDecision } = require('./ai-telemetry');
const {
  checkAdminAuth,
  getMetricsResponse,
  getFleetResponse,
  getFinanceResponse,
  getGrowthResponse,
  getAiStatsResponse,
  estimateCostSensitivity,
  estimateMonthlyCost,
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

function parseCostParams(url) {
  return {
    users: Number(url.searchParams.get('users') || 500),
    gpsIntervalSec: Number(url.searchParams.get('gpsIntervalSec') || 60),
    historyOn: parseBoolParam(url.searchParams.get('historyOn'), false),
    journeyCompression: parseBoolParam(url.searchParams.get('journeyCompression'), true),
    whatsappPct: Number(url.searchParams.get('whatsappPct') || 15),
    aiNarrationOn: parseBoolParam(url.searchParams.get('aiNarrationOn'), true),
  };
}

function parseGrowthParams(url) {
  return {
    users: Number(url.searchParams.get('users') || 500),
    growthRatePct: Number(url.searchParams.get('growthRate') || 5),
    churnPct: Number(url.searchParams.get('churn') || 2),
    deviceCostMur: url.searchParams.has('deviceCost')
      ? Number(url.searchParams.get('deviceCost'))
      : undefined,
    deviceSaleMur: url.searchParams.has('salePrice')
      ? Number(url.searchParams.get('salePrice'))
      : undefined,
    subscriptionMur: url.searchParams.has('subscription')
      ? Number(url.searchParams.get('subscription'))
      : undefined,
    supportMarketingPerUserMur: url.searchParams.has('supportCost')
      ? Number(url.searchParams.get('supportCost'))
      : undefined,
    gpsIntervalSec: Number(url.searchParams.get('gpsIntervalSec') || 60),
    historyOn: parseBoolParam(url.searchParams.get('historyOn'), false),
    journeyCompression: parseBoolParam(url.searchParams.get('journeyCompression'), true),
    whatsappPct: Number(url.searchParams.get('whatsappPct') || 15),
    aiNarrationOn: parseBoolParam(url.searchParams.get('aiNarrationOn'), true),
  };
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
  const started = Date.now();
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
  const latencyMs = Date.now() - started;

  if (assistantResult.usage) {
    recordAiDecision({
      toolsUsed: assistantResult.toolsUsed || [],
      tokensIn: assistantResult.usage.input_tokens || 0,
      tokensOut: assistantResult.usage.output_tokens || 0,
      latencyMs,
      callerPhone: ctx.from,
    });
  } else {
    recordAiDecision({
      toolsUsed: [],
      latencyMs,
      callerPhone: ctx.from,
    });
  }

  return { ctx, reply: assistantResult.reply };
}

async function requireAdmin(req, res) {
  const auth = await checkAdminAuth(req);
  if (!auth.ok) {
    sendJson(res, auth.status, { error: auth.error });
    return false;
  }
  return true;
}

async function handleOpsHttpRequest(req, res, url) {
  if (req.method !== 'GET' || !url.pathname.startsWith('/ops/')) {
    return false;
  }

  if (!(await requireAdmin(req, res))) {
    return true;
  }

  switch (url.pathname) {
    case '/ops/metrics':
      sendJson(res, 200, getMetricsResponse());
      return true;

    case '/ops/fleet':
      sendJson(res, 200, await getFleetResponse());
      return true;

    case '/ops/finance': {
      const assumptions = {
        users: Number(url.searchParams.get('users') || 500),
        devicesSoldToday: Number(url.searchParams.get('devicesSoldToday') || 0),
        devicesSoldMonth: Number(url.searchParams.get('devicesSoldMonth') || 0),
        subscriptionsSoldToday: Number(url.searchParams.get('subscriptionsSoldToday') || 0),
        subscriptionsSoldMonth: Number(url.searchParams.get('subscriptionsSoldMonth') || 0),
        monthlyBudgetMur: url.searchParams.has('budget')
          ? Number(url.searchParams.get('budget'))
          : undefined,
      };
      sendJson(res, 200, await getFinanceResponse(assumptions));
      return true;
    }

    case '/ops/growth':
      sendJson(res, 200, getGrowthResponse(parseGrowthParams(url)));
      return true;

    case '/ops/ai-stats':
      sendJson(res, 200, getAiStatsResponse());
      return true;

    case '/ops/cost-estimate': {
      const params = parseCostParams(url);
      const withSensitivity = parseBoolParam(url.searchParams.get('sensitivity'), false);
      sendJson(
        res,
        200,
        withSensitivity ? estimateCostSensitivity(params) : estimateMonthlyCost(params)
      );
      return true;
    }

    default:
      return false;
  }
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

      if (await handleOpsHttpRequest(req, res, url)) {
        return;
      }

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

      if (req.method === 'POST' && url.pathname === '/webhooks/twilio/whatsapp') {
        const raw = await readBody(req);
        const params = new URLSearchParams(raw);
        const from = params.get('From') || '';
        const text = (params.get('Body') || '').trim();

        if (!text) {
          sendTwiml(res, 'Send a question like “Where’s mum?” or “Battery?”');
          return;
        }

        incrementMetric('whatsappInbound');
        const { reply } = await handleChat({ from, text });
        const wa = await sendWhatsApp(from.replace(/^whatsapp:/i, ''), reply);
        if (wa.ok || wa.skipped) {
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
    console.log('[guardian-http] GET  /ops/fleet');
    console.log('[guardian-http] GET  /ops/finance');
    console.log('[guardian-http] GET  /ops/growth?users=500');
    console.log('[guardian-http] GET  /ops/ai-stats');
    console.log('[guardian-http] GET  /ops/cost-estimate?users=500&sensitivity=true');
  });

  return server;
}

module.exports = {
  startHttpServer,
  handleChat,
  normalizeE164,
};
