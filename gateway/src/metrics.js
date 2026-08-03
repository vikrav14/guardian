/**
 * Metrics collection and export for observability.
 * Tracks intents, LLM calls, validation, and fallbacks.
 */

class Metrics {
  constructor() {
    this.counters = {};
    this.timings = {};
    this.distributions = {};
  }

  // Counter operations
  increment(name, value = 1, labels = {}) {
    const key = this._labelKey(name, labels);
    if (!this.counters[key]) {
      this.counters[key] = { value: 0, labels };
    }
    this.counters[key].value += value;
    if (name.includes('critical')) {
      console.log(`[metrics.increment] ${name} -> key="${key}", value=${this.counters[key].value}`);
    }
  }

  getCounter(name, labels = {}) {
    const key = this._labelKey(name, labels);
    return this.counters[key]?.value || 0;
  }

  // Timing statistics
  recordTiming(name, durationMs, labels = {}) {
    const key = this._labelKey(name, labels);
    if (!this.timings[key]) {
      this.timings[key] = { durations: [], labels };
    }
    this.timings[key].durations.push(durationMs);
  }

  getTimingStats(name, labels = {}) {
    const key = this._labelKey(name, labels);
    const timing = this.timings[key];
    if (!timing || timing.durations.length === 0) {
      return { count: 0, min: 0, max: 0, avg: 0, p50: 0, p95: 0 };
    }

    const sorted = [...timing.durations].sort((a, b) => a - b);
    const count = sorted.length;
    const sum = sorted.reduce((a, b) => a + b, 0);

    return {
      count,
      min: sorted[0],
      max: sorted[count - 1],
      avg: Math.round(sum / count),
      p50: sorted[Math.floor(count * 0.5)],
      p95: sorted[Math.floor(count * 0.95)],
    };
  }

  // Distribution tracking
  recordDistribution(name, value, labels = {}) {
    const key = this._labelKey(name, labels);
    if (!this.distributions[key]) {
      this.distributions[key] = { values: [], labels };
    }
    this.distributions[key].values.push(value);
  }

  // Track intent classification
  trackIntent(type, confidence, urgency) {
    this.increment('intents_processed', 1, { type });
    this.recordDistribution('intent_confidence', confidence, { type });
    this.recordDistribution('intent_urgency', urgency, { type });
  }

  // Track LLM API calls
  trackLLMCall(success, responseTimeMs, intentType) {
    this.increment('llm_calls_total', 1, { intent: intentType });
    if (success) {
      this.increment('llm_calls_successful', 1, { intent: intentType });
    } else {
      this.increment('llm_calls_failed', 1, { intent: intentType });
    }
    this.recordTiming('llm_response_time', responseTimeMs, { intent: intentType });
  }

  // Track response validation
  trackResponseValidation(valid, errors, intentType) {
    this.increment('response_validations_total', 1, { intent: intentType });
    if (valid) {
      this.increment('response_validations_passed', 1, { intent: intentType });
    } else {
      this.increment('response_validations_failed', 1, { intent: intentType });
      this.increment('validation_errors', errors.length, { intent: intentType });
    }
  }

  // Track fallback activation
  trackFallback(reason, context) {
    this.increment('fallbacks_triggered', 1, { reason });
    this.recordDistribution('fallback_context_size', Object.keys(context).length, { reason });
  }

  // Export Prometheus format
  exportPrometheus() {
    let output = '';

    // Counters
    for (const [key, data] of Object.entries(this.counters)) {
      const labelStr = this._formatLabels(data.labels);
      const metricName = key.split('|')[0];
      output += `# TYPE ${metricName} counter\n`;
      output += `${metricName}${labelStr} ${data.value}\n`;
    }

    // Timings
    for (const [key, data] of Object.entries(this.timings)) {
      if (data.durations.length === 0) continue;
      const labelStr = this._formatLabels(data.labels);
      const metricName = key.split('|')[0];
      const stats = this.getTimingStats(key.split('|')[0], data.labels);
      output += `# TYPE ${metricName}_seconds summary\n`;
      output += `${metricName}_seconds_sum${labelStr} ${stats.avg}\n`;
      output += `${metricName}_seconds_count${labelStr} ${stats.count}\n`;
    }

    return output;
  }

  // Get structured summary
  getSummary() {
    // Sum all intents_processed counters (might have labels)
    let totalIntents = 0;
    for (const [key, data] of Object.entries(this.counters)) {
      if (key.startsWith('intents_processed')) {
        totalIntents += data.value;
      }
    }

    let successfulLLM = 0;
    for (const [key, data] of Object.entries(this.counters)) {
      if (key.startsWith('llm_calls_successful')) {
        successfulLLM += data.value;
      }
    }

    let totalLLM = 0;
    for (const [key, data] of Object.entries(this.counters)) {
      if (key.startsWith('llm_calls_total')) {
        totalLLM += data.value;
      }
    }

    let passedValidation = 0;
    for (const [key, data] of Object.entries(this.counters)) {
      if (key.startsWith('response_validations_passed')) {
        passedValidation += data.value;
      }
    }

    let totalValidation = 0;
    for (const [key, data] of Object.entries(this.counters)) {
      if (key.startsWith('response_validations_total')) {
        totalValidation += data.value;
      }
    }

    let fallbacks = 0;
    for (const [key, data] of Object.entries(this.counters)) {
      if (key.startsWith('fallbacks_triggered')) {
        fallbacks += data.value;
      }
    }

    let criticalEvents = 0;
    for (const [key, data] of Object.entries(this.counters)) {
      if (key.startsWith('critical_events')) {
        criticalEvents += data.value;
      }
    }

    return {
      intents_processed: totalIntents,
      critical_events: criticalEvents,
      llm_success_rate: totalLLM > 0 ? Math.round((successfulLLM / totalLLM) * 100) : 0,
      response_validation_rate: totalValidation > 0 ? Math.round((passedValidation / totalValidation) * 100) : 0,
      fallback_count: fallbacks,
      fallback_rate: totalIntents > 0 ? Math.round((fallbacks / totalIntents) * 100) : 0,
      avg_response_time: this.getTimingStats('llm_response_time').avg,
      timing_stats: this.getTimingStats('llm_response_time'),
    };
  }

  _labelKey(name, labels = {}) {
    if (Object.keys(labels).length === 0) return name;
    const labelStr = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(',');
    return `${name}|${labelStr}`;
  }

  _formatLabels(labels = {}) {
    if (Object.keys(labels).length === 0) return '';
    const labelStr = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
    return `{${labelStr}}`;
  }

  // Reset all metrics (useful for testing)
  reset() {
    this.counters = {};
    this.timings = {};
    this.distributions = {};
  }
}

// Global instance
const metrics = new Metrics();

module.exports = metrics;
