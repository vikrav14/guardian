'use strict';

const { buildFallTemplatePlan } = require('./guardian-fall-plan');
const { sendMetaTemplate } = require('./whatsapp-meta');

const FALL_TEMPLATE_LANGUAGE = 'en';

async function prepareFallWhatsApp({
  device = {},
  alert = {},
  now = new Date(),
} = {}) {
  return {
    plan: buildFallTemplatePlan({ device, alert, now }),
  };
}

async function sendPreparedFallWhatsApp(
  to,
  prepared,
  { sendTemplate = sendMetaTemplate } = {}
) {
  if (!prepared?.plan) {
    throw new Error('Prepared Guardian fall plan is required.');
  }

  const metaResult = await sendTemplate(
    to,
    prepared.plan.templateName,
    {
      languageCode: FALL_TEMPLATE_LANGUAGE,
      components: prepared.plan.components,
    }
  );

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
  FALL_TEMPLATE_LANGUAGE,
  prepareFallWhatsApp,
  sendPreparedFallWhatsApp,
};
