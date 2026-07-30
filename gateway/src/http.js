const http = require('http');
const { URL } = require('url');
const crypto = require('crypto');
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

// Phase 1: New provider abstraction and support layers
const { createLlmProvider } = require('./providers');
const { classifyIntent, isCritical } = require('./intent-classifier');
const {
  validateLocationResponse,
  validateDeviceStatusResponse,
  validateAlertsResponse,
  validateSafeZoneResponse,
  validateDeviceCommandResponse,
  validateReminderResponse,
} = require('./response-validator');
const { buildContextPacket, buildSystemPrompt, selectAllowedTools } = require('./request-context');
const { AuditLog } = require('./audit');
const { IdempotencyStore } = require('./idempotency');
const { TOOL_DEFINITIONS, runTool } = require('./assistant/tools');

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

// Phase 1: Initialize LLM provider and support systems
let llmProvider = null;
let auditLog = null;
let idempotencyStore = null;

function initializeLlmStack() {
  try {
    llmProvider = createLlmProvider(config);
    console.log(`[guardian-http] LLM provider initialized (${config.llmProvider || 'auto'})`);
  } catch (err) {
    console.error('[guardian-http] Failed to initialize LLM provider:', err.message);
    llmProvider = null;
  }

  auditLog = new AuditLog(config);
  idempotencyStore = new IdempotencyStore(5); // 5-minute TTL
  console.log('[guardian-http] Audit logging and idempotency initialized');
}

