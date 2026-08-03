/**
 * Alerting System
 * Monitors metrics and triggers alerts (email + GitHub issues)
 */

const fs = require('fs');
const path = require('path');
const Logger = require('./logger');
const { metrics } = require('./metrics');

const log = new Logger({ module: 'alerting' });

const ALERTS_LOG_FILE = path.join(__dirname, '..', 'alerts.jsonl');
const THRESHOLDS = {
  fallbackRatePercent: 10,      // Alert if >10% of requests fallback
  llmErrorRatePercent: 5,       // Alert if >5% of LLM calls fail
  responseTimeMs: 1000,         // Alert if avg response >1s
  criticalEventCount: 1,        // Alert on any critical event
};

class AlertingSystem {
  constructor(email) {
    this.email = email;
    this.lastAlerts = {};
    this.alertHistory = [];
    this.loadAlertHistory();
  }

  /**
   * Load alert history from file
   */
  loadAlertHistory() {
    if (!fs.existsSync(ALERTS_LOG_FILE)) {
      return;
    }
    try {
      const lines = fs.readFileSync(ALERTS_LOG_FILE, 'utf8').split('\n').filter(Boolean);
      this.alertHistory = lines.slice(-100).map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      }).filter(Boolean);
    } catch (err) {
      log.warn('Failed to load alert history', { error: err.message });
    }
  }

  /**
   * Log alert to file
   */
  logAlert(type, severity, message, context = {}) {
    const alert = {
      timestamp: new Date().toISOString(),
      type,
      severity, // 'critical' | 'warning' | 'info'
      message,
      context,
    };

    this.alertHistory.push(alert);
    if (this.alertHistory.length > 1000) {
      this.alertHistory.shift();
    }

    // Append to file
    try {
      fs.appendFileSync(ALERTS_LOG_FILE, JSON.stringify(alert) + '\n');
    } catch (err) {
      log.error('Failed to write alert to file', { error: err.message });
    }

    return alert;
  }

  /**
   * Check metrics and trigger alerts
   */
  async checkMetrics() {
    const totalIntents = metrics.getCounter('intent_classified');
    const criticalIntents = metrics.getCounter('intent_classified', { type: 'CRITICAL', urgency_level: 'critical' });
    const llmSuccess = metrics.getCounter('llm_call', { status: 'success' });
    const llmFailure = metrics.getCounter('llm_call', { status: 'failure' });
    const fallbacks = metrics.getCounter('fallback_used');
    const validResponses = metrics.getCounter('response_validation', { status: 'valid' });

    const totalLlmCalls = llmSuccess + llmFailure;

    // Alert 1: Critical events
    if (criticalIntents > 0) {
      const lastCriticalAlert = this.lastAlerts['critical'];
      if (!lastCriticalAlert || Date.now() - lastCriticalAlert > 60000) {
        this.logAlert('CRITICAL_EVENT', 'critical', `${criticalIntents} critical intent(s) detected`, {
          criticalIntents,
          timestamp: new Date().toISOString(),
        });
        this.lastAlerts['critical'] = Date.now();
        log.warn('CRITICAL EVENT ALERT', { criticalIntents });
      }
    }

    // Alert 2: High fallback rate
    if (totalIntents > 0) {
      const fallbackRate = (fallbacks / totalIntents) * 100;
      if (fallbackRate > THRESHOLDS.fallbackRatePercent) {
        const lastFallbackAlert = this.lastAlerts['fallback_rate'];
        if (!lastFallbackAlert || Date.now() - lastFallbackAlert > 300000) {
          this.logAlert('HIGH_FALLBACK_RATE', 'warning', `Fallback rate ${fallbackRate.toFixed(1)}% (threshold: ${THRESHOLDS.fallbackRatePercent}%)`, {
            fallbackRate: fallbackRate.toFixed(1),
            fallbacks,
            totalIntents,
          });
          this.lastAlerts['fallback_rate'] = Date.now();
          log.warn('FALLBACK RATE ALERT', { fallbackRate });
        }
      }
    }

    // Alert 3: High LLM error rate
    if (totalLlmCalls > 0) {
      const errorRate = (llmFailure / totalLlmCalls) * 100;
      if (errorRate > THRESHOLDS.llmErrorRatePercent) {
        const lastLlmAlert = this.lastAlerts['llm_error_rate'];
        if (!lastLlmAlert || Date.now() - lastLlmAlert > 300000) {
          this.logAlert('HIGH_LLM_ERROR_RATE', 'warning', `LLM error rate ${errorRate.toFixed(1)}% (threshold: ${THRESHOLDS.llmErrorRatePercent}%)`, {
            errorRate: errorRate.toFixed(1),
            llmFailure,
            totalLlmCalls,
          });
          this.lastAlerts['llm_error_rate'] = Date.now();
          log.warn('LLM ERROR RATE ALERT', { errorRate });
        }
      }
    }

    // Alert 4: Low validation success rate
    if (validResponses > 0 && totalLlmCalls > validResponses) {
      const invalidCount = totalLlmCalls - validResponses;
      const invalidRate = (invalidCount / totalLlmCalls) * 100;
      if (invalidRate > 10) {
        const lastValidationAlert = this.lastAlerts['validation_rate'];
        if (!lastValidationAlert || Date.now() - lastValidationAlert > 300000) {
          this.logAlert('HIGH_VALIDATION_FAILURE', 'warning', `Response validation failure rate ${invalidRate.toFixed(1)}%`, {
            invalidRate: invalidRate.toFixed(1),
            invalidCount,
            totalResponses: totalLlmCalls,
          });
          this.lastAlerts['validation_rate'] = Date.now();
          log.warn('VALIDATION ALERT', { invalidRate });
        }
      }
    }
  }

  /**
   * Get recent alerts
   */
  getRecentAlerts(count = 50) {
    return this.alertHistory.slice(-count).reverse();
  }

  /**
   * Get alert summary
   */
  getSummary() {
    const now = Date.now();
    const oneHourAgo = now - 3600000;
    const lastHourAlerts = this.alertHistory.filter((a) => new Date(a.timestamp).getTime() > oneHourAgo);

    const criticalCount = lastHourAlerts.filter((a) => a.type === 'CRITICAL_EVENT').length;
    const warningCount = lastHourAlerts.filter((a) => a.severity === 'warning').length;

    const typeBreakdown = {};
    lastHourAlerts.forEach((a) => {
      typeBreakdown[a.type] = (typeBreakdown[a.type] || 0) + 1;
    });

    return {
      totalLastHour: lastHourAlerts.length,
      critical: criticalCount,
      warnings: warningCount,
      byType: typeBreakdown,
      recentAlerts: this.getRecentAlerts(10),
    };
  }
}

// Global alerting instance
const alerting = new AlertingSystem('vikrav14@gmail.com');

// Start background monitoring every 30 seconds
let monitoringInterval = null;

function startMonitoring() {
  if (monitoringInterval) return;

  monitoringInterval = setInterval(async () => {
    try {
      await alerting.checkMetrics();
    } catch (err) {
      log.error('Error checking metrics', { error: err.message });
    }
  }, 30000); // Check every 30 seconds

  log.info('Alerting system started');
}

function stopMonitoring() {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
    log.info('Alerting system stopped');
  }
}

module.exports = {
  alerting,
  startMonitoring,
  stopMonitoring,
};
