const LlmProvider = require('./llm-provider');
const { adaptToolsForGemini } = require('../gemini-tools-adapter');

/**
 * Google Gemini Flash provider (paid tier).
 *
 * Uses the official Google Generative AI SDK.
 * Model: gemini-1.5-flash (fast, low-cost, multilingual)
 */

class GeminiProvider extends LlmProvider {
  constructor(config) {
    super(config);
    if (!config.geminiApiKey) {
      throw new Error('GEMINI_API_KEY is required for GeminiProvider');
    }
    // Lazy-load the SDK only if this provider is used
    this.client = null;
  }

  #getClient() {
    if (!this.client) {
      const { GoogleGenerativeAI } = require('@google/generative-ai');
      this.client = new GoogleGenerativeAI(this.config.geminiApiKey);
    }
    return this.client;
  }

  async complete({ systemPrompt, messages, tools, metadata }) {
    const client = this.#getClient();
    const model = client.getGenerativeModel({
      model: this.config.geminiModel || 'gemini-1.5-flash',
    });

    const started = Date.now();

    try {
      // Convert Anthropic message format to Gemini format
      const history = messages.slice(0, -1).map((m) => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [
          {
            text:
              typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
          },
        ],
      }));

      const userMessage = messages[messages.length - 1];
      const userContent =
        typeof userMessage.content === 'string'
          ? userMessage.content
          : JSON.stringify(userMessage.content);

      // Adapt Anthropic tool format to Gemini format
      const geminiTools = tools && tools.length > 0 ? adaptToolsForGemini(tools) : undefined;

      const result = await model.generateContent({
        systemInstruction: systemPrompt || undefined,
        contents: [
          ...history,
          { role: 'user', parts: [{ text: userContent }] },
        ],
        tools: geminiTools ? { functionDeclarations: geminiTools } : undefined,
      });

      const response = result.response;
      const latencyMs = Date.now() - started;

      return {
        content: response.content.parts,
        usage: {
          input_tokens: response.usageMetadata?.promptTokens || 0,
          output_tokens: response.usageMetadata?.candidatesTokens || 0,
        },
        stopReason: response.candidates?.[0]?.finishReason || 'STOP',
        provider: 'gemini',
        latencyMs,
      };
    } catch (err) {
      const latencyMs = Date.now() - started;
      console.error('[gemini-provider]', err.message);
      throw new Error(
        `Gemini API error: ${err.message || 'unknown'} (${latencyMs}ms)`
      );
    }
  }

  async health() {
    const client = this.#getClient();
    const model = client.getGenerativeModel({ model: 'gemini-1.5-flash' });
    try {
      await model.generateContent('ping');
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  }
}

module.exports = GeminiProvider;
