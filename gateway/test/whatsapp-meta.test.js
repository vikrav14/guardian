const test = require('node:test');
const assert = require('node:assert/strict');

const config = require('../src/config');
const {
  normalizeMetaRecipient,
  buildMetaTextPayload,
  buildMetaTemplatePayload,
  sendMetaPayload,
} = require('../src/whatsapp-meta');

test('normalizeMetaRecipient removes WhatsApp prefix, plus and punctuation', () => {
  assert.equal(normalizeMetaRecipient('whatsapp:+230 5859-0100'), '23058590100');
});

test('buildMetaTextPayload creates a single text message with URL preview', () => {
  const payload = buildMetaTextPayload('+23058590100', 'Guardian test https://example.com');
  assert.equal(payload.messaging_product, 'whatsapp');
  assert.equal(payload.to, '23058590100');
  assert.equal(payload.type, 'text');
  assert.equal(payload.text.preview_url, true);
  assert.match(payload.text.body, /Guardian test/);
});

test('buildMetaTemplatePayload builds a template message', () => {
  const payload = buildMetaTemplatePayload(
    '+23058590100',
    'guardian_sos_v1',
    {
      languageCode: 'en_US',
      components: [
        {
          type: 'body',
          parameters: [{ type: 'text', text: 'Jesh' }],
        },
      ],
    }
  );

  assert.equal(payload.to, '23058590100');
  assert.equal(payload.type, 'template');
  assert.equal(payload.template.name, 'guardian_sos_v1');
  assert.equal(payload.template.language.code, 'en_US');
  assert.equal(payload.template.components.length, 1);
});

test('sendMetaPayload returns Meta wamid without exposing token', async () => {
  const previousToken = config.metaWhatsAppAccessToken;
  const previousPhone = config.metaWhatsAppPhoneNumberId;
  const previousVersion = config.metaGraphVersion;

  config.metaWhatsAppAccessToken = 'test-secret-token';
  config.metaWhatsAppPhoneNumberId = '1172425059296685';
  config.metaGraphVersion = 'v25.0';

  let captured = null;
  const fakeFetch = async (url, options) => {
    captured = { url, options };
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          contacts: [{ wa_id: '23058590100' }],
          messages: [{ id: 'wamid.TEST123' }],
        };
      },
    };
  };

  try {
    const result = await sendMetaPayload(
      buildMetaTemplatePayload('+23058590100', 'hello_world'),
      { fetchImpl: fakeFetch }
    );

    assert.equal(result.ok, true);
    assert.equal(result.provider, 'meta');
    assert.equal(result.messageId, 'wamid.TEST123');
    assert.match(captured.url, /graph\.facebook\.com\/v25\.0\/1172425059296685\/messages$/);
    assert.equal(
      captured.options.headers.Authorization,
      'Bearer test-secret-token'
    );
    assert.doesNotMatch(JSON.stringify(result), /test-secret-token/);
  } finally {
    config.metaWhatsAppAccessToken = previousToken;
    config.metaWhatsAppPhoneNumberId = previousPhone;
    config.metaGraphVersion = previousVersion;
  }
});

test('sendMetaPayload safely skips when access token is missing', async () => {
  const previousToken = config.metaWhatsAppAccessToken;
  config.metaWhatsAppAccessToken = '';

  try {
    const result = await sendMetaPayload(
      buildMetaTemplatePayload('+23058590100', 'hello_world'),
      {
        fetchImpl: async () => {
          throw new Error('fetch should not be called');
        },
      }
    );

    assert.equal(result.ok, false);
    assert.equal(result.skipped, true);
    assert.equal(result.provider, 'meta');
    assert.match(result.reason, /ACCESS_TOKEN/);
  } finally {
    config.metaWhatsAppAccessToken = previousToken;
  }
});
