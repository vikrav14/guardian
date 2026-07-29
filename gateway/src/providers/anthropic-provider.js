const LlmProvider = require('./llm-provider');

/**
 * Anthropic Claude provider (fallback).
 *
 * Uses Claude models as a secondary provider or fallback.
 * Models: claude-sonnet-4, claude-opus, etc.
 */

class AnthropicProvider extends LlmProvider {
  constructor(config) {
    super(config);
    if (!config.anthropicApiKey) {
      throw new Error('ANTHROPIC_API_KEY is required for AnthropicProvider');
    }
  }

  async complete({ systemPrompt, messages, tools, metadata }) {
    if (!this.config.anthropicApiKey) {
      throw new Error('ANTHROPIC_API_KEY not configured');
    }

    const started = Date.now();

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.config.anthropicApiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.config.anthropicModel || 'claude-sonnet-4-20250514',
          max_tokens: 512,
          system: systemPrompt,
          tools: tools || [],
          messages,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        const msg = data?.error?.message || JSON.stringify(data).slice(0, 200);
        throw new Error(`Anthropic API error: ${msg}`);
      }

      const latencyMs = Date.now() - started;

      return {
        content: data.content || [],
        usage: {
          input_tokens: data.usage?.input_tokens || 0,
          output_tokens: data.usage?.output_tokens || 0,
        },
        stopReason: data.stop_reason,
        provider: 'anthropic',
        latencyMs,
      };
    } catch (err) {
      const latencyMs = Date.now() - started;
      console.error('[anthropic-provider]', err.message);
      throw err;
    }
  }

  async health() {
    try {
      await this.complete({
        systemPrompt: 'You are a helpful assistant.',
        messages: [{ role: 'user', content: 'ping' }],
        tools: [],
        metadata: {},
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  }
}

module.exports = AnthropicProvider;
