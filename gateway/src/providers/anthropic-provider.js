'use strict';
const LlmProvider = require('./llm-provider');
const { anthropicMessage } = require('../intelligence-core/provider');
class AnthropicProvider extends LlmProvider {
  constructor(config) {
    super(config);
    if (!config.anthropicApiKey) throw Error('Anthropic is not configured');
  }
  async complete({ systemPrompt, messages, tools, outputSchema, maxTokens = 512 }) {
    const started = Date.now();
    const { payload, usage } = await anthropicMessage({ apiKey: this.config.anthropicApiKey,
      fetchImpl: this.config.fetchImpl || fetch,
      body: { model: this.config.anthropicModel || 'claude-haiku-4-5-20251001', max_tokens: maxTokens,
        system: systemPrompt, ...(tools?.length ? { tools } : {}),
        ...(outputSchema ? { output_config: { format: { type: 'json_schema', schema: outputSchema } } } : {}), messages } });
    return { content: payload.content || [], usage, stopReason: payload.stop_reason,
      provider: 'anthropic', model: payload.model, latencyMs: Date.now() - started };
  }
  // Health probes never consume paid generations.
  async health() { return { ok: !!this.config.anthropicApiKey, verification: 'configuration_only' }; }
}
module.exports = AnthropicProvider;
