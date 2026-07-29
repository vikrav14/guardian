const LlmProvider = require('./llm-provider');

/**
 * Template-based fallback provider (no API call).
 *
 * Returns pre-composed responses based on detected intent.
 * Used when Gemini and Anthropic are unavailable.
 *
 * Safe, deterministic, and fast — but limited to common cases.
 */

class TemplateFallbackProvider extends LlmProvider {
  constructor(config) {
    super(config);
  }

  async complete({ systemPrompt, messages, tools, metadata }) {
    const userText = this.#extractUserText(messages);
    const intent = this.#detectIntent(userText);

    // Compose a template response based on intent + device data
    // This is placeholder; real implementation would access device state
    const reply = this.#getTemplateReply(intent, metadata);

    return {
      content: [{ type: 'text', text: reply }],
      usage: { input_tokens: 0, output_tokens: 0 },
      stopReason: 'STOP',
      provider: 'template-fallback',
      latencyMs: 10,
    };
  }

  #extractUserText(messages) {
    if (!messages || messages.length === 0) return '';
    const lastMsg = messages[messages.length - 1];
    return typeof lastMsg.content === 'string' ? lastMsg.content : '';
  }

  #detectIntent(text) {
    const lower = String(text || '').toLowerCase();
    if (/\b(where|locate|at|location)\b/.test(lower)) return 'location';
    if (/\b(battery|signal|online)\b/.test(lower)) return 'battery';
    if (/\b(alert|alarm|sos|emergency)\b/.test(lower)) return 'urgent';
    return 'unknown';
  }

  #getTemplateReply(intent, metadata) {
    const wearer = metadata?.wearer?.displayName || 'loved one';

    switch (intent) {
      case 'location':
        // Placeholder: real implementation would fetch device location
        return `I could not reach live data for ${wearer}'s location. Try again in a moment.`;

      case 'battery':
        return `I could not reach live data. Please check the app for ${wearer}'s battery status.`;

      case 'urgent':
        return `I'm having trouble reaching live data right now. If this is an emergency, contact emergency services or ${wearer}'s emergency contacts directly.`;

      default:
        return `I could not process this request. I'm designed mainly for family safety questions like "Where is ${wearer}?" or "Battery?"`;
    }
  }

  async health() {
    return { ok: true, message: 'Template fallback always available' };
  }
}

module.exports = TemplateFallbackProvider;
