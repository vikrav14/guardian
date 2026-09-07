const {
  readSosLocationSnapshot,
  buildSosSafetyContext,
  formatSosLocationValue,
} = require('./sos-location-snapshot');
const {
  buildDeterministicNarration,
  buildWatchTemplateValue,
} = require('./guardian-message-composer');
const {
  buildGuardianSafetyTemplateComponents,
} = require('./whatsapp-meta');
const {
  formatLocationAge,
} = require('./sos-location-policy');

const SOS_TEMPLATE_NAMES = Object.freeze({
  fresh: 'guardian_sos_alert',
  last_known: 'guardian_sos_last_location_v1',
  unavailable: 'guardian_sos_unavailable_v1',
});

// These templates add a static Meta PHONE_NUMBER button at index 0. The
// fresh/last-known variants retain the dynamic map URL at index 1.
const SOS_CALLBACK_TEMPLATE_NAMES = Object.freeze({
  fresh: 'guardian_sos_callback_alert_v1',
  last_known: 'guardian_sos_callback_last_location_v1',
  unavailable: 'guardian_sos_callback_unavailable_v1',
});

function buildCallbackNarration(ctx) {
  const name = ctx.wearerName || 'Loved one';
  return `${name} pressed SOS and is requesting help. Please call ${name}'s watch now.`;
}

function mapButtonSuffix(ctx) {
  const prefix = 'https://maps.google.com/?q=';
  const url = String(ctx?.mapsUrl || '').trim();
  if (!url.startsWith(prefix)) return null;
  return url.slice(prefix.length).trim() || null;
}

function buildFreshLocationValue(ctx) {
  if (!ctx.hasLocation) return 'Current location unavailable';

  const place = ctx.placeLabel
    ? `${ctx.approximate ? 'Approximate location near ' : ''}${ctx.placeLabel}`
    : ctx.approximate
      ? 'Approximate location available'
      : 'Location available';

  const details = [
    ctx.positioningLabel,
    ctx.locationFreshness ? `updated ${ctx.locationFreshness}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return details ? `${place} · ${details}` : place;
}

function buildLastKnownLocationValue(ctx, locationDecision) {
  const place = ctx.placeLabel
    ? `${ctx.approximate ? 'Approximate location near ' : ''}${ctx.placeLabel}`
    : ctx.approximate
      ? 'Approximate location available'
      : 'Location available';

  const age = formatLocationAge(locationDecision.ageSeconds);
  const details = [
    ctx.positioningLabel,
    `recorded ${age}`,
  ]
    .filter(Boolean)
    .join(' · ');

  return `Last known location: ${place}${details ? ` · ${details}` : ''}`;
}

function narrationPresentsStaleLocationAsCurrent(text) {
  const value = String(text || '');
  return /\b(currently|right now|now)\s+(?:is\s+)?(?:at|near|in)\b/i.test(value)
    || /\bcurrent location\b/i.test(value)
    || /\bis\s+(?:at|near|in)\s+[A-Z]/.test(value);
}

function narrationClaimsLocationWhenUnavailable(text) {
  const value = String(text || '');
  return /\b(currently|right now|now)\s+(?:is\s+)?(?:at|near|in)\b/i.test(value)
    || /\bcurrent location\b/i.test(value)
    || /\blocated\s+(?:at|near|in)\b/i.test(value);
}

function bodyParametersToComponent(bodyParameters) {
  return {
    type: 'body',
    parameters: bodyParameters.map((value) => ({
      type: 'text',
      text: String(value ?? ''),
    })),
  };
}

function buildSosTemplatePlan({
  device = {},
  alert = {},
  composeResult = null,
  now = new Date(),
  callbackTemplatesEnabled = false,
} = {}) {
  // The composer (or a later device read) cannot override incident coordinates.
  const snapshot = readSosLocationSnapshot(alert);
  const ctx = buildSosSafetyContext({ device, alert, now });
  const locationDecision = snapshot || {
    state: 'unavailable',
    reason: 'sos_snapshot_missing_or_invalid',
    ageSeconds: null,
    location: null,
  };

  let narration = String(composeResult?.narration || '').trim();
  let narrationSource = composeResult?.source || 'fallback';
  let narrationOverrideReason = null;

  if (!narration) {
    narration = buildDeterministicNarration('sos', ctx);
    narrationSource = 'fallback';
    narrationOverrideReason = 'missing_narration';
  }

  if (
    locationDecision.state === 'last_known'
    && narrationPresentsStaleLocationAsCurrent(narration)
  ) {
    narration = buildDeterministicNarration('sos', ctx);
    narrationSource = 'fallback';
    narrationOverrideReason = 'stale_location_presented_as_current';
  }

  if (
    locationDecision.state === 'unavailable'
    && narrationClaimsLocationWhenUnavailable(narration)
  ) {
    narration = buildDeterministicNarration('sos', ctx);
    narrationSource = 'fallback';
    narrationOverrideReason = 'location_claim_without_coordinates';
  }

  if (callbackTemplatesEnabled) {
    narration = buildCallbackNarration(ctx);
    narrationSource = 'fallback';
    narrationOverrideReason = 'callback_action_required';
  }

  const locationValue = formatSosLocationValue(snapshot);

  const bodyParameters = [
    narration,
    ctx.eventTime || 'Time unavailable',
    locationValue,
    buildWatchTemplateValue(ctx),
  ];

  const templateNames = callbackTemplatesEnabled
    ? SOS_CALLBACK_TEMPLATE_NAMES
    : SOS_TEMPLATE_NAMES;
  const templateName = templateNames[locationDecision.state];
  const buttonUrlParameter =
    locationDecision.state === 'unavailable' ? null : mapButtonSuffix(ctx);
  const locationButtonIndex = callbackTemplatesEnabled ? 1 : 0;

  let components;
  if (buttonUrlParameter) {
    components = buildGuardianSafetyTemplateComponents({
      bodyParameters,
      buttonUrlParameter,
      buttonIndex: locationButtonIndex,
    });
  } else {
    // guardian_sos_unavailable_v1 has no location button.
    components = [bodyParametersToComponent(bodyParameters)];
  }

  return {
    templateName,
    callbackTemplatesEnabled,
    callButtonIncluded: callbackTemplatesEnabled,
    locationButtonIndex: buttonUrlParameter ? locationButtonIndex : null,
    locationState: locationDecision.state,
    locationDecision,
    narration,
    narrationSource,
    narrationOverrideReason,
    bodyParameters,
    buttonUrlParameter,
    components,
  };
}

module.exports = {
  SOS_TEMPLATE_NAMES,
  SOS_CALLBACK_TEMPLATE_NAMES,
  buildCallbackNarration,
  mapButtonSuffix,
  buildFreshLocationValue,
  buildLastKnownLocationValue,
  narrationPresentsStaleLocationAsCurrent,
  narrationClaimsLocationWhenUnavailable,
  buildSosTemplatePlan,
};
