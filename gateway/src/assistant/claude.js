const config = require('../config');
const { TOOL_DEFINITIONS, runTool } = require('./tools');

const SYSTEM = `You are Guardian, a calm family safety assistant for Mauritius.
You help guardians check on elderly relatives and kids via WhatsApp.
Use tools to answer with real data. Be brief (1–3 short sentences).
If you have a maps URL, include it. If a pendant is offline, say so clearly.
Never invent coordinates or battery levels. If tools fail, say you could not reach live data.
For intelligence and geofence questions, use get_device_intelligence and is_at_geofence — report tool facts only.

Voice Monitoring (listen command):
- Only send if explicitly requested. Confirm intent with user.
- Warn: "The person wearing the device will NOT be notified they're being monitored."
- Use sparingly for emergency/safety checks, not routine surveillance.
- Requires the guardian's explicit responsibility and consent.

Speak naturally — e.g. "Mum is near Quatre Bornes" not raw IMEI unless asked.`;

async function callClaude(messages) {
  if (!config.anthropicApiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set');
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': config.anthropicApiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.anthropicModel,
      max_tokens: 512,
      system: SYSTEM,
      tools: TOOL_DEFINITIONS,
      messages,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    const msg = data?.error?.message || JSON.stringify(data).slice(0, 200);
    throw new Error(`Claude API error: ${msg}`);
  }
  return data;
}

function extractText(content) {
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

/**
 * Answer a WhatsApp (or dev) message using Claude + Firestore tools.
 */
async function answerWithAssistant(db, ctx, userText) {
  if (!config.anthropicApiKey) {
    // Offline-friendly fallback without LLM
    const { deviceLabel } = require('./tools');
    if (!ctx.devices.length) {
      return { reply: 'I could not find any linked pendants yet.' };
    }
    const d = ctx.devices[0];
    const loc = d.location || {};
    const name = deviceLabel(d);
    if (loc.lat != null && loc.lng != null) {
      return {
        reply:
          `${name} last seen at ${Number(loc.lat).toFixed(4)}, ${Number(loc.lng).toFixed(4)}` +
          (d.batteryPercent != null ? ` · battery ${d.batteryPercent}%` : '') +
          `\nhttps://maps.google.com/?q=${loc.lat},${loc.lng}`,
      };
    }
    return { reply: `${name} has no GPS fix yet.` };
  }

  const messages = [{ role: 'user', content: userText }];
  let totalUsage = { input_tokens: 0, output_tokens: 0 };

  for (let round = 0; round < 5; round += 1) {
    const response = await callClaude(messages);
    if (response.usage) {
      totalUsage.input_tokens += response.usage.input_tokens || 0;
      totalUsage.output_tokens += response.usage.output_tokens || 0;
    }
    const toolUses = (response.content || []).filter((b) => b.type === 'tool_use');

    if (!toolUses.length) {
      const text = extractText(response.content);
      return {
        reply: text || 'Sorry — I could not form an answer.',
        usage: totalUsage,
        toolsUsed: messages
          .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
          .filter((b) => b.type === 'tool_use')
          .map((b) => b.name),
      };
    }

    messages.push({ role: 'assistant', content: response.content });

    const toolResults = [];
    for (const tool of toolUses) {
      const result = await runTool(db, ctx, tool.name, tool.input || {});
      toolResults.push({
        type: 'tool_result',
        tool_use_id: tool.id,
        content: JSON.stringify(result),
      });
    }
    messages.push({ role: 'user', content: toolResults });
  }

  return {
    reply: 'I hit a limit looking that up — try asking again in a moment.',
    usage: totalUsage,
  };
}

module.exports = {
  answerWithAssistant,
};
