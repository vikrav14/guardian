const config = require('./config');

function normalizeMetaRecipient(value) {
  const raw = String(value || '')
    .trim()
    .replace(/^whatsapp:/i, '');
  return raw.replace(/\D/g, '');
}

function buildMetaTextPayload(to, body, { previewUrl = true } = {}) {
  const recipient = normalizeMetaRecipient(to);
  const text = String(body || '').trim();

  if (!recipient) throw new Error('WhatsApp recipient is required.');
  if (!text) throw new Error('WhatsApp message body is required.');

  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: recipient,
    type: 'text',
    text: {
      preview_url: Boolean(previewUrl),
      body: text,
    },
  };
}

function buildMetaTemplatePayload(
  to,
  templateName,
  {
    languageCode = 'en_US',
    components = undefined,
  } = {}
) {
  const recipient = normalizeMetaRecipient(to);
  const name = String(templateName || '').trim();

  if (!recipient) throw new Error('WhatsApp recipient is required.');
  if (!name) throw new Error('WhatsApp template name is required.');

  const template = {
    name,
    language: {
      code: String(languageCode || 'en_US').trim() || 'en_US',
    },
  };

  if (Array.isArray(components) && components.length > 0) {
    template.components = components;
  }

  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: recipient,
    type: 'template',
    template,
  };
}

function metaMessagesUrl() {
  const phoneNumberId = String(config.metaWhatsAppPhoneNumberId || '').trim();
  const graphVersion = String(config.metaGraphVersion || 'v25.0').trim();

  if (!phoneNumberId) {
    throw new Error('META_WHATSAPP_PHONE_NUMBER_ID is missing.');
  }

  return `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`;
}

async function sendMetaPayload(payload, { fetchImpl = global.fetch } = {}) {
  const token = String(config.metaWhatsAppAccessToken || '').trim();

  if (!token) {
    return {
      ok: false,
      skipped: true,
      provider: 'meta',
      reason: 'META_WHATSAPP_ACCESS_TOKEN missing',
    };
  }

  if (typeof fetchImpl !== 'function') {
    return {
      ok: false,
      provider: 'meta',
      reason: 'fetch_unavailable',
    };
  }

  let url;
  try {
    url = metaMessagesUrl();
  } catch (err) {
    return {
      ok: false,
      skipped: true,
      provider: 'meta',
      reason: err.message,
    };
  }

  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return {
      ok: false,
      provider: 'meta',
      reason: 'network_error',
      error: err.message,
    };
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    return {
      ok: false,
      provider: 'meta',
      status: response.status,
      error: data?.error?.message || `Meta WhatsApp HTTP ${response.status}`,
      errorCode: data?.error?.code ?? null,
      errorSubcode: data?.error?.error_subcode ?? null,
    };
  }

  return {
    ok: true,
    provider: 'meta',
    status: response.status,
    messageId: data?.messages?.[0]?.id || null,
    waId: data?.contacts?.[0]?.wa_id || null,
  };
}

async function sendMetaText(to, body, options = {}) {
  const payload = buildMetaTextPayload(to, body, options);
  return sendMetaPayload(payload, options);
}

async function sendMetaTemplate(to, templateName, options = {}) {
  const payload = buildMetaTemplatePayload(to, templateName, options);
  return sendMetaPayload(payload, options);
}

module.exports = {
  normalizeMetaRecipient,
  buildMetaTextPayload,
  buildMetaTemplatePayload,
  metaMessagesUrl,
  sendMetaPayload,
  sendMetaText,
  sendMetaTemplate,
};
