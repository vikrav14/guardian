/**
 * Shared Context Intelligence Service.
 *
 * External facts are fetched once per geographic cache cell, deterministic
 * rules produce candidates, and one optional LLM call makes the final shadow
 * relevance decision. No delivery channel is invoked from this module.
 */

const WeatherProvider = require('./weatherProvider');
const ContextEvaluator = require('./contextEvaluator');
const ContextAI = require('./contextAI');
const { validCoordinatePair } = require('./deviceContextAdapter');
const { validateSchema, deviceContextSchema } = require('./contextSchemas');
const {
  increment: incrementMetric,
  recordAssistantUsage,
} = require('../ops-metrics/collector');
const Logger = require('../logger');

const logger = new Logger({ module: 'context-service' });

class ContextService {
  constructor(openWeatherMapApiKey, llmProvider = null, config = {}, dependencies = {}) {
    this.config = config || {};
    this.weatherProvider = dependencies.weatherProvider || new WeatherProvider(
      openWeatherMapApiKey,
      this.config.contextWeatherCacheMinutes || 60
    );
    this.evaluator = dependencies.evaluator || new ContextEvaluator();
    this.ai = dependencies.ai || new ContextAI(llmProvider, this.config);
    this.capAlertProvider = dependencies.capAlertProvider || null;
    this.observeLog = [];
  }

  async getDeviceContext(device, person, location, options = {}) {
    const startTime = Date.now();
    const safeDevice = this._safeDevice(device);
    const safeLocation = this._safeLocation(location);

    try {
      if (!validCoordinatePair(safeLocation.lat, safeLocation.lng)) {
        throw new Error('No trustworthy location available for context evaluation');
      }
      incrementMetric('contextDevicesEvaluated');
      const weather = options.skipWeather === true
        ? this._notRequestedWeather()
        : await this.weatherProvider.getWeather(
          safeLocation.lat,
          safeLocation.lng,
          safeLocation.placeName
        );
      if (weather?.error) incrementMetric('contextWeatherErrors');

      const weatherEvaluation = this.evaluator.evaluateWeatherRelevance(
        weather,
        person,
        safeDevice,
        safeLocation
      );
      const officialAlerts = this.capAlertProvider
        ? this.capAlertProvider.getApplicableAlerts(safeLocation, {
          now: options.now || new Date(),
        })
        : [];
      const officialAlertEvaluation = this.evaluator.evaluateOfficialAlertRelevance(
        officialAlerts,
        person,
        safeDevice,
        safeLocation
      );
      const deterministicEvaluation = this.evaluator.combineEvaluations(
        officialAlertEvaluation,
        weatherEvaluation
      );

      let contextEvaluation = { ...deterministicEvaluation };
      let explanation = deterministicEvaluation.relevant
        ? deterministicEvaluation.message
        : null;
      let contextDecision = this._deterministicDecision(
        deterministicEvaluation,
        weather,
        officialAlerts
      );

      if (deterministicEvaluation.relevant) {
        incrementMetric('contextRelevantCandidates');
        const aiResult = await this.ai.assessContext(
          weather,
          person,
          safeDevice,
          safeLocation,
          deterministicEvaluation,
          officialAlerts
        );
        this._recordLlmUsage(aiResult);

        if (aiResult.valid) {
          incrementMetric('contextLlmDecisions');
          contextDecision = {
            mode: 'llm_shadow',
            ...aiResult.decision,
            provider: aiResult.provider,
            durationMs: aiResult.durationMs,
            observeOnly: true,
          };
          contextEvaluation = {
            ...deterministicEvaluation,
            relevant: aiResult.decision.relevant,
            severity: aiResult.decision.relevant
              ? deterministicEvaluation.severity
              : 'none',
            message: aiResult.decision.relevant
              ? aiResult.decision.explanation
              : 'No context surfaced after relevance review.',
          };
          explanation = aiResult.decision.explanation;
        } else if (
          this.config.contextLlmJudgmentEnabled !== false &&
          aiResult.reason !== 'not_a_candidate'
        ) {
          incrementMetric('contextLlmFallbacks');
          contextDecision.fallbackReason = aiResult.reason;
        }
      }

      const context = {
        device: safeDevice,
        location: safeLocation,
        weather,
        officialAlerts,
        deterministicEvaluation,
        contextEvaluation,
        contextDecision,
        explanation,
        delivery: {
          mode: 'observe_only',
          sent: false,
        },
        fetchedAt: new Date().toISOString(),
      };

      const validation = validateSchema(context, deviceContextSchema);
      if (!validation.valid) {
        logger.warn('Context response validation failed', { errors: validation.errors });
      }

      // Log every deterministic candidate, including candidates the model
      // suppresses. This is required to measure false positives before launch.
      if (deterministicEvaluation.relevant) {
        this._logObservation(
          options.imei,
          person,
          safeDevice,
          safeLocation,
          deterministicEvaluation,
          contextDecision,
          officialAlerts
        );
      }

      logger.info('Context retrieved', {
        source: options.source || 'on_demand',
        relevant: contextEvaluation.relevant,
        deterministicCandidate: deterministicEvaluation.relevant,
        severity: contextEvaluation.severity,
        decisionMode: contextDecision.mode,
        durationMs: Date.now() - startTime,
      });
      return context;
    } catch (err) {
      logger.error('Context retrieval failed', { error: err.message });
      return this._errorContext(safeDevice, safeLocation, err);
    }
  }

