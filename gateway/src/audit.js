/**
 * Audit logging for full request lifecycle.
 *
 * Logs every request end-to-end: identity, permission, provider, tool, response, validation.
 * Enables cost tracking, security audits, and debugging.
 */

const fs = require('fs');
const path = require('path');

class AuditLog {
  constructor(config) {
    this.config = config;
    this.logDir = path.join(__dirname, '..', 'logs');
    this.ensureLogDir();
  }

  ensureLogDir() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  /**
   * Log a complete request lifecycle.
   *
   * @param {Object} event
   * @param {string} event.requestId - Unique request ID
   * @param {string} event.phase - 'start' | 'auth' | 'intent' | 'provider' | 'validation' | 'response'
   * @param {string} event.uid - Guardian UID (if authenticated)
   * @param {string} event.fromPhone - E.164 phone
   * @param {string} event.imei - Device IMEI (if applicable)
   * @param {Object} event.data - Phase-specific data
   * @param {number} event.timestamp - Unix timestamp (ms)
   */
  async record(event) {
    const log = {
      ...event,
      timestamp: event.timestamp || Date.now(),
    };

    // Console log (development)
    console.log(`[audit] ${log.phase} | ${log.requestId} | ${log.data?.status || ''}`);

    // File log (production)
    this.writeLog(log);
  }

  writeLog(log) {
    const date = new Date(log.timestamp);
    const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
    const logFile = path.join(this.logDir, `audit-${dateStr}.jsonl`);

    const line = JSON.stringify(log) + '\n';
    fs.appendFileSync(logFile, line, 'utf8');
  }

  /**
   * Record request start.
   */
  async recordStart({ requestId, fromPhone }) {
    await this.record({
      requestId,
      phase: 'start',
      fromPhone,
      data: { status: 'request_received' },
    });
  }

  /**
   * Record authentication/context resolution.
   */
  async recordAuth({ requestId, uid, linkedImeis, status, reason, plan, subscriptionStatus }) {
    await this.record({
      requestId,
      phase: 'auth',
      uid: uid || null,
      data: {
        status,
        reason,
        linkedImeis: linkedImeis?.length || 0,
        plan: plan || null,
        subscriptionStatus: subscriptionStatus || null,
      },
    });
  }

  /**
   * Record intent classification.
   */
  async recordIntent({ requestId, intent }) {
    await this.record({
      requestId,
      phase: 'intent',
      data: {
        type: intent.type,
        urgency: intent.urgency,
        confidence: intent.confidence,
        matched: intent.matchedKeywords?.length || 0,
      },
    });
  }

  /**
   * Record permission check.
   */
  async recordPermission({ requestId, uid, imei, scope, allowed, reason }) {
    await this.record({
      requestId,
      phase: 'auth',
      uid,
      imei,
      data: { scope, allowed, reason },
    });
  }

  /**
   * Record LLM provider call.
   */
  async recordProvider({
    requestId,
    provider,
    model,
    tokensIn,
    tokensOut,
    latencyMs,
    toolNames,
    stopReason,
  }) {
    await this.record({
      requestId,
      phase: 'provider',
      data: {
        provider,
        model,
        tokensIn,
        tokensOut,
        latencyMs,
        toolNames: toolNames || [],
        stopReason,
      },
    });
  }

  /**
   * Record response validation.
   */
  async recordValidation({ requestId, valid, issues }) {
    await this.record({
      requestId,
      phase: 'validation',
      data: {
        valid,
        issueCount: issues?.length || 0,
        issues: issues || [],
      },
    });
  }

  /**
   * Record final response sent.
   */
  async recordResponse({ requestId, destination, replyLength, fallbackReason }) {
    await this.record({
      requestId,
      phase: 'response',
      data: {
        destination,
        replyLength,
        fallbackReason: fallbackReason || null,
        status: 'sent',
      },
    });
  }

  /**
   * Record an error during processing.
   */
  async recordError({ requestId, phase, error }) {
    await this.record({
      requestId,
      phase,
      data: {
        status: 'error',
        message: error?.message || String(error),
      },
    });
  }
}

module.exports = { AuditLog };
