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

function buildMetaAudioPayload(to, mediaId) {
  const recipient = normalizeMetaRecipient(to);
  const id = String(mediaId || '').trim();
  if (!recipient) throw new Error('WhatsApp recipient is required.');
  if (!id) throw new Error('Meta media id is required.');

  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: recipient,
    type: 'audio',
    audio: { id },
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

function buildGuardianSafetyTemplateComponents({
  bodyParameters,
  buttonUrlParameter,
  buttonIndex = 0,
} = {}) {
  if (!Array.isArray(bodyParameters) || bodyParameters.length !== 4) {
    throw new Error('Guardian safety template requires exactly 4 body parameters.');
  }
  const buttonValue = String(buttonUrlParameter || '').trim();
  if (!buttonValue) {
    throw new Error('Guardian location template requires a dynamic View location button parameter.');
  }
  return [
    {
      type: 'body',
      parameters: bodyParameters.map((value) => ({ type: 'text', text: String(value ?? '') })),
    },
    {
      type: 'button',
      sub_type: 'url',
      index: String(buttonIndex),
      parameters: [{ type: 'text', text: buttonValue }],
    },
  ];
}

function buildSosVoiceReadyTemplateComponents({
  wearerName,
  eventTime,
  buttonPayload,
} = {}) {
  const name = String(wearerName || '').trim();
  const time = String(eventTime || '').trim();
  const payload = String(buttonPayload || '').trim();
  if (!name || !time) {
    throw new Error('SOS voice-ready template requires wearer name and event time.');
  }
  if (!payload) {
    throw new Error('SOS voice-ready template requires a recipient-bound button payload.');
  }

  return [
    {
      type: 'body',
      parameters: [name, time].map((text) => ({ type: 'text', text })),
    },
    {
      type: 'button',
      sub_type: 'quick_reply',
      index: '0',
      parameters: [{ type: 'payload', payload }],
    },
  ];
}

function metaMessagesUrl() {
  const phoneNumberId = String(config.metaWhatsAppPhoneNumberId || '').trim();
  const graphVersion = String(config.metaGraphVersion || 'v25.0').trim();

  if (!phoneNumberId) {
    throw new Error('META_WHATSAPP_PHONE_NUMBER_ID is missing.');
  }

  return `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`;
}

function metaMediaUrl(mediaId = '') {
  const graphVersion = String(config.metaGraphVersion || 'v25.0').trim();
  const id = String(mediaId || '').trim();
  if (id) return `https://graph.facebook.com/${graphVersion}/${id}`;

  const phoneNumberId = String(config.metaWhatsAppPhoneNumberId || '').trim();
  if (!phoneNumberId) {
    throw new Error('META_WHATSAPP_PHONE_NUMBER_ID is missing.');
  }
  return `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/media`;
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
    accepted: true,
    provider: 'meta',
    status: response.status,
    messageId: data?.messages?.[0]?.id || null,
    waId: data?.contacts?.[0]?.wa_id || null,
    deliveryStatus: 'accepted',
    acceptedAt: new Date(),
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

async function uploadMetaMedia(
  content,
  {
    contentType = 'audio/amr',
    filename = 'guardian-sos-voice.amr',
    fetchImpl = global.fetch,
  } = {}
) {
  const token = String(config.metaWhatsAppAccessToken || '').trim();
  if (!token) {
    return {
      ok: false,
      skipped: true,
      provider: 'meta',
      reason: 'META_WHATSAPP_ACCESS_TOKEN missing',
    };
  }
  if (
    typeof fetchImpl !== 'function'
    || typeof global.FormData !== 'function'
    || typeof global.Blob !== 'function'
  ) {
    return { ok: false, provider: 'meta', reason: 'multipart_upload_unavailable' };
  }

  let url;
  try {
    url = metaMediaUrl();
  } catch (err) {
    return { ok: false, skipped: true, provider: 'meta', reason: err.message };
  }

  const body = new FormData();
  body.append('messaging_product', 'whatsapp');
  body.append('type', String(contentType));
  body.append(
    'file',
    new Blob([Buffer.isBuffer(content) ? content : Buffer.from(content || [])], {
      type: String(contentType),
    }),
    String(filename)
  );

  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body,
    });
  } catch (err) {
    return { ok: false, provider: 'meta', reason: 'network_error', error: err.message };
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok || !data?.id) {
    return {
      ok: false,
      provider: 'meta',
      status: response.status,
      error: data?.error?.message || `Meta media upload HTTP ${response.status}`,
    };
  }
  return { ok: true, provider: 'meta', status: response.status, mediaId: data.id };
}

async function sendMetaAudio(to, mediaId, options = {}) {
  return sendMetaPayload(buildMetaAudioPayload(to, mediaId), options);
}

async function deleteMetaMedia(mediaId, { fetchImpl = global.fetch } = {}) {
  const token = String(config.metaWhatsAppAccessToken || '').trim();
  const id = String(mediaId || '').trim();
  if (!id) return { ok: false, skipped: true, reason: 'media_id_missing' };
  if (!token) return { ok: false, skipped: true, reason: 'access_token_missing' };
  if (typeof fetchImpl !== 'function') {
    return { ok: false, reason: 'fetch_unavailable' };
  }

  try {
    const response = await fetchImpl(metaMediaUrl(id), {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.ok
      ? { ok: true, status: response.status }
      : { ok: false, status: response.status };
  } catch (err) {
    return { ok: false, reason: 'network_error', error: err.message };
  }
}

module.exports = {
  normalizeMetaRecipient,
  buildMetaTextPayload,
  buildMetaAudioPayload,
  buildMetaTemplatePayload,
  buildGuardianSafetyTemplateComponents,
  buildSosVoiceReadyTemplateComponents,
  metaMessagesUrl,
  metaMediaUrl,
  sendMetaPayload,
  sendMetaText,
  sendMetaTemplate,
  uploadMetaMedia,
  sendMetaAudio,
  deleteMetaMedia,
};
