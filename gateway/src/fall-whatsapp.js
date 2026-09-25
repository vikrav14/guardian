'use strict';

const { buildFallTemplatePlan } = require('./guardian-fall-plan');
const { sendMetaTemplate } = require('./whatsapp-meta');

const { photoTemplatePlan } = require('./incident-photo-templates');
const { asBool } = require('./safety-snapshot-runtime');
const { callbackTemplatesEnabledForDevice } = require('./sos-whatsapp');

const FALL_TEMPLATE_LANGUAGE = 'en';

async function prepareFallWhatsApp({
  device = {},
  alert = {},
  now = new Date(),
  alertId = null,
} = {}) {
  return {
    plan: photoTemplatePlan(buildFallTemplatePlan({ device, alert, now }), { type: 'fall', alertId,
      approved: asBool(process.env.INCIDENT_PHOTO_TEMPLATES_APPROVED),
      appUrl: process.env.INCIDENT_PHOTOS_APP_URL, callback: callbackTemplatesEnabledForDevice(device) }),
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
