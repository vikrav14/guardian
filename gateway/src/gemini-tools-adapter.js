/**
 * Adapt Anthropic tool definitions to Gemini format.
 *
 * Anthropic uses "input_schema" for tool parameters.
 * Gemini uses "parameters" (Google's function_declarations format).
 *
 * This adapter converts between the two.
 */

function adaptToolsForGemini(anthropicTools) {
  if (!anthropicTools || anthropicTools.length === 0) {
    return [];
  }

  return anthropicTools.map((tool) => ({
    name: tool.name,
    description: tool.description || '',
    parameters: {
      type: 'OBJECT',
      properties: tool.input_schema?.properties || {},
      required: tool.input_schema?.required || [],
    },
  }));
}

module.exports = { adaptToolsForGemini };
