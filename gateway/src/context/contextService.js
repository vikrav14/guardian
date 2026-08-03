/**
 * Context Intelligence Service
 * Orchestrates weather, location, and device data to provide family safety context
 * Operates in observe-only mode: logs proposed alerts without notifying users
 */

const WeatherProvider = require('./weatherProvider');
const ContextEvaluator = require('./contextEvaluator');
const ContextAI = require('./contextAI');
const { validateSchema, deviceContextSchema } = require('./contextSchemas');
const Logger = require('../logger');

const logger = new Logger('context-service');

class ContextService {
  constructor(openWeatherMapApiKey, llmProvider = null, config = {}) {
    this.weatherProvider = new WeatherProvider(openWeatherMapApiKey, 30);
    this.evaluator = new ContextEvaluator();
    this.ai = new ContextAI(llmProvider, config);
    this.observeLog = []; // Log proposed alerts in observe-only mode
  }

  /**
   * Get full context for a device
   * @param {object} device - Device state {online, lastSeenAt, batteryPercent}
   * @param {object} person - Person {displayName, age, careContext}
   * @param {object} location - Location {lat, lng, placeName, freshnessMinutes, accuracyClass}
   * @returns {Promise<object>} Full context with weather and evaluation
   */
  async getDeviceContext(device, person, location) {
    const startTime = Date.now();

    try {
      // Get weather for this location
      const weather = await this.weatherProvider.getWeather(
        location?.lat,
        location?.lng,
        location?.placeName
      );

      // Evaluate if weather is relevant to this person
      const evaluation = this.evaluator.evaluateWeatherRelevance(
        weather,
        person,
        device,
        location
      );

      // Generate Claude explanation if context is relevant
      let explanation = null;
      if (evaluation.relevant) {
        explanation = await this.ai.explainContext(weather, person, device, location, evaluation);
      }

      // Construct full context response
      const context = {
        device: {
          online: device?.online,
          lastSeenAt: device?.lastSeenAt,
          batteryPercent: device?.batteryPercent,
        },
        location: {
          lat: location?.lat,
          lng: location?.lng,
          placeName: location?.placeName,
          freshnessMinutes: location?.freshnessMinutes,
          accuracyClass: location?.accuracyClass,
        },
        weather,
        contextEvaluation: evaluation,
        explanation, // Claude-generated explanation (null if not relevant)
        fetchedAt: new Date().toISOString(),
      };

      // Validate response format
      const validation = validateSchema(context, deviceContextSchema);
      if (!validation.valid) {
        logger.warn('Context response validation failed', {
          person: person?.displayName,
          errors: validation.errors,
        });
        // Proceed anyway - validation is defensive, not blocking
      }

      // Log in observe-only mode if relevant
      if (evaluation.relevant) {
        this._logObservation(person, device, location, evaluation);
      }

      logger.info('Context retrieved', {
        person: person?.displayName,
        relevant: evaluation.relevant,
        severity: evaluation.severity,
        durationMs: Date.now() - startTime,
      });

      return context;
    } catch (err) {
      logger.error('Context retrieval failed', {
        error: err.message,
        person: person?.displayName,
      });

      // Return minimal safe context on error
      return {
        device: {
          online: device?.online,
          lastSeenAt: device?.lastSeenAt,
          batteryPercent: device?.batteryPercent,
        },
        location: {
          lat: location?.lat,
          lng: location?.lng,
          placeName: location?.placeName,
        },
        weather: { condition: 'unknown', alerts: [], severity: 'unknown' },
        contextEvaluation: {
          relevant: false,
          severity: 'none',
          message: 'Could not evaluate context at this time',
        },
        fetchedAt: new Date().toISOString(),
        error: err.message,
      };
    }
  }

  /**
   * Log observation in observe-only mode
   * Records proposed alerts for monitoring without notifying users
   * @private
   */
  _logObservation(person, device, location, evaluation) {
    const observation = {
      timestamp: new Date().toISOString(),
      person: person?.displayName,
      location: location?.placeName,
      severity: evaluation.severity,
      message: evaluation.message,
      reasons: evaluation.reasons,
      uncertainty: evaluation.uncertainty,
      deviceState: {
        online: device?.online,
        battery: device?.batteryPercent,
      },
      locationFreshness: location?.freshnessMinutes,
    };

    this.observeLog.push(observation);

    // Keep only last 1000 observations
    if (this.observeLog.length > 1000) {
      this.observeLog.shift();
    }

    logger.info('Context observation logged', {
      person: person?.displayName,
      severity: evaluation.severity,
    });
  }

  /**
   * Get observe-only log (for debugging/metrics)
   */
  getObservationLog(limit = 50) {
    return this.observeLog.slice(-limit);
  }

  /**
   * Get service stats
   */
  getStats() {
    return {
      weatherCacheSize: this.weatherProvider.getCacheStats().entries,
      observationLogSize: this.observeLog.length,
      lastObservation: this.observeLog[this.observeLog.length - 1] || null,
    };
  }

  /**
   * Clear logs (useful for testing/admin)
   */
  clearObservationLog() {
    this.observeLog = [];
    logger.info('Observation log cleared');
  }
}

module.exports = ContextService;
