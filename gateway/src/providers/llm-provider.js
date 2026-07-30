/**
 * Abstract LLM provider interface.
 * All providers (Gemini, Anthropic, Template) implement this contract.
 *
 * Ensures Guardian remains provider-agnostic and can fall back gracefully.
 */

class LlmProvider {
  constructor(config) {
    this.config = config;
  }

  /**
   * Send a request to the LLM.
   *
   * @param {Object} params
   * @param {string} params.systemPrompt - System role/guardrails
   * @param {Array<{role, content}>} params.messages - Conversation history
   * @param {Array} params.tools - Tool definitions (Anthropic format)
   * @param {Object} params.metadata - {requestId, userId, locale, ...}
   * @returns {Promise<{content, usage, stopReason, provider}>}
   *          content: message content blocks
   *          usage: {input_tokens, output_tokens}
   *          stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | etc
   *          provider: provider name for audit
   */
  async complete({ systemPrompt, messages, tools, metadata }) {
    throw new Error(`${this.constructor.name}.complete() not implemented`);
  }

  /**
   * Test provider availability (health check).
   * @returns {Promise<{ok, message}>}
   */
  async health() {
    throw new Error(`${this.constructor.name}.health() not implemented`);
  }
}

module.exports = LlmProvider;
