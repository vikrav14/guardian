'use strict';

// Synthetic text only: never load Firestore, Storage, a photo or the gateway.
// Production photo errors continue to omit provider bodies. This separate probe
// can expose a bounded error explanation because its prompt contains no user data.
const { isDeepStrictEqual } = require('node:util');
const { requestPhotoJson, DESCRIPTION_SCHEMA, analysisFailure, analysisProvenance } = require('../src/incident-photo-analysis');
const { ORIENTATION_SCHEMA } = require('../src/incident-photo-orientation');
const MAX_ERROR_BYTES = 16_384;

async function providerError(response, apiKey) {
  const reader = response.body?.getReader();
  if (!reader) return {};
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_ERROR_BYTES) {
        await reader.cancel();
        return { providerDetail: 'response_too_large' };
      }
      chunks.push(Buffer.from(value));
    }
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const message = payload?.error?.message;
    const type = payload?.error?.type;
    return {
      ...(['invalid_request_error', 'authentication_error', 'permission_error', 'not_found_error',
        'request_too_large', 'rate_limit_error', 'api_error', 'overloaded_error'].includes(type)
        ? { providerErrorType: type } : {}),
      ...(typeof message === 'string' ? { providerMessage: message.split(apiKey).join('[redacted]')
        .replace(/sk-ant-[A-Za-z0-9_-]+/g, '[redacted]')
        .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
        .replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 800) } : {}),
    };
  } catch { return { providerDetail: 'unavailable' }; }
  finally { reader.releaseLock(); }
}

async function checkPhotoAi({ apiKey, model, fetchImpl = fetch }) {
  const report = { outcome: 'photo_ai_contract_check', configurationSource: 'this_shell_not_running_gateway',
    model: analysisProvenance({ model }).model || null, input: 'synthetic_text_only', ok: false, checks: [] };
  if (!apiKey || !report.model) return { ...report, reason: 'api_key_or_model_missing_or_invalid' };
  const stages = [
    { name: 'orientation_schema', schema: ORIENTATION_SCHEMA, maxTokens: 160, maxChars: 1000,
      expected: { view: null, confidence: 'low' } },
    { name: 'description_schema', schema: DESCRIPTION_SCHEMA, maxTokens: 900, maxChars: 5000,
      expected: { status: 'ready', summary: 'Synthetic configuration check.', visibleDetails: [],
        uncertainDetails: [], limitations: [], orientation: { clockwiseDegrees: null, confidence: 'low' } } },
  ];
  for (const stage of stages) {
    let detail = {};
    let httpStatus = null;
    try {
      const { parsed, responseModel } = await requestPhotoJson({ apiKey, model,
        schema: stage.schema, maxTokens: stage.maxTokens, maxChars: stage.maxChars,
        system: 'This is a synthetic API configuration test, not an image analysis. Return the supplied JSON exactly.',
        imageContent: [{ type: 'text', text: JSON.stringify(stage.expected) }],
        fetchImpl: async (...args) => {
          const response = await fetchImpl(...args);
          httpStatus = response.status;
          if (!response.ok) detail = await providerError(response, apiKey);
          return response;
        } });
      const ok = isDeepStrictEqual(parsed, stage.expected);
      report.checks.push({ stage: stage.name, ok, httpStatus, ...analysisProvenance({ responseModel }),
        ...(!ok ? { reason: 'synthetic_output_mismatch' } : {}) });
      if (!ok) return report;
    } catch (error) {
      const failure = analysisFailure(error);
      report.checks.push({ stage: stage.name, ok: false, httpStatus, reason: failure.reason,
        ...(failure.diagnostics ? { diagnostics: failure.diagnostics } : {}), ...detail });
      return report; // No automatic retry, model switch or second request after failure.
    }
  }
  return { ...report, ok: true };
}

async function main() {
  if (process.argv.slice(2).join(' ') !== '--run') {
    console.log(JSON.stringify({ outcome: 'not_run', usage: 'node scripts/check-incident-photo-ai.js --run',
      note: 'Makes at most two synthetic text API calls using the configured photo model. No photos or database access.' }, null, 2));
    process.exitCode = 1;
    return;
  }
  const config = require('../src/config');
  const result = await checkPhotoAi({ apiKey: config.anthropicApiKey,
    model: process.env.INCIDENT_PHOTO_AI_MODEL || config.anthropicModel });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
if (require.main === module) main().catch(() => {
  console.error(JSON.stringify({ outcome: 'photo_ai_contract_check_failed' }));
  process.exitCode = 1;
});
module.exports = { checkPhotoAi };
