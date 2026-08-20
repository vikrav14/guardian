const { buildSafetyContext } = require('./safety-message');
const {
  buildDeterministicNarration,
  buildWatchTemplateValue,
} = require('./guardian-message-composer');
const {
  buildGuardianSafetyTemplateComponents,
} = require('./whatsapp-meta');
const {
  classifySosLocation,
  formatLocationAge,
} = require('./sos-location-policy');

const SOS_TEMPLATE_NAMES = Object.freeze({
  fresh: 'guardian_sos_alert',
  last_known: 'guardian_sos_last_location_v1',
  unavailable: 'guardian_sos_unavailable_v1',
});

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
} = {}) {
  const ctx = composeResult?.context || buildSafetyContext({ device, alert, now });
  const locationDecision = classifySosLocation({ device, now });

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

  let locationValue;
  if (locationDecision.state === 'fresh') {
    locationValue = buildFreshLocationValue(ctx);
  } else if (locationDecision.state === 'last_known') {
    locationValue = buildLastKnownLocationValue(ctx, locationDecision);
  } else {
    locationValue = 'Current location unavailable';
  }

  const bodyParameters = [
    narration,
    ctx.eventTime || 'Time unavailable',
    locationValue,
    buildWatchTemplateValue(ctx),
  ];

  const templateName = SOS_TEMPLATE_NAMES[locationDecision.state];
  const buttonUrlParameter =
    locationDecision.state === 'unavailable' ? null : mapButtonSuffix(ctx);

  let components;
  if (buttonUrlParameter) {
    components = buildGuardianSafetyTemplateComponents({
      bodyParameters,
      buttonUrlParameter,
    });
  } else {
    // guardian_sos_unavailable_v1 has no location button.
    components = [bodyParametersToComponent(bodyParameters)];
  }

  return {
    templateName,
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
  mapButtonSuffix,
  buildFreshLocationValue,
  buildLastKnownLocationValue,
  narrationPresentsStaleLocationAsCurrent,
  narrationClaimsLocationWhenUnavailable,
  buildSosTemplatePlan,
};
