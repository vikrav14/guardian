'use strict';

const { buildFallTemplatePlan } = require('./guardian-fall-plan');
const { sendMetaTemplate } = require('./whatsapp-meta');

const config = require('./config');
const FALL_TEMPLATE_LANGUAGE = 'en';
function fallCallbackTemplatesEnabledForDevice(device = {}, pilot = config) {
  const digits = value => String(value || '').replace(/\D/g, '');
  return Boolean(pilot.metaWhatsAppFallCallbackPilotImei && pilot.metaWhatsAppFallCallbackPilotNumber &&
    device.imei === pilot.metaWhatsAppFallCallbackPilotImei &&
    digits(device.simNumber) === digits(pilot.metaWhatsAppFallCallbackPilotNumber));
}


async function prepareFallWhatsApp({
  device = {},
  alert = {},
  now = new Date(),
  callbackTemplatesEnabled = fallCallbackTemplatesEnabledForDevice(device),
} = {}) {
  return {
    plan: buildFallTemplatePlan({ device, alert, now, callbackTemplatesEnabled }),
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
  fallCallbackTemplatesEnabledForDevice,
  prepareFallWhatsApp,
  sendPreparedFallWhatsApp,
};