  _recordLlmUsage(result = {}) {
    if (!result.attempted) return;
    incrementMetric('contextLlmCalls');
    const input = Number(result.usage?.input_tokens || result.usage?.inputTokens || 0);
    const output = Number(result.usage?.output_tokens || result.usage?.outputTokens || 0);
    recordAssistantUsage({ input_tokens: input, output_tokens: output });
    incrementMetric('contextLlmTokensIn', input);
    incrementMetric('contextLlmTokensOut', output);
  }

  _deterministicDecision(evaluation, weather, officialAlerts = []) {
    const eligibleOfficialAlerts = officialAlerts.filter((alert) => (
      alert?.source?.authority === 'official_authority' &&
      alert?.active === true &&
      alert?.status === 'actual' &&
      alert?.messageType !== 'cancel' &&
      alert?.certainty !== 'unlikely' &&
      alert?.urgency !== 'past' &&
      ['moderate', 'severe', 'extreme'].includes(alert?.severity)
    ));
    const sourceConfidence = eligibleOfficialAlerts.length
      ? Math.max(...eligibleOfficialAlerts.map((alert) => (
        alert.applicability?.confidence === 'exact' ? 0.98 : 0.85
      )))
      : null;
    return {
      mode: 'deterministic_fallback',
      relevant: evaluation.relevant,
      confidence: sourceConfidence != null
        ? sourceConfidence
        : (Number.isFinite(Number(weather?.confidence))
        ? Number(weather.confidence)
        : 0),
      recommendedSurface: evaluation.relevant ? 'app' : 'suppress',
      recommendedAction: evaluation.relevant ? 'check_in' : 'none',
      reason: evaluation.relevant
        ? 'Deterministic context candidate; LLM judgment unavailable or not required.'
        : 'No deterministic context candidate.',
      explanation: evaluation.relevant ? evaluation.message : null,
      observeOnly: true,
    };
  }

  _safeDevice(device = {}) {
    const rawLastSeen = device?.lastSeenAt;
    const lastSeenAt = rawLastSeen instanceof Date
      ? rawLastSeen.toISOString()
      : (rawLastSeen ? String(rawLastSeen) : null);
    return {
      online: device?.online === true,
      lastSeenAt,
      batteryPercent: device?.batteryPercent != null && Number.isFinite(Number(device.batteryPercent))
        ? Number(device.batteryPercent)
        : null,
      lastSeenMinutesAgo: device?.lastSeenMinutesAgo != null && Number.isFinite(Number(device.lastSeenMinutesAgo))
        ? Math.max(0, Number(device.lastSeenMinutesAgo))
        : null,
    };
  }

