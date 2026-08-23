const http = require('http');
const { URL } = require('url');
const crypto = require('crypto');
const config = require('./config');
const { getDb } = require('./firestore');
const {
  resolveCallerContext,
  restrictedCallerReply,
} = require('./assistant/tools');
const { answerWithAssistant } = require('./assistant/claude');
const { normalizeE164 } = require('./notify');
const { sendMetaText } = require('./whatsapp-meta');
const {
  verifyMetaWebhookChallenge,
  verifyMetaSignature,
  extractMetaInboundMessages,
  extractMetaDeliveryStatuses,
  MetaMessageDeduper,
} = require('./meta-webhook');
const { recordMetaDeliveryStatus } = require('./meta-delivery');
const { sendContinuousReporting, sendDownlinkCommand } = require('./downlink');
const { provisionPhonebookContact } = require('./phonebook-provisioning');
const { provisionActivitySteps } = require('./activity-steps-provisioning');
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
const { decideInboundRoute } = require('./whatsapp-policy');
const {
  validateLocationResponse,
  validateBatteryResponse,
  validateDeviceStatusResponse,
  validateAlertsResponse,
  validateSafeZoneResponse,
  validateDeviceCommandResponse,
  validateReminderResponse,
} = require('./response-validator');
const { formatBatteryReply } = require('./battery-freshness');
const { formatJourneyReply } = require('./journey-reply');
const { formatDailySummaryReply } = require('./daily-summary-reply');
const { formatActivityReply } = require('./activity-reply');
const { extractTimePeriod, extractRequestedTimePeriod } = require('./language-understanding');
const { answerWeatherQuery } = require('./weather-reply');
const { buildContextPacket, buildSystemPrompt, selectAllowedTools } = require('./request-context');
const { AuditLog } = require('./audit');
const { IdempotencyStore } = require('./idempotency');
const { TOOL_DEFINITIONS, runTool, executeConfirmedAction } = require('./assistant/tools');
const { handleActionReply } = require('./safe-actions');
const fs = require('fs');
const path = require('path');
const metrics = require('./metrics');
const { ConversationController } = require('./conversation-controller');
const {
  hasEntitlement, featureForWhatsAppIntent, planBoundaryReply,
} = require('./entitlements');
const {
  initializeContextRuntime,
  getContextRuntime,
} = require('./context/contextRuntime');
const { adaptDeviceContext } = require('./context/deviceContextAdapter');

console.log('[http] Metrics module loaded:', typeof metrics.trackIntent === 'function' ? '✓' : '✗');

