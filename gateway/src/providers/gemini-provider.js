'use strict';
const LlmProvider = require('./llm-provider');
const { geminiMessage } = require('../intelligence-core/provider');
const { adaptToolsForGemini } = require('../gemini-tools-adapter');
function contents(messages) {
  const names = new Map();
  return messages.map(message => ({ role: message.role === 'assistant' ? 'model' : 'user',
    parts: typeof message.content === 'string' ? [{ text: message.content }] : message.content.map(part => {
      if (part.type === 'tool_use') { names.set(part.id, part.name); return { functionCall: { name: part.name, args: part.input }, ...(part.providerThoughtSignature ? { thoughtSignature: part.providerThoughtSignature } : {}) }; }
      if (part.type === 'tool_result') return { functionResponse: { name: names.get(part.tool_use_id), response: { result: part.content } } };
      return { text: part.text || '', ...(part.providerThoughtSignature ? { thoughtSignature: part.providerThoughtSignature } : {}) };
    }) }));
}
class GeminiProvider extends LlmProvider {
  constructor(config) { super(config); if (!config.geminiApiKey) throw Error('Gemini is not configured'); }
  async complete({ systemPrompt, messages, tools, maxTokens = 512 }) {
    const started = Date.now(), model = this.config.geminiModel || 'gemini-3.1-flash-lite';
    const { payload, usage } = await geminiMessage({ apiKey: this.config.geminiApiKey, model,
      fetchImpl: this.config.fetchImpl || fetch,
      body: { contents: contents(messages), systemInstruction: { parts: [{ text: systemPrompt || '' }] },
        ...(tools?.length ? { tools: [{ functionDeclarations: adaptToolsForGemini(tools) }] } : {}),
        generationConfig: { maxOutputTokens: maxTokens, thinkingConfig: { thinkingLevel: 'minimal' } } } });
    const candidate = payload.candidates?.[0];
    const content = (candidate?.content?.parts || []).filter(p => !p.thought).map((part, index) => part.functionCall
      ? { type: 'tool_use', id: `call_${index}_${Date.now()}`, name: part.functionCall.name, input: part.functionCall.args || {}, ...(part.thoughtSignature ? { providerThoughtSignature: part.thoughtSignature } : {}) }
      : { type: 'text', text: part.text || '', ...(part.thoughtSignature ? { providerThoughtSignature: part.thoughtSignature } : {}) });
    return { content, usage, provider: 'gemini', model: payload.modelVersion || model,
      stopReason: content.some(p => p.type === 'tool_use') ? 'tool_use' : candidate?.finishReason === 'STOP' ? 'end_turn' : 'max_tokens',
      latencyMs: Date.now() - started };
  }
  async health() { return { ok: !!this.config.geminiApiKey, verification: 'configuration_only' }; }
}
module.exports = GeminiProvider;
