/**
 * Idempotency store for webhook deduplication.
 *
 * Twilio can deliver the same webhook multiple times due to network issues.
 * This stores requestId → reply mapping and returns cached reply for duplicates.
 *
 * Entries expire after 5 minutes to prevent unbounded memory growth.
 */

class IdempotencyStore {
  constructor(ttlMinutes = 5) {
    this.cache = new Map(); // requestId → {reply, timestamp}
    this.ttlMs = ttlMinutes * 60 * 1000;
  }

  /**
   * Check if a request ID has been seen before.
   *
   * @param {string} requestId - Unique request ID
   * @returns {boolean}
   */
  isSeen(requestId) {
    const entry = this.cache.get(requestId);
    if (!entry) return false;

    // Check if expired
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(requestId);
      return false;
    }

    return true;
  }

  /**
   * Get cached reply for a request ID.
   *
   * @param {string} requestId
   * @returns {string|null}
   */
  getCachedReply(requestId) {
    const entry = this.cache.get(requestId);
    if (!entry) return null;

    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(requestId);
      return null;
    }

    return entry.reply;
  }

  /**
   * Store a request ID → reply mapping.
   *
   * @param {string} requestId
   * @param {string} reply
   */
  store(requestId, reply) {
    this.cache.set(requestId, {
      reply,
      timestamp: Date.now(),
    });
  }

  /**
   * Clear expired entries (call periodically to prevent unbounded growth).
   */
  cleanup() {
    const now = Date.now();
    for (const [id, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.ttlMs) {
        this.cache.delete(id);
      }
    }
  }

  /**
   * Get cache stats (for monitoring).
   */
  stats() {
    return {
      entries: this.cache.size,
      ttlMinutes: this.ttlMs / 60 / 1000,
    };
  }
}

module.exports = { IdempotencyStore };
