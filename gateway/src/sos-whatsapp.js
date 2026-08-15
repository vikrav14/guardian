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

function getSafetyNarrationProvider() {
  // Critical alerts stay deterministic. Conversational AI is useful for
  // questions, but it must never be a dependency for an SOS notification.
  return null;
}

function resetSafetyNarrationProviderForTests() {
  // Retained as a compatibility no-op for existing tests/callers.
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

  return {
    ...(metaResult || { ok: false }),
    transport: 'meta',
    templateName: prepared.plan.templateName,
    locationState: prepared.plan.locationState,
    narrationSource: prepared.plan.narrationSource,
    fallbackUsed: false,
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
