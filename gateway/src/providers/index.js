const GeminiProvider = require('./gemini-provider');
const AnthropicProvider = require('./anthropic-provider');
const TemplateFallbackProvider = require('./template-fallback-provider');

/**
 * Factory to create an LLM provider based on configuration.
 *
 * Selection logic:
 * 1. If LLM_PROVIDER env var is set, use that explicitly
 * 2. Else, try: Gemini (if API key) → Anthropic (if API key) → Template
 *
 * Returns a primary provider and a fallback provider.
 */

function createLlmProvider(config) {
  const explicit = config.llmProvider;

  if (explicit === 'gemini') {
    return new GeminiProvider(config);
  }
  if (explicit === 'anthropic') {
    return new AnthropicProvider(config);
  }
  if (explicit === 'template') {
    return new TemplateFallbackProvider(config);
  }

  // Auto-detect based on API keys
  if (config.geminiApiKey) {
    console.log('[providers] Using Gemini (API key found)');
    return new GeminiProvider(config);
  }
  if (config.anthropicApiKey) {
    console.log('[providers] Using Anthropic (Gemini key not found)');
    return new AnthropicProvider(config);
  }

  console.log('[providers] No API keys found; using template fallback');
  return new TemplateFallbackProvider(config);
}

/**
 * Create a chain of providers with fallback.
 * Primary tries Gemini, falls back to Anthropic, then template.
 */
function createProviderChain(config) {
  const providers = [];

  if (config.geminiApiKey) {
    providers.push({ name: 'gemini', provider: new GeminiProvider(config) });
  }
  if (config.anthropicApiKey) {
    providers.push({ name: 'anthropic', provider: new AnthropicProvider(config) });
  }
  providers.push({ name: 'template', provider: new TemplateFallbackProvider(config) });

  return providers;
}

module.exports = {
  createLlmProvider,
  createProviderChain,
  GeminiProvider,
  AnthropicProvider,
  TemplateFallbackProvider,
};
