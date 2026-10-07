'use strict';
const { currentScope, meteredCall } = require('./runtime');
const { fail, rate, normalizedUsage, IntelligenceError } = require('./policy');
async function jsonRequest(url, body, headers, fetchImpl) {
  let response;
  try { response = await fetchImpl(url, { method: 'POST', redirect: 'error',
    signal: AbortSignal.timeout(20000), headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }); }
  catch (error) { fail(error?.name === 'TimeoutError' ? 'ai_timeout' : 'ai_network_failed'); }
  if (!response.ok) {
    const error = new IntelligenceError('ai_http_error');
    if (Number.isInteger(response.status)) error.httpStatus = response.status;
    throw error;
  }
  try { return await response.json(); } catch { fail('ai_invalid_response'); }
}
function checkBody(body) {
  const scope = currentScope();
  let images = 0;
  // Only actual inline image blocks get a separate binary allowance. A tool
  // result named "data" must still count against the text budget.
  const text = JSON.stringify(body, (key, value) => {
    if (key === 'cache_control' || key === 'cachedContent' || key === 'inference_geo' || key === 'service_tier') fail('ai_unsupported_pricing_option');
    if (value?.type !== 'image') return value;
    const source = value.source;
    const maxBytes = source?.media_type === 'image/jpeg' ? 65536 : 4000000;
    if (++images > 4 || source?.type !== 'base64' || !['image/jpeg', 'image/png'].includes(source.media_type) ||
        typeof source.data !== 'string' || source.data.length > Math.ceil(maxBytes / 3) * 4 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(source.data)) fail('ai_invalid_image');
    return { type: 'image', source: { type: 'base64', media_type: source.media_type, data: '[bounded image]' } };
  });
  if (Buffer.byteLength(text) > scope.limits.maxTextBytes) fail('ai_request_too_large');
  return scope;
}
async function anthropicMessage({ apiKey, body, fetchImpl = fetch, feature }) {
  const scope = checkBody(body), model = body.model;
  if (!apiKey || rate(model).provider !== 'anthropic') fail('ai_provider_unavailable');
  await scope.authorize();
  const headers = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
  const countBody = { model, messages: body.messages, ...(body.system ? { system: body.system } : {}),
    ...(body.output_config ? { output_config: body.output_config } : {}),
    ...(body.tools?.length ? { tools: body.tools } : {}) };
  const count = await jsonRequest('https://api.anthropic.com/v1/messages/count_tokens', countBody, headers, fetchImpl);
  return meteredCall({ model, inputTokens: count.input_tokens, maxTokens: body.max_tokens, feature, perform: async () => {
    const payload = await jsonRequest('https://api.anthropic.com/v1/messages', body, headers, fetchImpl);
    return { payload, usage: normalizedUsage('anthropic', payload.usage) };
  } });
}
async function geminiMessage({ apiKey, model, body, fetchImpl = fetch, feature }) {
  const scope = checkBody(body);
  if (!apiKey || rate(model).provider !== 'gemini') fail('ai_provider_unavailable');
  await scope.authorize();
  const base = `https://generativelanguage.googleapis.com/v1beta/models/${model}`;
  const headers = { 'x-goog-api-key': apiKey };
  const count = await jsonRequest(`${base}:countTokens`, { generateContentRequest: { model: `models/${model}`, ...body } }, headers, fetchImpl);
  return meteredCall({ model, inputTokens: count.totalTokens, maxTokens: body.generationConfig.maxOutputTokens, feature, perform: async () => {
    const payload = await jsonRequest(`${base}:generateContent`, body, headers, fetchImpl);
    return { payload, usage: normalizedUsage('gemini', payload.usageMetadata) };
  } });
}
module.exports = { anthropicMessage, geminiMessage, jsonRequest };
