const { buildSafetyContext } = require('./safety-message');

const DEFAULT_COMPOSER_TIMEOUT_MS = 1200;
const MAX_NARRATION_CHARS = 260;

function extractProviderText(result) {
  if (!result) return '';
  if (typeof result.content === 'string') return result.content.trim();

  if (Array.isArray(result.content)) {
    return result.content
      .map((block) => {
        if (!block) return '';
        if (typeof block === 'string') return block;
        if (typeof block.text === 'string') return block.text;
        if (block.type === 'text' && typeof block.content === 'string') return block.content;
        return '';
      })
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  return '';
}

function buildDeterministicNarration(type, ctx) {
  const normalizedType = String(type || 'sos').trim().toLowerCase();
  const name = ctx.wearerName || 'Loved one';

  if (normalizedType === 'fall') {
    return `A fall alert was received for ${name}. Please check on ${name} now.`;
  }

  return `${name} triggered an SOS. Please check on ${name} now.`;
}

function buildComposerPrompt(type, ctx) {
  const normalizedType = String(type || 'sos').trim().toLowerCase();

  const facts = {
    eventType: normalizedType,
    wearerName: ctx.wearerName,
    eventTime: ctx.eventTime,
    placeLabel: ctx.placeLabel,
    positioningLabel: ctx.positioningLabel,
    approximate: ctx.approximate,
    locationFreshness: ctx.locationFreshness,
    online: ctx.online,
    batteryPercent: ctx.batteryPercent,
  };

  return {
    systemPrompt: [
      'You write one short Guardian family-safety WhatsApp sentence.',
      'Use ONLY the supplied facts.',
      'Be calm, human and direct.',
      'Maximum 2 short sentences and 260 characters.',
      'Do not include a map URL, coordinates, IMEI, or technical identifiers.',
      'Do not claim police, ambulance, emergency services or emergency contacts were contacted or dispatched.',
      'Do not diagnose or make medical claims.',
      'Do not change an approximate location into GPS/satellite/precise wording.',
      'Do not invent battery, location, time, status, cause, intent, or outcome.',
      'For SOS or fall, it is acceptable to say: "Please check on <name> now."',
      'Return plain text only.',
    ].join(' '),
    messages: [
      {
        role: 'user',
        content: `Guardian facts:\n${JSON.stringify(facts)}\nWrite the message now.`,
      },
    ],
  };
}

function validateNarration(text, ctx) {
  const issues = [];
  const value = String(text || '').trim();

  if (!value) issues.push('EMPTY_NARRATION');
  if (value.length > MAX_NARRATION_CHARS) issues.push('NARRATION_TOO_LONG');

  if (/\b8613\d{11}\b|\bIMEI\b/i.test(value)) {
    issues.push('EXPOSED_DEVICE_IDENTIFIER');
  }

  const dispatchClaim =
    /\b(dispatched|called|contacted|notified|sent)\b.{0,40}\b(police|ambulance|emergency services|emergency contacts?)\b/i.test(value) ||
    /\b(police|ambulance|emergency services|emergency contacts?)\b.{0,40}\b(dispatched|called|contacted|notified|sent)\b/i.test(value);
  if (dispatchClaim) {
    issues.push('UNSUPPORTED_DISPATCH_CLAIM');
  }

  if (
    /\b(diagnos|heart attack|stroke|seizure|medical emergency|blood pressure|SpO2|oxygen saturation)\b/i.test(
      value
    )
  ) {
    issues.push('MEDICAL_CLAIM');
  }

  if (/https?:\/\/|maps\.google|[-+]?\d+\.\d{4,}\s*,\s*[-+]?\d+\.\d{4,}/i.test(value)) {
    issues.push('RAW_LOCATION_DATA_IN_NARRATION');
  }

  const percentages = [...value.matchAll(/\b(\d{1,3})\s*%/g)].map((m) => Number(m[1]));
  if (percentages.length > 0) {
    if (ctx.batteryPercent == null) {
      issues.push('BATTERY_WITHOUT_DATA');
    } else if (percentages.some((p) => p !== Number(ctx.batteryPercent))) {
      issues.push('BATTERY_MISMATCH');
    }
  }

  if (ctx.online === false && /\b(online|connected)\b/i.test(value)) {
    issues.push('ONLINE_STATUS_MISMATCH');
  }
  if (ctx.online === true && /\b(offline|disconnected)\b/i.test(value)) {
    issues.push('ONLINE_STATUS_MISMATCH');
  }

  if (
    ctx.approximate === true &&
    /\b(satellite|precise location|exact location)\b/i.test(value)
  ) {
    issues.push('POSITIONING_SOURCE_MISMATCH');
  }

  if (
    ctx.positioningLabel &&
    /satellite GPS/i.test(ctx.positioningLabel) === false &&
    /\bsatellite GPS\b/i.test(value)
  ) {
    issues.push('POSITIONING_SOURCE_MISMATCH');
  }

  if (!ctx.hasLocation && /\b(at|near|located in|located at)\b/i.test(value)) {
    // "at 14:32" is a time phrase, not a location claim.
    const withoutTimes = value.replace(/\bat\s+\d{1,2}:\d{2}\b/gi, '');
    if (/\b(at|near|located in|located at)\b/i.test(withoutTimes)) {
      issues.push('LOCATION_WITHOUT_DATA');
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

function buildLocationTemplateValue(ctx) {
  if (!ctx.hasLocation) return 'Location unavailable';

  const place = ctx.placeLabel
    ? `${ctx.approximate ? 'Approximate location near ' : ''}${ctx.placeLabel}`
    : ctx.approximate
      ? 'Approximate location available'
      : 'Location available';

  const details = [ctx.positioningLabel, ctx.locationFreshness ? `updated ${ctx.locationFreshness}` : null]
    .filter(Boolean)
    .join(' · ');

  return details ? `${place} · ${details}` : place;
}

function buildWatchTemplateValue(ctx) {
  const parts = [`Watch ${ctx.online ? 'online' : 'offline'}`];
  if (ctx.batteryPercent != null) parts.push(`battery ${ctx.batteryPercent}%`);
  else parts.push('battery unavailable');
  return parts.join(' · ');
}

function buildSafetyTemplateParameters(ctx, narration) {
  return [
    String(narration || '').trim() || buildDeterministicNarration('sos', ctx),
    ctx.eventTime || 'Time unavailable',
    buildLocationTemplateValue(ctx),
    buildWatchTemplateValue(ctx),
  ];
}

function buildMapButtonParameter(ctx) {
  const prefix = 'https://maps.google.com/?q=';
  const url = String(ctx?.mapsUrl || '').trim();
  if (!url || !url.startsWith(prefix)) return null;
  return url.slice(prefix.length).trim() || null;
}

function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('composer_timeout')), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function composeSafetyNarration({
  type = 'sos',
  device = {},
  alert = {},
  now = new Date(),
  provider = null,
  timeoutMs = DEFAULT_COMPOSER_TIMEOUT_MS,
} = {}) {
  const ctx = buildSafetyContext({ device, alert, now });
  const fallback = buildDeterministicNarration(type, ctx);

  if (!provider || typeof provider.complete !== 'function') {
    return {
      narration: fallback,
      source: 'fallback',
      reason: 'provider_unavailable',
      validation: { valid: true, issues: [] },
      context: ctx,
      templateParameters: buildSafetyTemplateParameters(ctx, fallback),
      buttonUrlParameter: buildMapButtonParameter(ctx),
      usage: null,
      provider: null,
    };
  }

  const prompt = buildComposerPrompt(type, ctx);

  try {
    const result = await withTimeout(
      provider.complete({
        systemPrompt: prompt.systemPrompt,
        messages: prompt.messages,
        tools: [],
        metadata: {
          purpose: 'guardian_safety_narration',
          eventType: String(type || '').toLowerCase(),
        },
      }),
      Math.max(1, Number(timeoutMs) || DEFAULT_COMPOSER_TIMEOUT_MS)
    );

    const narration = extractProviderText(result);
    const validation = validateNarration(narration, ctx);

    if (!validation.valid) {
      return {
        narration: fallback,
        source: 'fallback',
        reason: 'validation_failed',
        validation,
        rejectedNarration: narration,
        context: ctx,
        templateParameters: buildSafetyTemplateParameters(ctx, fallback),
        usage: result?.usage || null,
        provider: result?.provider || null,
      };
    }

    return {
      narration,
      source: 'llm',
      reason: null,
      validation,
      context: ctx,
      templateParameters: buildSafetyTemplateParameters(ctx, narration),
      buttonUrlParameter: buildMapButtonParameter(ctx),
      usage: result?.usage || null,
      provider: result?.provider || null,
    };
  } catch (err) {
    const reason = err?.message === 'composer_timeout' ? 'timeout' : 'provider_error';

    return {
      narration: fallback,
      source: 'fallback',
      reason,
      validation: { valid: true, issues: [] },
      context: ctx,
      templateParameters: buildSafetyTemplateParameters(ctx, fallback),
      buttonUrlParameter: buildMapButtonParameter(ctx),
      usage: null,
      provider: null,
    };
  }
}

module.exports = {
  DEFAULT_COMPOSER_TIMEOUT_MS,
  MAX_NARRATION_CHARS,
  extractProviderText,
  buildDeterministicNarration,
  buildComposerPrompt,
  validateNarration,
  buildLocationTemplateValue,
  buildWatchTemplateValue,
  buildSafetyTemplateParameters,
  buildMapButtonParameter,
  composeSafetyNarration,
};