function generateRequestId() {
  return 'req_' + crypto.randomUUID().substring(0, 8);
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

/**
 * Phase 1: Integrated handleChat with provider abstraction, intent classification,
 * response validation, and full audit trail.
 */
async function handleChat({ from, text }) {
  const requestId = generateRequestId();
  const started = Date.now();
  const db = getDb();

  try {
    // [1] Log request start
    await auditLog.recordStart({ requestId, fromPhone: from });

    // [2] Check idempotency (Twilio may retry)
    if (idempotencyStore.isSeen(requestId)) {
      const cached = idempotencyStore.getCachedReply(requestId);
      console.log(`[assistant] ${requestId} DUPLICATE (cached reply)`);
      return { ctx: { from }, reply: cached, isDuplicate: true };
    }

    // [3] Resolve caller context (authentication)
    const ctx = await resolveCallerContext(db, from);
    console.log(`[assistant] ${requestId} from=${ctx.from} uid=${ctx.uid} devices=${ctx.linkedImeis.length}`);

    await auditLog.recordAuth({
      requestId,
      uid: ctx.uid,
      linkedImeis: ctx.linkedImeis,
      status: ctx.uid ? 'authenticated' : 'not_registered',
      reason: ctx.uid ? 'user_found' : 'no_matching_user',
    });

    // [4] Classify intent (deterministic, no LLM)
    const intent = classifyIntent(text);
    await auditLog.recordIntent({ requestId, intent });

    // [5] Handle critical intents immediately (SOS, emergency)
    if (isCritical(intent)) {
      const reply =
        ctx.uid
          ? `Emergency detected. Dispatching to ${ctx.displayName}'s emergency contacts now.`
          : "This number isn't registered. Contact emergency services directly or ask your guardian to register you.";

      idempotencyStore.store(requestId, reply);
      await auditLog.recordResponse({
        requestId,
        destination: 'whatsapp',
        replyLength: reply.length,
        fallbackReason: 'critical_intent',
      });

      return { ctx, reply };
    }

    // [6] Check authentication for non-critical requests
    if (!ctx.uid) {
      const reply =
        "This number isn't registered with any Guardian family yet. Ask your guardian to add you as a contact in the app first.";
      idempotencyStore.store(requestId, reply);
      await auditLog.recordResponse({
        requestId,
        destination: 'whatsapp',
        replyLength: reply.length,
        fallbackReason: 'not_registered',
      });
      return { ctx, reply };
    }

    // [7] Build minimal context packet (not full device doc)
    const wearer = ctx.linkedImeis.length === 1 ? { id: ctx.linkedImeis[0], displayName: ctx.displayName } : null;
    const device = ctx.devices[0] || null;
    const contextPacket = buildContextPacket({
      requestId,
      requester: { uid: ctx.uid, displayName: ctx.displayName, role: 'guardian', linkedImeis: ctx.linkedImeis },
      wearer,
      device,
      intent,
      locale: 'en', // TODO: detect from user preferences
    });

    // [8] Call LLM provider with tool-calling
    let reply = null;
    let providerUsage = null;
    let toolsUsed = [];
    let lastLocationToolResult = null; // Capture location result for validation (outer scope)

    if (!llmProvider) {
      // Fallback: use existing Claude integration
      const result = await answerWithAssistant(db, ctx, text);
      reply = result.reply;
      providerUsage = result.usage;
      toolsUsed = result.toolsUsed || [];
    } else {
      // Phase 1 & 2: Use new provider abstraction with intent-specific prompts
      const systemPrompt = contextPacket.systemPrompt; // Already computed by buildContextPacket
      const allowedTools = contextPacket.allowedTools; // Already computed by buildContextPacket
      const filteredTools = TOOL_DEFINITIONS.filter((t) => allowedTools.includes(t.name));

      const messages = [{ role: 'user', content: text }];

      try {
        // Full agentic loop: call provider, execute tools, repeat until text response
        let finalReply = null;
        let lastProviderResult = null;
        const currentMessages = [...messages];
        let roundCount = 0;
        const maxRounds = 3;

        while (roundCount < maxRounds && !finalReply) {
          roundCount += 1;

          lastProviderResult = await llmProvider.complete({
            systemPrompt,
            messages: currentMessages,
            tools: filteredTools,
            metadata: { requestId, userId: ctx.uid, locale: 'en' },
          });

          providerUsage = lastProviderResult.usage;

          // Handle tool use first (if stopReason is tool_use, prioritize that over text)
          const toolUses = (lastProviderResult.content || []).filter((b) => b.type === 'tool_use');

          if (toolUses.length > 0) {
            // Claude wants to use tools — execute them and continue loop
            // Don't return text yet, even if present
          } else {
            // No tools called — check for text response
            const textBlocks = (lastProviderResult.content || []).filter((b) => b.type === 'text');
            if (textBlocks.length > 0) {
              finalReply = textBlocks.map((b) => b.text || b.content).join('\n');
              break;
            } else {
              // No text and no tools = error
              break;
            }
          }

          // Execute tools
          const toolResults = [];
          for (const toolUse of toolUses) {
            toolsUsed.push(toolUse.name);
            try {
              const result = await runTool(db, ctx, toolUse.name, toolUse.input || {});
              // Capture location result for validation
              if (toolUse.name === 'get_last_location') {
                lastLocationToolResult = result;
              }
              toolResults.push({
                type: 'tool_result',
                tool_use_id: toolUse.id,
                content: JSON.stringify(result),
              });
            } catch (err) {
              toolResults.push({
                type: 'tool_result',
                tool_use_id: toolUse.id,
                content: JSON.stringify({ error: err.message }),
              });
            }
          }

          // Add assistant response + tool results to message history for next round
          currentMessages.push({ role: 'assistant', content: lastProviderResult.content });
          currentMessages.push({ role: 'user', content: toolResults });
        }

        reply = finalReply;

        if (lastProviderResult) {
          await auditLog.recordProvider({
            requestId,
            provider: lastProviderResult.provider,
            model: config[`${lastProviderResult.provider}Model`],
            tokensIn: providerUsage?.input_tokens || 0,
            tokensOut: providerUsage?.output_tokens || 0,
            latencyMs: lastProviderResult.latencyMs,
            toolNames: toolsUsed,
            stopReason: lastProviderResult.stopReason,
          });
        }
      } catch (err) {
        console.warn(`[assistant] ${requestId} Provider failed, using fallback:`, err.message);
        await auditLog.recordError({ requestId, phase: 'provider', error: err });

        // Fallback to template
        reply = `I'm having trouble reaching live data right now. Try again in a moment, or check the app for ${wearer?.displayName || 'your loved one'}'s location.`;
      }
    }

    // [9] Validate response (catch hallucinations)
    // Apply intent-specific validation
    if (reply) {
      let validation = { valid: true, issues: [] };

      if (intent.type === 'LOCATION_REQUEST' && lastLocationToolResult) {
        validation = validateLocationResponse(reply, lastLocationToolResult, { medicalClaimsAllowed: false });
      } else if (intent.type === 'DEVICE_STATUS' && lastLocationToolResult) {
        validation = validateDeviceStatusResponse(reply, lastLocationToolResult);
      } else if (intent.type === 'RECENT_ALERTS') {
        // Validation for alerts (uses lastLocationToolResult but checks alert format)
        validation = validateAlertsResponse(reply, lastLocationToolResult);
      } else if (intent.type === 'SAFE_ZONE_CHECK' && lastLocationToolResult) {
        validation = validateSafeZoneResponse(reply, lastLocationToolResult);
      } else if (intent.type === 'DEVICE_COMMAND') {
        validation = validateDeviceCommandResponse(reply, lastLocationToolResult);
      } else if (intent.type === 'VOICE_MONITOR') {
        validation = validateDeviceCommandResponse(reply, lastLocationToolResult);
      } else if (intent.type === 'REMINDER_REQUEST') {
        validation = validateReminderResponse(reply, lastLocationToolResult);
      }

      await auditLog.recordValidation({ requestId, valid: validation.valid, issues: validation.issues });

      if (!validation.valid) {
        console.warn(`[assistant] ${requestId} Response validation failed:`, validation.issues);
        reply = `I could not process your request properly. Try again in a moment.`;
      }
    }

    // [10] Cache and send reply
    if (!reply) {
      reply = `I could not process your request. I'm designed mainly for family safety questions.`;
    }

    idempotencyStore.store(requestId, reply);

    await auditLog.recordResponse({
      requestId,
      destination: 'whatsapp',
      replyLength: reply.length,
      fallbackReason: null,
    });

    // Legacy metrics (for backward compatibility)
    if (providerUsage) {
      recordAiDecision({
        toolsUsed,
        tokensIn: providerUsage.input_tokens || 0,
        tokensOut: providerUsage.output_tokens || 0,
        latencyMs: Date.now() - started,
        callerPhone: ctx.from,
      });
    }

    return { ctx, reply };
  } catch (err) {
    console.error(`[assistant] ${requestId} Unhandled error:`, err);
    await auditLog.recordError({ requestId, phase: 'handle_chat', error: err });

    const reply = 'Sorry — I encountered an error. Try again in a moment.';
    idempotencyStore.store(requestId, reply);

    return { ctx: { from }, reply };
  }
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
  // Phase 1: Initialize LLM provider, audit, and idempotency on startup
  initializeLlmStack();

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

        // Auto-stop ring after 60 seconds (device firmware doesn't auto-stop as documented)
        if (command === 'find#' && result.ok) {
          setTimeout(() => {
            try {
              sendContinuousReporting(imei);
              console.log(`[ring-auto-stop] sent CR to ${imei} to interrupt ring after 60s`);
            } catch (err) {
              console.error(`[ring-auto-stop] failed for ${imei}:`, err.message);
            }
          }, 60_000);
        }

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
