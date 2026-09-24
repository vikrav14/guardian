const test = require('node:test');
const assert = require('node:assert/strict');

const config = require('../src/config');
const {
  normalizeMetaRecipient,
  buildMetaTextPayload,
  buildMetaInteractivePayload,
  sendMetaChatReply,
  buildMetaTemplatePayload,
  buildGuardianSafetyTemplateComponents,
  sendMetaPayload,
} = require('../src/whatsapp-meta');

test('interactive payloads enforce total row, button, text and unique ID limits', () => {
  const list = count => ({ type: 'list', body: { text: 'Choose for Alex' },
    action: { button: 'Choose an option', sections: [{ title: 'Check now',
      rows: Array.from({ length: count }, (_, i) => ({ id: `row_${i}`, title: `Option ${i}` })) }] } });
  const buttons = count => ({ type: 'button', body: { text: 'Last known location' },
    action: { buttons: Array.from({ length: count }, (_, i) => ({ type: 'reply', reply: { id: `id_${i}`, title: 'Main menu' } })) } });
  assert.equal(buildMetaInteractivePayload('+15555550101', list(10)).interactive.type, 'list');
  assert.throws(() => buildMetaInteractivePayload('+15555550101', list(11)), /at most 10/);
  assert.throws(() => buildMetaInteractivePayload('+15555550101', buttons(4)), /one to three/);
  const duplicate = list(2);
  duplicate.action.sections[0].rows[1].id = 'row_0';
  assert.throws(() => buildMetaInteractivePayload('+15555550101', duplicate), /Duplicate/);
  const longBody = list(1);
  longBody.body.text = 'x'.repeat(1025);
  assert.throws(() => buildMetaInteractivePayload('+15555550101', longBody), /body/);
});

test('chat transport sends the native interactive object or unchanged text in a single request', async () => {
  const saved = { token: config.metaWhatsAppAccessToken, phone: config.metaWhatsAppPhoneNumberId };
  config.metaWhatsAppAccessToken = 'test-token';
  config.metaWhatsAppPhoneNumberId = 'test-phone';
  const sent = [];
  const fetchImpl = async (url, options) => {
    sent.push(JSON.parse(options.body));
    return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.test' }] }) };
  };
  try {
    const interactive = { type: 'button', body: { text: 'Actual response' }, action: {
      buttons: [{ type: 'reply', reply: { title: 'Main menu', id: 'gm_test' } }] } };
    await sendMetaChatReply('+15555550101', { reply: 'Actual response', interactive }, { fetchImpl });
    await sendMetaChatReply('+15555550101', { reply: 'A typed answer' }, { fetchImpl });
    assert.equal(sent.length, 2);
    assert.deepEqual(sent[0].interactive, interactive);
    assert.equal(sent[0].text, undefined);
    assert.equal(sent[1].text.body, 'A typed answer');
  } finally {
    config.metaWhatsAppAccessToken = saved.token;
    config.metaWhatsAppPhoneNumberId = saved.phone;
  }
});

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
    assert.equal(result.accepted, true);
    assert.equal(result.provider, 'meta');
    assert.equal(result.messageId, 'wamid.TEST123');
    assert.equal(result.deliveryStatus, 'accepted');
    assert(result.acceptedAt instanceof Date);
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