  _safeLocation(location = {}) {
    return {
      lat: location?.lat == null ? Number.NaN : Number(location.lat),
      lng: location?.lng == null ? Number.NaN : Number(location.lng),
      placeName: String(location?.placeName || 'Unknown location'),
      freshnessMinutes: location?.freshnessMinutes != null && Number.isFinite(Number(location.freshnessMinutes))
        ? Math.max(0, Number(location.freshnessMinutes))
        : null,
      accuracyClass: ['precise', 'good', 'approximate', 'unknown'].includes(
        location?.accuracyClass
      )
        ? location.accuracyClass
        : 'unknown',
    };
  }

  _notRequestedWeather() {
    return {
      temperature: null,
      condition: 'not requested',
      description: 'Weather was not fetched for this source-triggered evaluation.',
      alerts: [],
      severity: 'normal',
      fetchedAt: Date.now(),
      source: 'not_requested',
      confidence: 0,
    };
  }

  _logObservation(
    imei,
    person,
    device,
    location,
    deterministicEvaluation,
    decision,
    officialAlerts = []
  ) {
    const observation = {
      timestamp: new Date().toISOString(),
      imei: imei || null,
      person: person?.displayName,
      location: location?.placeName,
      deterministicSeverity: deterministicEvaluation.severity,
      deterministicReasons: deterministicEvaluation.reasons,
      uncertainty: deterministicEvaluation.uncertainty,
      decision: {
        mode: decision.mode,
        relevant: decision.relevant,
        confidence: decision.confidence,
        recommendedSurface: decision.recommendedSurface,
        recommendedAction: decision.recommendedAction,
        reason: decision.reason,
      },
      deviceState: {
        online: device?.online,
        battery: device?.batteryPercent,
      },
      locationFreshness: location?.freshnessMinutes,
      officialAlertIds: officialAlerts.map((alert) => alert.id),
      observeOnly: true,
    };
    this.observeLog.push(observation);
    if (this.observeLog.length > 1000) this.observeLog.shift();
    incrementMetric('contextObservations');
  }

  _errorContext(device, location, err) {
    const evaluation = {
      relevant: false,
      severity: 'none',
      reasons: [],
      uncertainty: ['Context evaluation failed'],
      message: 'Could not evaluate context at this time',
    };
    return {
      device,
      location,
      weather: {
        condition: 'unknown',
        alerts: [],
        severity: 'unknown',
        fetchedAt: Date.now(),
        source: 'openweathermap',
        confidence: 0,
      },
      officialAlerts: [],
      deterministicEvaluation: evaluation,
      contextEvaluation: evaluation,
      contextDecision: {
        mode: 'error_fallback',
        relevant: false,
        confidence: 0,
        recommendedSurface: 'suppress',
        recommendedAction: 'none',
        reason: 'Context evaluation failed.',
        explanation: null,
        observeOnly: true,
      },
      explanation: null,
      delivery: { mode: 'observe_only', sent: false },
      fetchedAt: new Date().toISOString(),
      error: err.message,
    };
  }

  getObservationLog(limit = 50) {
    return this.observeLog.slice(-limit);
  }

  getStats() {
    const weatherStats = this.weatherProvider.getCacheStats();
    return {
      weatherCacheSize: weatherStats.entries,
      weatherCacheMinutes: weatherStats.maxDurationMinutes,
      officialAlertSource: this.capAlertProvider?.getSnapshot?.() || null,
      observationLogSize: this.observeLog.length,
      lastObservation: this.observeLog[this.observeLog.length - 1] || null,
    };
  }

  clearObservationLog() {
    this.observeLog = [];
  }
}

module.exports = ContextService;
