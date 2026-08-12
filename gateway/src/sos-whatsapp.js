const config = require('./config');
const {
  GeminiProvider,
  AnthropicProvider,
} = require('./providers');
const {
  composeSafetyNarration,
} = require('./guardian-message-composer');
const {
  buildSosTemplatePlan,
} = require('./guardian-sos-plan');
const {
  sendMetaTemplate,
} = require('./whatsapp-meta');

const SOS_TEMPLATE_LANGUAGE = 'en';

let cachedNarrationProvider;

function getSafetyNarrationProvider() {
  if (cachedNarrationProvider !== undefined) {
    return cachedNarrationProvider;
  }

  try {
    if (config.geminiApiKey) {
      cachedNarrationProvider = new GeminiProvider(config);
      return cachedNarrationProvider;
    }

    if (config.anthropicApiKey) {
      cachedNarrationProvider = new AnthropicProvider(config);
      return cachedNarrationProvider;
    }
  } catch (err) {
    console.warn('[sos-whatsapp] narration provider init failed:', err.message);
  }

  cachedNarrationProvider = null;
  return cachedNarrationProvider;
}

function resetSafetyNarrationProviderForTests() {
  cachedNarrationProvider = undefined;
}

async function prepareSosWhatsApp({
  device = {},
  alert = {},
  now = new Date(),
  provider = undefined,
} = {}) {
  const narrationProvider =
    provider === undefined ? getSafetyNarrationProvider() : provider;

  const composeResult = await composeSafetyNarration({
    type: 'sos',
    device,
    alert,
    now,
    provider: narrationProvider,
  });

  const plan = buildSosTemplatePlan({
    device,
    alert,
    composeResult,
    now,
  });

  return {
    composeResult,
    plan,
  };
}

function renderSosFallbackText(prepared) {
  const plan = prepared?.plan;
  if (!plan) {
    return '🚨 GUARDIAN SOS ALERT\n\nGuardian received an SOS alert. Please check on the wearer now.';
  }

  const [narration, eventTime, locationValue, watchValue] =
    plan.bodyParameters || [];

  const lines = [
    '🚨 GUARDIAN SOS ALERT',
    '',
    narration || 'Guardian received an SOS alert. Please check on the wearer now.',
    '',
    `Event time: ${eventTime || 'Time unavailable'}`,
    `📍 ${locationValue || 'Current location unavailable'}`,
    watchValue || 'Watch status unavailable',
  ];

  const mapUrl = prepared?.composeResult?.context?.mapsUrl || null;
  if (mapUrl && plan.locationState !== 'unavailable') {
    lines.push(
      '',
      plan.locationState === 'last_known'
        ? 'View last known location:'
        : 'View location:',
      mapUrl
    );
  }

  return lines.join('\n');
}

async function sendPreparedSosWhatsApp(
  to,
  prepared,
  {
    sendTemplate = sendMetaTemplate,
    fallbackSend = null,
  } = {}
) {
  if (!prepared?.plan) {
    throw new Error('Prepared Guardian SOS plan is required.');
  }

  const metaResult = await sendTemplate(
    to,
    prepared.plan.templateName,
    {
      languageCode: SOS_TEMPLATE_LANGUAGE,
      components: prepared.plan.components,
    }
  );

  if (metaResult?.ok) {
    return {
      ...metaResult,
      transport: 'meta',
      templateName: prepared.plan.templateName,
      locationState: prepared.plan.locationState,
      narrationSource: prepared.plan.narrationSource,
      fallbackUsed: false,
    };
  }

  if (typeof fallbackSend !== 'function') {
    return {
      ...(metaResult || { ok: false }),
      transport: 'meta',
      templateName: prepared.plan.templateName,
      locationState: prepared.plan.locationState,
      narrationSource: prepared.plan.narrationSource,
      fallbackUsed: false,
    };
  }

  const fallbackText = renderSosFallbackText(prepared);
  const fallbackResult = await fallbackSend(to, fallbackText);

  return {
    ok: fallbackResult?.ok === true,
    transport: fallbackResult?.ok ? 'twilio-fallback' : 'failed',
    templateName: prepared.plan.templateName,
    locationState: prepared.plan.locationState,
    narrationSource: prepared.plan.narrationSource,
    fallbackUsed: true,
    meta: metaResult,
    fallback: fallbackResult,
  };
}

module.exports = {
  SOS_TEMPLATE_LANGUAGE,
  getSafetyNarrationProvider,
  resetSafetyNarrationProviderForTests,
  prepareSosWhatsApp,
  renderSosFallbackText,
  sendPreparedSosWhatsApp,
};
