const crypto = require('crypto');

const DEFAULT_DEDUPE_TTL_MINUTES = 24 * 60;

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function verifyMetaWebhookChallenge({
  mode,
  token,
  challenge,
  expectedVerifyToken,
} = {}) {
  if (!expectedVerifyToken) {
    return {
      ok: false,
      status: 503,
      reason: 'META_WHATSAPP_VERIFY_TOKEN missing',
    };
  }

  if (mode !== 'subscribe' || !safeEqual(token, expectedVerifyToken)) {
    return {
      ok: false,
      status: 403,
      reason: 'verification_failed',
    };
  }

  return {
    ok: true,
    status: 200,
    challenge: String(challenge || ''),
  };
}

function verifyMetaSignature(rawBody, signatureHeader, appSecret) {
  if (!appSecret || !signatureHeader) return false;

  const body = Buffer.isBuffer(rawBody)
    ? rawBody
    : Buffer.from(String(rawBody || ''), 'utf8');

  const expected =
    'sha256=' +
    crypto
      .createHmac('sha256', String(appSecret))
      .update(body)
      .digest('hex');

  return safeEqual(signatureHeader, expected);
}

function extractMessageText(message = {}) {
  const type = String(message.type || '').toLowerCase();

  if (type === 'text') {
    return String(message.text?.body || '').trim();
  }

  if (type === 'button') {
    return String(message.button?.text || '').trim();
  }

  if (type === 'interactive') {
    if (message.interactive?.type === 'button_reply') {
      return String(message.interactive?.button_reply?.title || '').trim();
    }
    if (message.interactive?.type === 'list_reply') {
      return String(message.interactive?.list_reply?.title || '').trim();
    }
  }

  return '';
}

function extractMessageButtonPayload(message = {}) {
  const type = String(message.type || '').toLowerCase();
  if (type === 'button') {
    return String(message.button?.payload || '').trim() || null;
  }
  if (type === 'interactive' && message.interactive?.type === 'button_reply') {
    return String(message.interactive?.button_reply?.id || '').trim() || null;
  }
  return null;
}

function extractMetaInboundMessages(payload, expectedPhoneNumberId = '') {
  if (!payload || payload.object !== 'whatsapp_business_account') {
    return [];
  }

  const expected = String(expectedPhoneNumberId || '').trim();
  const results = [];

  for (const entry of Array.isArray(payload.entry) ? payload.entry : []) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      if (change?.field !== 'messages') continue;

      const value = change.value || {};
      const phoneNumberId = String(
        value.metadata?.phone_number_id || ''
      ).trim();

      if (expected && phoneNumberId !== expected) {
        continue;
      }

      for (const message of Array.isArray(value.messages)
        ? value.messages
        : []) {
        const id = String(message?.id || '').trim();
        const from = String(message?.from || '').trim();
        if (!id || !from) continue;

        results.push({
          id,
          from,
          timestamp: message.timestamp || null,
          type: message.type || null,
          text: extractMessageText(message),
          buttonPayload: extractMessageButtonPayload(message),
          phoneNumberId,
        });
      }
    }
  }

  return results;
}

const META_DELIVERY_STATUSES = new Set([
  'sent',
  'delivered',
  'read',
  'failed',
  'deleted',
]);

function normalizeMetaError(error = {}) {
  return {
    code: error.code ?? null,
    title: error.title || null,
    message: error.message || null,
    details: error.error_data?.details || null,
  };
}

function extractMetaDeliveryStatuses(payload, expectedPhoneNumberId = '') {
  if (!payload || payload.object !== 'whatsapp_business_account') {
    return [];
  }

  const expected = String(expectedPhoneNumberId || '').trim();
  const results = [];

  for (const entry of Array.isArray(payload.entry) ? payload.entry : []) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      if (change?.field !== 'messages') continue;

      const value = change.value || {};
      const phoneNumberId = String(value.metadata?.phone_number_id || '').trim();
      if (expected && phoneNumberId !== expected) continue;

      for (const item of Array.isArray(value.statuses) ? value.statuses : []) {
        const messageId = String(item?.id || '').trim();
        const status = String(item?.status || '').trim().toLowerCase();
        if (!messageId || !META_DELIVERY_STATUSES.has(status)) continue;

        const timestamp = String(item.timestamp || '').trim();
        const unixSeconds = Number(timestamp);
        const occurredAt = timestamp && Number.isFinite(unixSeconds) && unixSeconds > 0
          ? new Date(unixSeconds * 1000)
          : new Date();

        results.push({
          messageId,
          status,
          recipientId: String(item.recipient_id || '').trim() || null,
          phoneNumberId,
          occurredAt,
          errors: (Array.isArray(item.errors) ? item.errors : [])
            .map(normalizeMetaError),
          conversationId: item.conversation?.id || null,
          conversationCategory:
            item.conversation?.origin?.type || item.pricing?.category || null,
          billable: item.pricing?.billable ?? null,
        });
      }
    }
  }

  return results;
}

class MetaMessageDeduper {
  constructor(ttlMinutes = DEFAULT_DEDUPE_TTL_MINUTES) {
    this.ttlMs = Math.max(1, Number(ttlMinutes) || 1) * 60 * 1000;
    this.entries = new Map();
  }

  #cleanupOne(messageId) {
    const entry = this.entries.get(messageId);
    if (!entry) return;

    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.entries.delete(messageId);
    }
  }

  claim(messageId) {
    const id = String(messageId || '').trim();
    if (!id) return false;

    this.#cleanupOne(id);
    if (this.entries.has(id)) return false;

    this.entries.set(id, {
      status: 'processing',
      timestamp: Date.now(),
    });
    return true;
  }

  markDone(messageId) {
    const id = String(messageId || '').trim();
    if (!id) return;

    this.entries.set(id, {
      status: 'done',
      timestamp: Date.now(),
    });
  }

  release(messageId) {
    this.entries.delete(String(messageId || '').trim());
  }

  status(messageId) {
    const id = String(messageId || '').trim();
    this.#cleanupOne(id);
    return this.entries.get(id)?.status || null;
  }

  cleanup() {
    for (const id of this.entries.keys()) {
      this.#cleanupOne(id);
    }
  }
}

module.exports = {
  DEFAULT_DEDUPE_TTL_MINUTES,
  safeEqual,
  verifyMetaWebhookChallenge,
  verifyMetaSignature,
  extractMessageText,
  extractMessageButtonPayload,
  extractMetaInboundMessages,
  extractMetaDeliveryStatuses,
  MetaMessageDeduper,
};
