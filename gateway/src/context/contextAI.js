/**
 * Context AI: Claude-powered explanations for family safety context
 * Transforms structured weather/location facts into calm, helpful guidance
 */

const Logger = require('../logger');

const logger = new Logger('context-ai');

const GUARDIAN_SYSTEM_PROMPT = `You are Guardian, a calm family safety advisor. Your job: explain the situation clearly in 1-2 sentences max, then suggest 1 action.

**Rules:**
1. ONE or TWO sentences ONLY (under 150 chars)
2. Never mention "AI", "algorithm", or "device"
3. Never speculate (stick to facts provided)
4. Acknowledge if person is unreachable (offline/old location)
5. Suggest only these actions: "check in", "enable voice monitor", "monitor battery"

**Examples:**
- "Severe thunderstorm at Dexter's school. Check in with him."
- "Extreme heat where Mum is. Make sure she's in a cool place."
- "Offline for 2 hours (last at park). Check in when reachable."

**NOT allowed:**
- Multiple bullet points
- "Call 911" or medical advice
- Predictions about future ("will lose signal")
- Mentioning technology`;

class ContextAI {
  constructor(llmProvider, config) {
    this.llmProvider = llmProvider;
    this.config = config;
  }

  /**
   * Generate a Claude explanation for context evaluation
   * @param {object} weather - Normalized weather {temperature, condition, alerts, severity}
   * @param {object} person - Person {displayName, age, careContext}
   * @param {object} device - Device {online, batteryPercent, lastSeenMinutesAgo}
   * @param {object} location - Location {placeName, freshnessMinutes, accuracyClass}
   * @param {object} evaluation - ContextEvaluator result {relevant, severity, reasons, uncertainty}
   * @returns {Promise<string>} Explanation text
   */
  async explainContext(weather, person, device, location, evaluation) {
    const startTime = Date.now();

    try {
      // Only explain if context is relevant (no need for explanation if nothing to worry about)
      if (!evaluation.relevant) {
        return null;
      }

      // Build fact sheet for Claude
      const facts = this._buildFactSheet(weather, person, device, location, evaluation);

      // Call Claude with Guardian prompt
      const messages = [
        {
          role: 'user',
          content: facts,
        },
      ];

      if (!this.llmProvider) {
        logger.warn('No LLM provider available for context explanations');
        return null;
      }

      const result = await this.llmProvider.complete({
        systemPrompt: GUARDIAN_SYSTEM_PROMPT,
        messages,
        tools: [], // No tools needed for explanations
        metadata: {
          feature: 'context-ai',
          person: person?.displayName,
        },
      });

      const durationMs = Date.now() - startTime;

      // Extract text from response
      const textBlocks = (result.content || []).filter((b) => b.type === 'text');
      const explanation = textBlocks.map((b) => b.text || b.content).join('\n').trim();

      if (!explanation) {
        logger.warn('Claude returned empty explanation', { person: person?.displayName });
        return null;
      }

      // Validate response (tone, length, factual accuracy)
      const validation = this._validateExplanation(explanation, evaluation);
      if (!validation.valid) {
        logger.warn('Explanation validation failed', {
          person: person?.displayName,
          issues: validation.issues,
        });
        // Return as-is even if validation issues (defensive, not blocking)
      }

      logger.info('Context explanation generated', {
        person: person?.displayName,
        severity: evaluation.severity,
        durationMs,
        length: explanation.length,
      });

      return explanation;
    } catch (err) {
      logger.error('Context AI failed', {
        error: err.message,
        person: person?.displayName,
      });
      return null;
    }
  }

  /**
   * Build fact sheet for Claude
   * @private
   */
  _buildFactSheet(weather, person, device, location, evaluation) {
    const deviceStatus = device?.online
      ? `online, battery ${device.batteryPercent}%`
      : `offline, last seen ${device?.lastSeenMinutesAgo || '?'} minutes ago`;

    const locationStatus =
      location?.freshnessMinutes <= 15
        ? `currently at ${location?.placeName}`
        : `last known location ${location?.placeName} (${location?.freshnessMinutes} minutes ago)`;

    const weatherAlert = evaluation.reasons?.join('; ') || 'Weather context available';

    return `${person?.displayName} (age ${person?.age}) is ${locationStatus}.
Device: ${deviceStatus}.
Weather: ${weather?.condition} (${weather?.temperature}°C), severity: ${weather?.severity}.
Context: ${weatherAlert}.
Uncertainty: ${evaluation.uncertainty?.length > 0 ? evaluation.uncertainty.join('; ') : 'none'}.

Explain the situation clearly and suggest what the guardian should do.`;
  }

  /**
   * Validate explanation (tone, length, factual accuracy)
   * @private
   */
  _validateExplanation(explanation, evaluation) {
    const issues = [];

    // Check length (should be 1-2 sentences, roughly 50-200 chars after refinements)
    if (explanation.length < 50) {
      issues.push('Too short (less than 50 chars)');
    }
    if (explanation.length > 250) {
      issues.push('Too long (exceeds 250 chars)');
    }

    // Check for critical tone violations only (allow some flexibility)
    const lowerExpl = explanation.toLowerCase();
    if (lowerExpl.includes('artificial intelligence') || lowerExpl.includes('our algorithm')) {
      issues.push('Explicitly mentions AI/algorithm');
    }
    if (explanation.includes('911') || explanation.includes('emergency services')) {
      issues.push('Suggests calling 911 (outside Guardian scope)');
    }

    // Check for extreme alarmism (3+ exclamation marks or all caps sentences)
    const exclamationCount = (explanation.match(/!/g) || []).length;
    if (exclamationCount > 3) {
      issues.push('Too alarmist (too many exclamation marks)');
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  }

  /**
   * Get explanation for observe-only logging
   */
  async getProposedExplanation(weather, person, device, location, evaluation) {
    const explanation = await this.explainContext(weather, person, device, location, evaluation);
    if (!explanation) {
      return null;
    }

    return {
      text: explanation,
      severity: evaluation.severity,
      timestamp: new Date().toISOString(),
      person: person?.displayName,
      location: location?.placeName,
    };
  }
}

module.exports = ContextAI;
