const test = require('node:test');
const assert = require('node:assert/strict');

const config = require('../src/config');
const {
  normalizeMetaRecipient,
  buildMetaTextPayload,
  buildMetaAudioPayload,
  buildMetaTemplatePayload,
  buildGuardianSafetyTemplateComponents,
  buildSosVoiceReadyTemplateComponents,
  sendMetaPayload,
  uploadMetaMedia,
} = require('../src/whatsapp-meta');

test('normalizeMetaRecipient removes WhatsApp prefix, plus and punctuation', () => {
  assert.equal(normalizeMetaRecipient('whatsapp:+1 (555) 000-0001'), '15550000001');
});

test('buildMetaTextPayload creates a single text message with URL preview', () => {
  const payload = buildMetaTextPayload('+15550000001', 'Guardian test https://example.com');
  assert.equal(payload.messaging_product, 'whatsapp');
  assert.equal(payload.to, '15550000001');
  assert.equal(payload.type, 'text');
  assert.equal(payload.text.preview_url, true);
  assert.match(payload.text.body, /Guardian test/);
});

test('buildMetaAudioPayload references private Meta media by id', () => {
  const payload = buildMetaAudioPayload('+15550000001', 'media-123');
  assert.equal(payload.to, '15550000001');
  assert.equal(payload.type, 'audio');
  assert.deepEqual(payload.audio, { id: 'media-123' });
  assert.equal(JSON.stringify(payload).includes('http'), false);
});

test('buildMetaTemplatePayload builds a template message', () => {
  const payload = buildMetaTemplatePayload(
    '+15550000001',
    'guardian_sos_v1',
    {
      languageCode: 'en_US',
      components: [
        {
          type: 'body',
          parameters: [{ type: 'text', text: 'Alex' }],
        },
      ],
    }
  );

  assert.equal(payload.to, '15550000001');
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
  config.metaWhatsAppPhoneNumberId = 'phone-number-id-test';
  config.metaGraphVersion = 'v25.0';

  let captured = null;
  const fakeFetch = async (url, options) => {
    captured = { url, options };
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          contacts: [{ wa_id: '15550000001' }],
          messages: [{ id: 'wamid.TEST123' }],
        };
      },
    };
  };

  try {
    const result = await sendMetaPayload(
      buildMetaTemplatePayload('+15550000001', 'hello_world'),
      { fetchImpl: fakeFetch }
    );

    assert.equal(result.ok, true);
    assert.equal(result.accepted, true);
    assert.equal(result.provider, 'meta');
    assert.equal(result.messageId, 'wamid.TEST123');
    assert.equal(result.deliveryStatus, 'accepted');
    assert(result.acceptedAt instanceof Date);
    assert.match(captured.url, /graph\.facebook\.com\/v25\.0\/phone-number-id-test\/messages$/);
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
      buildMetaTemplatePayload('+15550000001', 'hello_world'),
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

test('Guardian SOS components match Meta body + dynamic URL button contract', () => {
  const components = buildGuardianSafetyTemplateComponents({
    bodyParameters: [
      'Alex triggered an SOS. Please check on Alex now.',
      '14:32',
      'Sample location, Mauritius Â· Satellite GPS Â· updated 2 mins ago',
      'Watch online Â· battery 63%',
    ],
    buttonUrlParameter: '-20.1609,57.5012',
  });
  assert.equal(components[0].type, 'body');
  assert.equal(components[0].parameters.length, 4);
  assert.equal(components[1].type, 'button');
  assert.equal(components[1].sub_type, 'url');
  assert.equal(components[1].index, '0');
  assert.equal(components[1].parameters[0].text, '-20.1609,57.5012');
});

test('Guardian SOS location template rejects missing button value', () => {
  assert.throws(() => buildGuardianSafetyTemplateComponents({
    bodyParameters: ['one','two','three','four'],
    buttonUrlParameter: null,
  }), /dynamic View location button parameter/);
});

test('SOS voice-ready template carries an opaque quick-reply payload', () => {
  const components = buildSosVoiceReadyTemplateComponents({
    wearerName: 'Alex',
    eventTime: '14:32',
    buttonPayload: 'guardian_sos_voice:abcdefghijklmnopqrstuvwxyz123456',
  });
  assert.deepEqual(components[0].parameters.map((item) => item.text), ['Alex', '14:32']);
  assert.equal(components[1].sub_type, 'quick_reply');
  assert.equal(components[1].parameters[0].type, 'payload');
  assert.match(components[1].parameters[0].payload, /^guardian_sos_voice:/);
});

test('uploadMetaMedia sends AMR as multipart and returns only the media id', async () => {
  const previousToken = config.metaWhatsAppAccessToken;
  const previousPhone = config.metaWhatsAppPhoneNumberId;
  config.metaWhatsAppAccessToken = 'secret-token';
  config.metaWhatsAppPhoneNumberId = 'phone-number-id-test';
  let captured;
  try {
    const result = await uploadMetaMedia(Buffer.from('#!AMR\n', 'ascii'), {
      fetchImpl: async (url, options) => {
        captured = { url, options };
        return { ok: true, status: 200, async json() { return { id: 'media-123' }; } };
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.mediaId, 'media-123');
    assert.match(captured.url, /phone-number-id-test\/media$/);
    assert.equal(captured.options.method, 'POST');
    assert.equal(captured.options.headers.Authorization, 'Bearer secret-token');
    assert.equal(captured.options.headers['Content-Type'], undefined);
    assert.equal(captured.options.body.get('messaging_product'), 'whatsapp');
    assert.equal(captured.options.body.get('type'), 'audio/amr');
    assert.equal(captured.options.body.get('file').type, 'audio/amr');
    assert.doesNotMatch(JSON.stringify(result), /secret-token/);
  } finally {
    config.metaWhatsAppAccessToken = previousToken;
    config.metaWhatsAppPhoneNumberId = previousPhone;
  }
});
