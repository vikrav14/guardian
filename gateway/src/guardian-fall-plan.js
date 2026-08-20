'use strict';

const { buildSafetyContext } = require('./safety-message');
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
const { deviceAtFall, readFallLocationSnapshot } = require('./fall-location-snapshot');

const FALL_TEMPLATE_NAMES = Object.freeze({
  fresh: 'guardian_fall_alert_v1',
  last_known: 'guardian_fall_last_location_v1',
  unavailable: 'guardian_fall_unavailable_v1',
});

function bodyComponent(bodyParameters) {
  return {
    type: 'body',
    parameters: bodyParameters.map((value) => ({
      type: 'text',
      text: String(value ?? ''),
    })),
  };
}

function unavailableDecision() {
  return {
    state: 'unavailable',
    reason: 'fall_snapshot_missing',
    ageSeconds: null,
    recordedAt: null,
  };
}

function mapButtonSuffix(ctx) {
  const prefix = 'https://maps.google.com/?q=';
  const url = String(ctx?.mapsUrl || '').trim();
  if (!url.startsWith(prefix)) return null;
  return url.slice(prefix.length).trim() || null;
}

function eventRelativeAge(ageSeconds) {
  const age = formatLocationAge(ageSeconds);
  return age === 'time unavailable'
    ? 'time unavailable at fall'
    : age.replace(/ ago$/, ' before fall');
}

function locationPlace(ctx) {
  if (ctx.placeLabel) {
    return `${ctx.approximate ? 'Approximate location near ' : ''}${ctx.placeLabel}`;
  }
  return ctx.approximate
    ? 'Approximate location available'
    : 'Location available';
}

function buildFallLocationValue(ctx, locationDecision) {
  const details = [
    ctx.positioningLabel,
    `recorded ${eventRelativeAge(locationDecision.ageSeconds)}`,
  ]
    .filter(Boolean)
    .join(' · ');
  const value = `${locationPlace(ctx)}${details ? ` · ${details}` : ''}`;
  return locationDecision.state === 'last_known'
    ? `Last known location: ${value}`
    : value;
}

function buildFallTemplatePlan({
  device = {},
  alert = {},
  now = new Date(),
} = {}) {
  const snapshot = readFallLocationSnapshot(alert);
  const frozenDevice = deviceAtFall(device, alert);
  const ctx = buildSafetyContext({
    device: frozenDevice,
    alert,
    now,
  });
  const locationDecision = snapshot
    ? {
        state: snapshot.state,
        reason: snapshot.reason || null,
        ageSeconds: snapshot.ageSeconds ?? null,
        recordedAt: snapshot.location?.recordedAt || null,
      }
    : unavailableDecision();

  let locationValue = 'Location unavailable when the fall was reported';
  if (locationDecision.state !== 'unavailable') {
    locationValue = buildFallLocationValue(ctx, locationDecision);
  }

  const narration = buildDeterministicNarration('fall', ctx);
  const bodyParameters = [
    narration,
    ctx.eventTime || 'Time unavailable',
    locationValue,
    buildWatchTemplateValue(ctx),
  ];
  const templateName = FALL_TEMPLATE_NAMES[locationDecision.state];
  const buttonUrlParameter = locationDecision.state === 'unavailable'
    ? null
    : mapButtonSuffix(ctx);
  const components = buttonUrlParameter
    ? buildGuardianSafetyTemplateComponents({
        bodyParameters,
        buttonUrlParameter,
      })
    : [bodyComponent(bodyParameters)];

  return {
    templateName,
    locationState: locationDecision.state,
    locationDecision,
    narration,
    narrationSource: 'deterministic',
    bodyParameters,
    buttonUrlParameter,
    components,
  };
}

module.exports = {
  FALL_TEMPLATE_NAMES,
  eventRelativeAge,
  buildFallLocationValue,
  buildFallTemplatePlan,
};