let alerting = null;

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readBody(req) {
  const raw = await readRawBody(req);
  return raw.toString('utf8');
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

// Meta retries can deliver the same wamid more than once. Claim the stable
// message ID before LLM/tool work so duplicate webhook deliveries never create
// duplicate Guardian replies or duplicate Meta charges.
const metaInboundDeduper = new MetaMessageDeduper();
const conversationController = new ConversationController();

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
  initializeContextRuntime({ config, llmProvider, db: getDb() });
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

    // [2] Check idempotency (Meta may retry webhook delivery)
    if (idempotencyStore.isSeen(requestId)) {
      const cached = idempotencyStore.getCachedReply(requestId);
      console.log(`[assistant] ${requestId} DUPLICATE (cached reply)`);
      return { ctx: { from }, reply: cached, isDuplicate: true };
    }

    // [3] Resolve caller context (authentication)
    const ctx = await resolveCallerContext(db, from);
    console.log(
      `[assistant] ${requestId} from=${ctx.from} uid=${ctx.uid} role=${ctx.callerRole} devices=${ctx.linkedImeis.length}`
    );

    const authStatus = ctx.uid
      ? 'authenticated'
      : ctx.callerRole === 'emergency_contact'
        ? 'restricted'
        : 'not_registered';

    const authReason = ctx.uid
      ? 'registered_user'
      : ctx.callerRole === 'emergency_contact'
        ? 'emergency_contact_notification_only'
        : 'no_matching_user';

    await auditLog.recordAuth({
      requestId,
      uid: ctx.uid,
      linkedImeis: ctx.linkedImeis,
      status: authStatus,
      reason: authReason,
      plan: ctx.entitlements?.plan,
      subscriptionStatus: ctx.entitlements?.status,
    });

    // Authorize the commercial service before courtesy/help routing or any
    // LLM/tool work. Critical messages retain the deterministic emergency
    // boundary even when service is inactive.
    const initialIntent = classifyIntent(text);
    if (
      initialIntent.type === 'ACTIVITY_QUERY' &&
      ctx.uid &&
      config.activityStepsCustomerEnabled !== true
    ) {
      const reply =
        'Steps and daily activity are still being validated on the watch and are not enabled yet.';
      idempotencyStore.store(requestId, reply);
      await auditLog.recordResponse({
        requestId,
        destination: 'whatsapp',
        replyLength: reply.length,
        fallbackReason: 'activity_steps_customer_disabled',
      });
      return { ctx, reply, deterministic: true, featureDisabled: true };
    }
    if (!isCritical(initialIntent) && ctx.uid) {
      const requiredFeature = featureForWhatsAppIntent(initialIntent.type);
      if (requiredFeature && !hasEntitlement(ctx.entitlements, requiredFeature)) {
        const reply = planBoundaryReply(ctx.entitlements, requiredFeature);
        idempotencyStore.store(requestId, reply);
        await auditLog.recordResponse({
          requestId,
          destination: 'whatsapp',
          replyLength: reply.length,
          fallbackReason: 'plan_entitlement_denied',
        });
        return { ctx, reply, deterministic: true, planRestricted: true };
      }
    }

    const actionReply = await handleActionReply({
      db,
      ctx,
      text,
      execute: (action) => executeConfirmedAction(db, ctx, action),
    });
    if (actionReply?.handled) {
      idempotencyStore.store(requestId, actionReply.reply);
      await auditLog.recordResponse({
        requestId,
        destination: 'whatsapp',
        replyLength: actionReply.reply.length,
        fallbackReason: `safe_action_${actionReply.status || 'no_pending'}`,
      });
      return { ctx, reply: actionReply.reply, deterministic: true, actionStatus: actionReply.status };
    }

    const deterministic = conversationController.deterministicReply(ctx.from, text);
    if (deterministic) {
      metrics.trackFallback(deterministic.reason, { route: 'deterministic' });
      idempotencyStore.store(requestId, deterministic.reply);
      await auditLog.recordResponse({
        requestId,
        destination: 'whatsapp',
        replyLength: deterministic.reply.length,
        fallbackReason: deterministic.reason,
      });
      return { ctx, reply: deterministic.reply, deterministic: true };
    }

    let effectiveText = text;
    let intent = classifyIntent(effectiveText);
    const pending = conversationController.resolvePendingWearer(
      ctx.from,
      effectiveText,
      ctx.devices,
    );
    if (pending) {
      effectiveText = pending.text;
      intent = classifyIntent(effectiveText);
    }

    if (!pending) {
      const standaloneWearer = conversationController.standaloneWearerReply(
        ctx.from,
        effectiveText,
        ctx.devices,
      );
      if (standaloneWearer) {
        metrics.trackFallback(standaloneWearer.reason, { route: 'deterministic' });
        idempotencyStore.store(requestId, standaloneWearer.reply);
        await auditLog.recordResponse({
          requestId,
          destination: 'whatsapp',
          replyLength: standaloneWearer.reply.length,
          fallbackReason: standaloneWearer.reason,
        });
        return { ctx, reply: standaloneWearer.reply, deterministic: true };
      }
    }

    const wearerResolution = conversationController.resolveWearer(
      ctx.from,
      effectiveText,
      intent.type,
      ctx.devices,
    );
    if (wearerResolution.reply) {
      metrics.trackFallback(wearerResolution.reason, { route: 'deterministic' });
      idempotencyStore.store(requestId, wearerResolution.reply);
      await auditLog.recordResponse({
        requestId,
        destination: 'whatsapp',
        replyLength: wearerResolution.reply.length,
        fallbackReason: wearerResolution.reason,
      });
      return { ctx, reply: wearerResolution.reply, deterministic: true };
    }
    effectiveText = wearerResolution.text;

    // [4] Classify intent (deterministic, no LLM)
    metrics.trackIntent(intent.type, intent.confidence, intent.urgency);
    console.log(`[metrics] Tracked intent: type=${intent.type}, confidence=${intent.confidence}, urgency=${intent.urgency}`);
    await auditLog.recordIntent({ requestId, intent });

    // Cost/scope gate: Guardian WhatsApp is a family-safety interface, not a
    // general chatbot. Out-of-scope/general messages get one deterministic
    // response and never reach Gemini/Claude.
    const inboundRoute = decideInboundRoute(intent);
    if (inboundRoute.route === 'scope_reply') {
      const reply = inboundRoute.reply;
      metrics.trackFallback('outside_guardian_scope', { intentType: intent.type });
      idempotencyStore.store(requestId, reply);
      await auditLog.recordResponse({
        requestId,
        destination: 'whatsapp',
        replyLength: reply.length,
        fallbackReason: 'outside_guardian_scope',
      });
      return { ctx, reply, scopeLimited: true };
    }

    // [5] Handle critical intents immediately (SOS, emergency)
    if (isCritical(intent)) {
      // Track critical event
      metrics.increment('critical_events', 1);
      console.log(`[metrics] CRITICAL EVENT TRACKED - type=${intent.type}, total_critical=${metrics.getCounter('critical_events')}`);

      const reply = ctx.uid
        ? 'I detected an emergency-related message. Guardian does not dispatch emergency services from WhatsApp chat. Use the SOS button on the watch or in the Guardian app to trigger the Guardian SOS flow, and contact emergency services directly if immediate help is needed.'
        : restrictedCallerReply(ctx, { critical: true });

      idempotencyStore.store(requestId, reply);
      await auditLog.recordResponse({
        requestId,
        destination: 'whatsapp',
        replyLength: reply.length,
        fallbackReason: 'critical_intent',
      });

      return { ctx, reply };
    }

    // [6] Check authentication for non-critical requests.
    // Emergency contacts are notification recipients only; being listed as an
    // emergency contact must never inherit the owner's private linkedImeis.
    if (!ctx.uid) {
      const fallbackReason =
        ctx.callerRole === 'emergency_contact'
          ? 'emergency_contact_restricted'
          : 'not_registered';

      metrics.trackFallback(fallbackReason, { intentType: intent.type });

      const reply = restrictedCallerReply(ctx);
      idempotencyStore.store(requestId, reply);
      await auditLog.recordResponse({
        requestId,
        destination: 'whatsapp',
        replyLength: reply.length,
        fallbackReason,
      });
      return { ctx, reply, accessRestricted: true };
    }

    // Journey history is a typed factual read. Query it directly and render it
    // deterministically so common journey questions incur no LLM call and can
    // never invent a route, destination, or purpose.
    if (intent.type === 'JOURNEY_QUERY') {
      const period = extractRequestedTimePeriod(effectiveText);
      let journeyResult;
      try {
        journeyResult = await runTool(db, ctx, 'get_recent_journeys', {
          imei: wearerResolution.wearer?.imei,
          limit: 3,
          start_at: period?.startAt?.toISOString(),
          end_at: period?.endAt?.toISOString(),
          period_label: period?.label,
        });
      } catch (err) {
        await auditLog.recordError({ requestId, phase: 'journey_query', error: err });
        journeyResult = { error: err.message };
      }
      const reply = formatJourneyReply(journeyResult);
      idempotencyStore.store(requestId, reply);
      await auditLog.recordResponse({
        requestId,
        destination: 'whatsapp',
        replyLength: reply.length,
        fallbackReason: journeyResult?.error ? 'journey_query_failed' : null,
      });
      return { ctx, reply, deterministic: true };
    }

    if (intent.type === 'ACTIVITY_QUERY') {
      const requestedDays = /\b(week|weekly|seven|7 days|last days)\b/i.test(
        effectiveText,
      )
        ? 7
        : 1;
      let activityResult;
      try {
        activityResult = await runTool(db, ctx, 'get_activity_summary', {
          imei: wearerResolution.wearer?.imei,
          days: requestedDays,
        });
      } catch (err) {
        await auditLog.recordError({ requestId, phase: 'activity_query', error: err });
        activityResult = { error: err.message };
      }
      const reply = formatActivityReply(activityResult);
      idempotencyStore.store(requestId, reply);
      await auditLog.recordResponse({
        requestId,
        destination: 'whatsapp',
        replyLength: reply.length,
        fallbackReason: activityResult?.error ? 'activity_query_failed' : null,
      });
      return { ctx, reply, deterministic: true };
    }

    if (intent.type === 'WEATHER_QUERY') {
      const reply = await answerWeatherQuery({
        device: wearerResolution.wearer,
        contextService: getContextRuntime()?.service,
      });
      idempotencyStore.store(requestId, reply);
      await auditLog.recordResponse({
        requestId,
        destination: 'whatsapp',
        replyLength: reply.length,
        fallbackReason: null,
      });
      return { ctx, reply, deterministic: true };
    }

    if (intent.type === 'DAILY_SUMMARY') {
      const period = extractTimePeriod(effectiveText);
      let summaryResult;
      try {
        summaryResult = await runTool(db, ctx, 'get_daily_summary', {
          imei: wearerResolution.wearer?.imei,
          start_at: period.startAt.toISOString(),
          end_at: period.endAt.toISOString(),
          period_label: period.label,
        });
      } catch (err) {
        await auditLog.recordError({ requestId, phase: 'daily_summary', error: err });
        summaryResult = { error: err.message };
      }
      const reply = formatDailySummaryReply(summaryResult);
      idempotencyStore.store(requestId, reply);
      await auditLog.recordResponse({
        requestId,
        destination: 'whatsapp',
        replyLength: reply.length,
        fallbackReason: summaryResult?.error ? 'daily_summary_failed' : null,
      });
      return { ctx, reply, deterministic: true };
    }

    // [7] Build minimal context packet (not full device doc)
    const wearer = ctx.linkedImeis.length === 1 ? { id: ctx.linkedImeis[0], displayName: ctx.displayName } : null;
    const device = ctx.devices[0] || null;
    const contextPacket = buildContextPacket({
      requestId,
      requester: {
        uid: ctx.uid,
        displayName: ctx.displayName,
        role: ctx.callerRole || 'guardian',
        linkedImeis: ctx.linkedImeis,
      },
      wearer,
      device,
      intent,
      locale: 'en', // TODO: detect from user preferences
    });

    // [8] Call LLM provider with tool-calling
    let reply = null;
    let providerUsage = null;
    let toolsUsed = [];
    const lastToolResults = new Map();

    if (!llmProvider) {
      // Fallback: use existing Claude integration
      const result = await answerWithAssistant(db, ctx, effectiveText);
      reply = result.reply;
      providerUsage = result.usage;
      toolsUsed = result.toolsUsed || [];
    } else {
      // Phase 1 & 2: Use new provider abstraction with intent-specific prompts
      const systemPrompt = contextPacket.systemPrompt; // Already computed by buildContextPacket
      const allowedTools = contextPacket.allowedTools; // Already computed by buildContextPacket
      const filteredTools = TOOL_DEFINITIONS.filter((t) => allowedTools.includes(t.name));

      const messages = [{ role: 'user', content: effectiveText }];

      try {
        // Full agentic loop: call provider, execute tools, repeat until text response
        let finalReply = null;
        let lastProviderResult = null;
        const currentMessages = [...messages];
        let roundCount = 0;
        const maxRounds = 3;

        while (roundCount < maxRounds && !finalReply) {
          roundCount += 1;

          const llmStartTime = Date.now();
          lastProviderResult = await llmProvider.complete({
            systemPrompt,
            messages: currentMessages,
            tools: filteredTools,
            metadata: { requestId, userId: ctx.uid, locale: 'en' },
          });
          const llmDurationMs = Date.now() - llmStartTime;

          providerUsage = lastProviderResult.usage;

          // Track LLM call success
          metrics.trackLLMCall(true, llmDurationMs, intent.type);

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
              lastToolResults.set(toolUse.name, result);
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

        // Track LLM failure
        metrics.trackLLMCall(false, 0, intent.type);
        metrics.trackFallback('llm_error', { error: err.message, intentType: intent.type });

        // Fallback to template
        reply = `I'm having trouble reaching live data right now. Try again in a moment, or check the app for ${wearer?.displayName || 'your loved one'}'s location.`;
      }
    }

    // Battery facts are safety-relevant and simple enough to render
    // deterministically. The LLM selects the correct watch/tool, but it cannot
    // omit or reinterpret the reading's age and connectivity state.
    const batteryToolResult = lastToolResults.get('get_battery');
    if (batteryToolResult && !batteryToolResult.error) {
      reply = formatBatteryReply(batteryToolResult);
    }

    const stagedCommand = lastToolResults.get('send_device_command');
    const stagedReminder = lastToolResults.get('schedule_reminder');
    if (stagedCommand?.status === 'awaiting_confirmation') reply = stagedCommand.reply;
    if (stagedReminder?.status === 'awaiting_confirmation') reply = stagedReminder.reply;

    // [9] Validate response (catch hallucinations)
    // Apply intent-specific validation
    if (reply) {
      let validation = { valid: true, issues: [] };

      const locationToolResult = lastToolResults.get('get_last_location');
      const alertsToolResult = lastToolResults.get('get_recent_alerts');
      const safeZoneToolResult = lastToolResults.get('is_at_geofence');
      const commandToolResult = lastToolResults.get('send_device_command');
      const reminderToolResult = lastToolResults.get('schedule_reminder');

      if (intent.type === 'LOCATION_REQUEST' && locationToolResult) {
        validation = validateLocationResponse(reply, locationToolResult, { medicalClaimsAllowed: false });
      } else if (intent.type === 'DEVICE_STATUS' && batteryToolResult) {
        validation = validateBatteryResponse(reply, batteryToolResult);
      } else if (intent.type === 'DEVICE_STATUS' && locationToolResult) {
        validation = validateDeviceStatusResponse(reply, locationToolResult);
      } else if (intent.type === 'RECENT_ALERTS') {
        validation = validateAlertsResponse(reply, alertsToolResult);
      } else if (intent.type === 'SAFE_ZONE_CHECK' && safeZoneToolResult) {
        validation = validateSafeZoneResponse(reply, safeZoneToolResult);
      } else if (intent.type === 'DEVICE_COMMAND') {
        validation = validateDeviceCommandResponse(reply, commandToolResult);
      } else if (intent.type === 'VOICE_MONITOR') {
        validation = validateDeviceCommandResponse(reply, commandToolResult);
      } else if (intent.type === 'REMINDER_REQUEST') {
        validation = validateReminderResponse(reply, reminderToolResult);
      }

      await auditLog.recordValidation({ requestId, valid: validation.valid, issues: validation.issues });

      // Track validation result
      metrics.trackResponseValidation(validation.valid, validation.issues, intent.type);

      if (!validation.valid) {
        console.warn(`[assistant] ${requestId} Response validation failed:`, validation.issues);
        metrics.trackFallback('validation_failed', { issues: validation.issues, intentType: intent.type });
        reply = `I could not process your request properly. Try again in a moment.`;
      }
    }

    // [10] Cache and send reply
    if (!reply) {
      metrics.trackFallback('no_reply_generated', { intentType: intent.type });
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

/**
 * Sensitive reads and device-changing operations must never inherit the ops
 * API's convenient "dev-open" behavior. Local/ngrok use therefore requires
 * either X-Admin-Key or an authorized Firebase administrator bearer token.
 */
async function requireStrictAdmin(req, res) {
  const auth = await checkAdminAuth(req);
  if (!auth.ok) {
    sendJson(res, auth.status, { error: auth.error });
    return false;
  }
  if (auth.method === 'dev-open') {
    sendJson(res, 503, {
      error: 'Strict admin endpoint disabled: configure ADMIN_API_KEY or use Firebase admin auth',
    });
    return false;
  }
  return true;
}

async function handleOpsHttpRequest(req, res, url) {
  if (req.method !== 'GET' || !url.pathname.startsWith('/ops/')) {
    return false;
  }

  if (url.pathname === '/ops/context-sources') {
    if (!(await requireStrictAdmin(req, res))) return true;
    const runtime = getContextRuntime();
    if (!runtime?.capAlertProvider || !runtime?.defiMediaRssProvider) {
      sendJson(res, 503, { error: 'Context source runtime unavailable' });
      return true;
    }
    const defiMediaStatus = runtime.defiMediaRssScheduler?.getStatus?.() || null;
    const defiMediaRun = defiMediaStatus?.lastRun || null;
    sendJson(res, 200, {
      observeOnly: true,
      automaticDelivery: false,
      enabled: config.contextCapEnabled === true,
      scheduler: {
        active: runtime.sourceScheduler?.active === true,
        intervalMinutes: runtime.sourceScheduler?.intervalMinutes || null,
        reason: runtime.sourceScheduler?.reason || null,
      },
      sourceSchedulers: {
        cap: {
          enabled: config.contextCapEnabled === true,
          active: runtime.sourceScheduler?.active === true,
          intervalMinutes: runtime.sourceScheduler?.intervalMinutes || null,
          reason: runtime.sourceScheduler?.reason || null,
        },
        defiMedia: {
          enabled: config.contextDefiMediaEnabled === true,
          active: runtime.defiMediaRssScheduler?.active === true,
          intervalMinutes: runtime.defiMediaRssScheduler?.intervalMinutes || null,
          reason: runtime.defiMediaRssScheduler?.reason || null,
          lastRun: defiMediaRun ? {
            ok: defiMediaRun.ok === true,
            notModified: defiMediaRun.notModified === true,
            itemsSeen: defiMediaRun.itemsSeen || 0,
            changedItems: defiMediaRun.changedItems || 0,
            durableNewItems: defiMediaRun.durableNewItems || 0,
            durableUpdatedItems: defiMediaRun.durableUpdatedItems || 0,
            restartDuplicatesSuppressed:
              defiMediaRun.restartDuplicatesSuppressed || 0,
            actionableCandidates: defiMediaRun.freshCandidates || 0,
            eventsPersisted: defiMediaRun.eventsPersisted || 0,
            deviceMatches: defiMediaRun.exposure?.deviceMatches || 0,
            familyMatches: defiMediaRun.exposure?.familyMatches || 0,
            newFamilyMatches: defiMediaRun.exposure?.newFamilyMatches || 0,
            duplicateFamilyMatches:
              defiMediaRun.exposure?.duplicateFamilyMatches || 0,
            automaticDelivery: false,
          } : null,
        },
      },
      sources: [
        runtime.capAlertProvider.getSnapshot(),
        runtime.defiMediaRssProvider.getSnapshot(),
      ],
    });
    return true;
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

      // Dashboard
      if (req.method === 'GET' && url.pathname === '/dashboard') {
        const dashboardPath = path.join(__dirname, 'dashboard.html');
        const dashboard = fs.readFileSync(dashboardPath, 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(dashboard);
        return;
      }

      // Alerts Summary
      if (req.method === 'GET' && url.pathname === '/alerts/summary') {
        if (!alerting) {
          sendJson(res, 503, { error: 'Alerting system not initialized' });
          return;
        }
        const summary = alerting.getSummary();
        sendJson(res, 200, summary);
        return;
      }

      // Metrics Summary
      if (req.method === 'GET' && url.pathname === '/metrics/summary') {
        const summary = metrics.getSummary();

        // Sum LLM metrics across all labels
        let llmSuccessful = 0, llmFailed = 0;
        for (const [key, data] of Object.entries(metrics.counters)) {
          if (key.startsWith('llm_calls_successful')) llmSuccessful += data.value;
          if (key.startsWith('llm_calls_failed')) llmFailed += data.value;
        }

        // Sum validation metrics across all labels
        let validationValid = 0, validationTotal = 0;
        for (const [key, data] of Object.entries(metrics.counters)) {
          if (key.startsWith('response_validations_passed')) validationValid += data.value;
          if (key.startsWith('response_validations_total')) validationTotal += data.value;
        }

        // Transform to dashboard-expected format
        const response = {
          intents: {
            total: summary.intents_processed,
            critical: summary.critical_events,
          },
          llm: {
            successful: llmSuccessful,
            failed: llmFailed,
          },
          validation: {
            valid: validationValid,
            responses_validated: validationTotal,
          },
          fallbacks: {
            total: summary.fallback_count,
          },
          timing: summary.timing_stats,
        };
        sendJson(res, 200, response);
        return;
      }

      // Metrics JSON (full export)
      if (req.method === 'GET' && url.pathname === '/metrics/json') {
        const summary = metrics.getSummary();
        sendJson(res, 200, summary);
        return;
      }

      // Device Context (weather + relevance)
      if (req.method === 'GET' && url.pathname.match(/^\/devices\/[^/]+\/context$/)) {
        const match = url.pathname.match(/^\/devices\/([^/]+)\/context$/);
        const imei = match ? match[1] : null;

        if (!imei) {
          sendJson(res, 400, { error: 'IMEI required' });
          return;
        }

        if (!(await requireStrictAdmin(req, res))) {
          return;
        }

        const db = getDb();
        if (!db) {
          sendJson(res, 503, { error: 'Context data store unavailable' });
          return;
        }
        const deviceDoc = await db.collection('devices').doc(imei).get();

        if (!deviceDoc.exists) {
          sendJson(res, 404, { error: 'Device not found' });
          return;
        }

        const deviceData = deviceDoc.data();
        const adapted = adaptDeviceContext(deviceData);
        if (!adapted) {
          sendJson(res, 422, { error: 'No trustworthy device location available' });
          return;
        }
        const contextService = getContextRuntime()?.service;
        if (!contextService) {
          sendJson(res, 503, { error: 'Context intelligence unavailable' });
          return;
        }
        const context = await contextService.getDeviceContext(
          adapted.device,
          adapted.person,
          adapted.location,
          { imei, source: 'device_context_api' }
        );

        sendJson(res, 200, context);
        return;
      }

      if (await handleOpsHttpRequest(req, res, url)) {
        return;
      }

      if (
        req.method === 'POST' &&
        url.pathname === '/admin/device-phonebook/contact'
      ) {
        if (!(await requireStrictAdmin(req, res))) {
          return;
        }

        let payload;
        try {
          const raw = await readBody(req);
          payload = raw ? JSON.parse(raw) : {};
        } catch {
          sendJson(res, 400, { error: 'Valid JSON body required' });
          return;
        }

        let result;
        try {
          result = provisionPhonebookContact(payload);
        } catch (error) {
          sendJson(res, 400, { error: error.message });
          return;
        }

        let auditRecorded = false;
        try {
          if (auditLog) {
            await auditLog.record({
              requestId: generateRequestId(),
              phase: 'device_provisioning',
              imei: String(payload.imei || '').trim(),
              data: {
                status: result.ok ? 'socket_handoff' : result.error,
                operation: 'phonebook_contact',
                slot: result.slot,
                sessions: result.sessions,
              },
            });
            auditRecorded = true;
          }
        } catch (error) {
          // The watch may already have received PHBX. Return the real handoff
          // result so an operator does not retry blindly and duplicate work.
          console.error('[phonebook-provisioning] audit failed:', error.message);
        }

        sendJson(res, result.ok ? 200 : 404, { ...result, auditRecorded });
        return;
      }

      if (
        req.method === 'POST' &&
        url.pathname === '/admin/device-activity-steps/pedometer'
      ) {
        if (!(await requireStrictAdmin(req, res))) {
          return;
        }

        let payload;
        try {
          const raw = await readBody(req);
          payload = raw ? JSON.parse(raw) : {};
        } catch {
          sendJson(res, 400, { error: 'Valid JSON body required' });
          return;
        }

        let result;
        try {
          result = provisionActivitySteps(payload);
        } catch (error) {
          sendJson(res, 400, { error: error.message });
          return;
        }

        let auditRecorded = false;
        try {
          if (auditLog) {
            await auditLog.record({
              requestId: generateRequestId(),
              phase: 'device_provisioning',
              imei: String(payload.imei || '').trim(),
              data: {
                status: result.ok ? 'socket_handoff' : result.error,
                operation: 'activity_steps_pedometer',
                enabled: result.enabled,
                windowMode: result.windowMode,
                commandsHandedOff: result.commandsHandedOff,
                commandsRequired: result.commandsRequired,
                sessions: result.sessions,
              },
            });
            auditRecorded = true;
          }
        } catch (error) {
          // A command may already have reached the watch. Preserve the exact
          // handoff result so an operator does not retry a partial operation.
          console.error('[activity-steps-provisioning] audit failed:', error.message);
        }

        sendJson(res, result.ok ? 200 : 409, { ...result, auditRecorded });
        return;
      }

      if (
        (req.method === 'POST' || req.method === 'GET') &&
        (url.pathname === '/dev/send-cr' || url.pathname === '/dev/downlink')
      ) {
        // This route can write arbitrary commands to a live watch. It must
        // never inherit the ops API's convenient dev-open behavior, including
        // when HTTP port 9001 is exposed through an ngrok webhook tunnel.
        if (!(await requireStrictAdmin(req, res))) {
          return;
        }
        const imei =
          url.searchParams.get('imei') ||
          url.searchParams.get('protocolId');
        if (!imei) {
          sendJson(res, 400, { error: 'imei or protocolId required' });
          return;
        }
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
        const from = String(payload.from || '').trim();
        if (!from) {
          sendJson(res, 400, { error: 'from required' });
          return;
        }
        const text = payload.text || payload.body || '';
        if (!text.trim()) {
          sendJson(res, 400, { error: 'text required' });
          return;
        }
        const { reply } = await handleChat({ from, text: text.trim() });
        sendJson(res, 200, { reply });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/webhooks/meta/whatsapp') {
        const verification = verifyMetaWebhookChallenge({
          mode: url.searchParams.get('hub.mode'),
          token: url.searchParams.get('hub.verify_token'),
          challenge: url.searchParams.get('hub.challenge'),
          expectedVerifyToken: config.metaWhatsAppVerifyToken,
        });

        res.writeHead(verification.status, {
          'Content-Type': 'text/plain; charset=utf-8',
        });
        res.end(verification.ok ? verification.challenge : verification.reason);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/webhooks/meta/whatsapp') {
        const raw = await readRawBody(req);
        const signature = req.headers['x-hub-signature-256'];

        if (!config.metaAppSecret) {
          console.error('[meta-webhook] META_APP_SECRET missing; refusing webhook');
          res.writeHead(503, { 'Content-Type': 'text/plain' });
          res.end('META_APP_SECRET missing');
          return;
        }

        if (!verifyMetaSignature(raw, signature, config.metaAppSecret)) {
          console.warn('[meta-webhook] invalid X-Hub-Signature-256');
          res.writeHead(401, { 'Content-Type': 'text/plain' });
          res.end('invalid signature');
          return;
        }

        let payload;
        try {
          payload = JSON.parse(raw.toString('utf8'));
        } catch {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('invalid json');
          return;
        }

        const inboundMessages = extractMetaInboundMessages(
          payload,
          config.metaWhatsAppPhoneNumberId
        );
        const deliveryStatuses = extractMetaDeliveryStatuses(
          payload,
          config.metaWhatsAppPhoneNumberId
        );

        let shouldRetry = false;

        for (const statusEvent of deliveryStatuses) {
          try {
            const outcome = await recordMetaDeliveryStatus(getDb(), statusEvent);
            console.log(
              `[meta-webhook] delivery id=${statusEvent.messageId} ` +
                `status=${statusEvent.status} logs=${outcome.matchedLogs} ` +
                `reminders=${outcome.matchedReminders}`
            );
          } catch (err) {
            shouldRetry = true;
            console.error(
              `[meta-webhook] delivery persistence failed id=${statusEvent.messageId}`,
              err.message
            );
          }
        }

        for (const message of inboundMessages) {
          if (!metaInboundDeduper.claim(message.id)) {
            console.log(`[meta-webhook] duplicate ignored id=${message.id}`);
            continue;
          }

          // Media/unsupported payloads are acknowledged but intentionally do
          // not generate a paid Guardian reply in V1.
          if (!message.text) {
            metaInboundDeduper.markDone(message.id);
            console.log(
              `[meta-webhook] unsupported inbound type=${message.type || 'unknown'} ignored`
            );
            continue;
          }

          incrementMetric('whatsappInbound');

          try {
            const { reply } = await handleChat({
              from: normalizeE164(message.from),
              text: message.text,
            });

            const wa = await sendMetaText(message.from, reply);

            if (wa.ok) {
              metaInboundDeduper.markDone(message.id);
              console.log(
                `[meta-webhook] replied id=${message.id} outbound=${wa.messageId || 'unknown'}`
              );
            } else {
              metaInboundDeduper.release(message.id);
              shouldRetry = true;
              console.error('[meta-webhook] Meta reply send failed', wa);
            }
          } catch (err) {
            metaInboundDeduper.release(message.id);
            shouldRetry = true;
            console.error(
              `[meta-webhook] processing failed id=${message.id}`,
              err.message
            );
          }
        }

        // If an outbound reply failed, return 500. Meta may retry the webhook;
        // messages already sent are retained as done and will not send twice.
        res.writeHead(shouldRetry ? 500 : 200, {
          'Content-Type': 'text/plain; charset=utf-8',
        });
        res.end(shouldRetry ? 'RETRY' : 'EVENT_RECEIVED');
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
    console.log('[guardian-http] GET/POST /webhooks/meta/whatsapp');
    console.log('[guardian-http] POST /dev/chat  { "from": "<e164-phone>", "text": "Where is mum?" }');
    console.log('[guardian-http] GET  /ops/metrics  (admin key if ADMIN_API_KEY set)');
    console.log('[guardian-http] GET  /ops/fleet');
    console.log('[guardian-http] GET  /ops/finance');
    console.log('[guardian-http] GET  /ops/growth?users=500');
    console.log('[guardian-http] GET  /ops/ai-stats');
    console.log('[guardian-http] GET  /ops/cost-estimate?users=500&sensitivity=true');
    console.log('[guardian-http] GET  /ops/context-sources  (strict admin auth)');
  });

  return server;
}

module.exports = {
  startHttpServer,
  handleChat,
  normalizeE164,
  requireStrictAdmin,
};
