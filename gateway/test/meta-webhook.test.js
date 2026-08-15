const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const {
  verifyMetaWebhookChallenge,
  verifyMetaSignature,
  extractMessageText,
  extractMetaInboundMessages,
  extractMetaDeliveryStatuses,
  MetaMessageDeduper,
} = require('../src/meta-webhook');

test('GET verification returns challenge only for matching verify token', () => {
  const ok = verifyMetaWebhookChallenge({
    mode: 'subscribe',
    token: 'guardian-secret',
    challenge: '123456',
    expectedVerifyToken: 'guardian-secret',
  });

  assert.equal(ok.ok, true);
  assert.equal(ok.challenge, '123456');

  const bad = verifyMetaWebhookChallenge({
    mode: 'subscribe',
    token: 'wrong',
    challenge: '123456',
    expectedVerifyToken: 'guardian-secret',
  });

  assert.equal(bad.ok, false);
  assert.equal(bad.status, 403);
});

test('GET verification fails closed when server verify token is missing', () => {
  const result = verifyMetaWebhookChallenge({
    mode: 'subscribe',
    token: 'anything',
    challenge: '1',
    expectedVerifyToken: '',
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
});

test('POST signature verifies exact raw request body with app secret', () => {
  const secret = 'meta-app-secret';
  const raw = Buffer.from('{"object":"whatsapp_business_account"}', 'utf8');
  const signature =
    'sha256=' +
    crypto.createHmac('sha256', secret).update(raw).digest('hex');

  assert.equal(verifyMetaSignature(raw, signature, secret), true);
  assert.equal(
    verifyMetaSignature(raw, 'sha256=0000000000000000', secret),
    false
  );
  assert.equal(verifyMetaSignature(raw, signature, ''), false);
});

test('extracts Meta inbound text message and stable wamid', () => {
  const payload = {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '930822510061984',
        changes: [
          {
            field: 'messages',
            value: {
              metadata: {
                phone_number_id: '1172425059296685',
              },
              messages: [
                {
                  from: '23058590100',
                  id: 'wamid.TEST123',
                  timestamp: '1786570000',
                  type: 'text',
                  text: { body: 'Where is Mum?' },
                },
              ],
            },
          },
        ],
      },
    ],
  };

  const messages = extractMetaInboundMessages(
    payload,
    '1172425059296685'
  );

  assert.equal(messages.length, 1);
  assert.equal(messages[0].id, 'wamid.TEST123');
  assert.equal(messages[0].from, '23058590100');
  assert.equal(messages[0].text, 'Where is Mum?');
});

test('ignores delivery-status webhook payloads', () => {
  const payload = {
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            field: 'messages',
            value: {
              metadata: {
                phone_number_id: '1172425059296685',
              },
              statuses: [
                {
                  id: 'wamid.OUTBOUND',
                  status: 'delivered',
                },
              ],
            },
          },
        ],
      },
    ],
  };

  assert.deepEqual(
    extractMetaInboundMessages(payload, '1172425059296685'),
    []
  );

  const statuses = extractMetaDeliveryStatuses(
    payload,
    '1172425059296685'
  );
  assert.equal(statuses.length, 1);
  assert.equal(statuses[0].messageId, 'wamid.OUTBOUND');
  assert.equal(statuses[0].status, 'delivered');
});

test('extracts sanitized Meta failure details and provider timestamp', () => {
  const payload = {
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ field: 'messages', value: {
      metadata: { phone_number_id: '1172425059296685' },
      statuses: [{
        id: 'wamid.FAIL', status: 'failed', recipient_id: '23058590100',
        timestamp: '1786570000',
        errors: [{
          code: 131026, title: 'Message undeliverable',
          message: 'Message undeliverable',
          error_data: { details: 'Recipient unavailable' },
        }],
      }],
    } }] }],
  };
  const [status] = extractMetaDeliveryStatuses(payload, '1172425059296685');
  assert.equal(status.status, 'failed');
  assert.equal(status.recipientId, '23058590100');
  assert.equal(status.errors[0].code, 131026);
  assert.equal(status.errors[0].details, 'Recipient unavailable');
  assert(status.occurredAt instanceof Date);
});

test('ignores messages for a different configured phone number id', () => {
  const payload = {
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            field: 'messages',
            value: {
              metadata: {
                phone_number_id: 'OTHER',
              },
              messages: [
                {
                  from: '23058590100',
                  id: 'wamid.WRONG_PHONE',
                  type: 'text',
                  text: { body: 'Battery?' },
                },
              ],
            },
          },
        ],
      },
    ],
  };

  assert.equal(
    extractMetaInboundMessages(payload, '1172425059296685').length,
    0
  );
});

test('supports button and interactive quick-reply text', () => {
  assert.equal(
    extractMessageText({
      type: 'button',
      button: { text: 'Battery' },
    }),
    'Battery'
  );

  assert.equal(
    extractMessageText({
      type: 'interactive',
      interactive: {
        type: 'button_reply',
        button_reply: {
          id: 'battery',
          title: 'Battery',
        },
      },
    }),
    'Battery'
  );
});

test('Meta message deduper claims once and suppresses duplicate processing', () => {
  const store = new MetaMessageDeduper(60);

  assert.equal(store.claim('wamid.1'), true);
  assert.equal(store.status('wamid.1'), 'processing');
  assert.equal(store.claim('wamid.1'), false);

  store.markDone('wamid.1');
  assert.equal(store.status('wamid.1'), 'done');
  assert.equal(store.claim('wamid.1'), false);
});

test('failed outbound send can release claim so a Meta retry is processed', () => {
  const store = new MetaMessageDeduper(60);

  assert.equal(store.claim('wamid.retry'), true);
  store.release('wamid.retry');
  assert.equal(store.claim('wamid.retry'), true);
});
