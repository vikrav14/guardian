'use strict';
const crypto = require('node:crypto');
class IntelligenceError extends Error {
  constructor(code, status = 503) { super(code); this.code = code; this.status = status; }
}
const fail = (code, status) => { throw new IntelligenceError(code, status); };
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const VERSION = '2026-10-07';
// USD per million tokens is numerically micro-USD per token. Unknown models
// fail closed: an unpriced model must never silently use another model's rate.
const MODELS = Object.freeze({
  'claude-haiku-4-5-20251001': { provider: 'anthropic', input: 1, output: 5 },
  'claude-haiku-4-5': { provider: 'anthropic', input: 1, output: 5 },
  'claude-sonnet-4-6': { provider: 'anthropic', input: 3, output: 15 },
  'gemini-3.1-flash-lite': { provider: 'gemini', input: 0.25, output: 1.5 },
});
const FEATURES = new Set(['assistant', 'overview', 'question', 'incident_brief', 'photo_orientation', 'photo_description', 'context', 'diagnostic']);
const INCIDENT = new Set(['incident_brief', 'photo_orientation', 'photo_description']);
function policy(env = process.env) {
  const number = (key, fallback, max) => {
    const n = env[key] == null ? fallback : Number(env[key]);
    if (!Number.isFinite(n) || n < 0 || n > max) fail('ai_policy_invalid');
    return n;
  };
  // Fixed planning conversion; invoices remain in USD. These settings are
  // operator-owned cost ceilings, not customer charges or exchange-rate claims.
  const murPerUsd = number('AI_BUDGET_MUR_PER_USD', 50, 1000);
  if (!murPerUsd) fail('ai_policy_invalid');
  const micro = mur => Math.floor(mur / murPerUsd * 1e6);
  return {
    version: VERSION, murPerUsd,
    family: micro(number('AI_FAMILY_MONTHLY_MUR', 50, 500)),
    care: micro(number('AI_CARE_MONTHLY_MUR', 100, 1000)),
    fleet: micro(number('AI_FLEET_MONTHLY_MUR', 15000, 1e7)),
    background: micro(number('AI_BACKGROUND_MONTHLY_MUR', 1000, 1e6)),
    routineShare: 0.7,
    callsPerDay: 40, callsPerJob: 3, maxTextBytes: 24000,
    maxInputTokens: 24000, maxOutputTokens: 1200,
  };
}
const monthKey = now => new Date(now + 4 * 3600000).toISOString().slice(0, 7);
const dayKey = now => new Date(now + 4 * 3600000).toISOString().slice(0, 10);
function rate(model) { return MODELS[model] || fail('ai_model_not_priced'); }
function cost(model, input, output) {
  if (![input, output].every(n => Number.isSafeInteger(n) && n >= 0)) fail('ai_usage_invalid');
  const r = rate(model);
  return Math.ceil(input * r.input + output * r.output);
}
function normalizedUsage(provider, value) {
  if (!value) return null;
  const input = provider === 'anthropic'
    ? value.input_tokens + (value.cache_creation_input_tokens || 0) + (value.cache_read_input_tokens || 0)
    : value.promptTokenCount;
  const output = provider === 'anthropic' ? value.output_tokens
    : (value.candidatesTokenCount ?? 0) + (value.thoughtsTokenCount ?? 0);
  if (![input, output].every(n => Number.isSafeInteger(n) && n >= 0)) return null;
  const creation = provider === 'anthropic' ? value.cache_creation_input_tokens || 0 : 0;
  const read = provider === 'anthropic' ? value.cache_read_input_tokens || 0 : 0;
  if (![creation, read].every(n => Number.isSafeInteger(n) && n >= 0)) return null;
  return { input_tokens: input, output_tokens: output,
    ...(creation || read ? { cache_creation_input_tokens: creation, cache_read_input_tokens: read } : {}) };
}
function usageCost(model, usage) {
  // Preserve real token counts, but conservatively charge unexpected cache
  // writes at 2x and reads at full input price. Explicit caching is rejected.
  return cost(model, usage.input_tokens + (usage.cache_creation_input_tokens || 0), usage.output_tokens);
}
module.exports = { IntelligenceError, fail, hash, VERSION, MODELS, FEATURES, INCIDENT, policy, monthKey, dayKey, rate, cost, usageCost, normalizedUsage };
