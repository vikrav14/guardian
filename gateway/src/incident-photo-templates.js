'use strict';
const { validIncidentId, CAPTURE_POLICY } = require('./incident-photo-policy');
const { asBool } = require('./safety-snapshot-runtime');
const { DYNAMIC_CALL_TEMPLATES } = require('./watch-call-links');
const { checkCallTemplates } = require('./watch-call-template-contract');
const { compactAlertParameters, compactPhotoParameters } = require('./incident-message-copy');
const FOLLOWUP_TEMPLATE = 'guardian_incident_photo_update_v1';
const GUARDIAN_FOLLOWUP_TEMPLATE = 'guardian_incident_photo_update_v3';
const WELLBEING_FOLLOWUP_TEMPLATE = 'guardian_incident_update_v1';
const GUARDIAN_PHOTO_NOTICE = '\n\nOne photo may follow. Request more in Guardian for 1 hour after this alert. Keep checking on the wearer; do not wait for photos.';
const PHOTO_NOTICE = '\n\nIncident photos may follow, if available (up to 5). Keep checking on the wearer; do not wait for photos.';
const V3_TEMPLATES = Object.freeze(Object.fromEntries(Object.entries(DYNAMIC_CALL_TEMPLATES)
  .map(([type, states]) => [type, Object.freeze(Object.fromEntries(Object.entries(states)
    .map(([state, name]) => [state, name.replace(/_v2$/, '_v3')])))])));
const V4_TEMPLATES = Object.freeze(Object.fromEntries(Object.entries(V3_TEMPLATES)
  .map(([type, states]) => [type, Object.freeze(Object.fromEntries(Object.entries(states)
    .map(([state, name]) => [state, name.replace(/_v3$/, '_v4')])))])));
const V5_TEMPLATES = Object.freeze(Object.fromEntries(Object.entries(V4_TEMPLATES)
  .map(([type, states]) => [type, Object.freeze(Object.fromEntries(Object.entries(states)
    .map(([state, name]) => [state, name.replace(/_v4$/, '_v5')])))])));

function galleryBase(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
        /^(localhost|127\.|\[::1\])/.test(url.hostname) || url.hostname.endsWith('.localhost')) return null;
    return `${url.href.replace(/\/$/, '')}/?incident=`;
  } catch { return null; }
}

// Compact copy uses the same frozen incident evidence. Recipient-specific call
// tokens and map coordinates are never changed by the presentation layer.
function withIncidentPhotoTemplate(prepared, { type, device, alert, env = process.env } = {}) {
  const plan = prepared?.plan;
  const compact = asBool(env.INCIDENT_PHOTO_GUARDIAN_WINDOW_APPROVED);
  const names = (compact ? V5_TEMPLATES : V3_TEMPLATES)[type];
  const enabled = type === 'sos' ? env.INCIDENT_PHOTO_SOS_V3_ENABLED : env.INCIDENT_PHOTO_FALL_V3_ENABLED;
  if (!names || !asBool(enabled) || !plan?.dynamicCallLink ||
      plan.templateName !== DYNAMIC_CALL_TEMPLATES[type][plan.locationState]) return prepared;
  if (!compact) return { ...prepared, plan: { ...plan, templateName: names[plan.locationState] } };
  const bodyParameters = compactAlertParameters({ type, device, alert, plan });
  // Keep an existing approved alert if its frozen evidence cannot be read.
  if (!bodyParameters) return prepared;
  const components = plan.components.map(component => component.type === 'body'
    ? { type: 'body', parameters: bodyParameters.map(text => ({ type: 'text', text })) } : component);
  return { ...prepared, plan: { ...plan, templateName: names[plan.locationState], bodyParameters, components } };
}

function buildFollowupPlan(id, gallery, context = {}) {
  if (!validIncidentId(id)) throw Error('invalid_incident');
  if (gallery.capturePolicy === CAPTURE_POLICY && context.compactTemplatesApproved === true &&
      context.incidentReadingsApproved === true && context.readings?.pending === false) {
    const photo = compactPhotoParameters(gallery, context);
    const parameters = [...photo.slice(0, 4),
      ...require('./incident-wellbeing-message').incidentReadingParameters(context.readings, context.incident?.timeZone), photo[4]];
    return { templateName: WELLBEING_FOLLOWUP_TEMPLATE, components: [
      { type: 'body', parameters: parameters.map(text => ({ type: 'text', text })) },
      { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: id }] },
    ] };
  }
  if (gallery.capturePolicy === CAPTURE_POLICY && context.compactTemplatesApproved === true) return { templateName: GUARDIAN_FOLLOWUP_TEMPLATE, components: [
    { type: 'body', parameters: compactPhotoParameters(gallery, context).map(text => ({ type: 'text', text })) },
    { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: id }] },
  ] };
  const received = gallery.photos.filter(p => p.state === 'available');
  const analysed = received.filter(p => ['ready', 'too_unclear'].includes(p.analysis?.status));
  const facts = gallery.summary.slice(0, 2).map(item => `Photo ${item.photo}: ${item.text}`).join(' ');
  const unclear = received.filter(p => p.analysis?.status === 'too_unclear');
  // A failed provider request says nothing about image clarity. Only a stored
  // too_unclear result supports that explanation in the follow-up parameter.
  const fallback = !received.length ? 'No incident photos were received.'
    : unclear.length === received.length ? 'Photos are available; AI found these views too unclear to describe.'
      : unclear.length ? 'Photos are available; AI found some views too unclear. Other AI descriptions are unavailable.'
        : 'Photos are available; AI descriptions are unavailable.';
  const summary = facts || fallback;
  return { templateName: FOLLOWUP_TEMPLATE, components: [
    { type: 'body', parameters: [String(received.length), String(analysed.length), summary]
      .map(text => ({ type: 'text', text })) },
    { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: id }] },
  ] };
}

// Preserve the approved v2 wording and buttons, copying only writable fields.
function writableComponents(components) {
  if (!Array.isArray(components)) throw Error('invalid_template_components');
  const seen = new Set();
  return components.map(component => {
    const { type, format, text, example, buttons } = component;
    if (!['HEADER', 'BODY', 'FOOTER', 'BUTTONS'].includes(type) || seen.has(type)) throw Error('unsupported_template_components');
    seen.add(type);
    return { type, ...(format ? { format } : {}), ...(typeof text === 'string' ? { text } : {}),
      ...(example ? { example: structuredClone(example) } : {}),
      ...(buttons ? { buttons: buttons.map(button => {
        if (button.type !== 'URL') throw Error('unsupported_template_button');
        return { type: 'URL', text: button.text, url: button.url,
          ...(button.example ? { example: structuredClone(button.example) } : {}) };
      }) } : {}) };
  });
}

function templateDefinitions({ appUrl, callOrigin, baseTemplates, guardianWindow = false, incidentReadings = false } = {}) {
  const base = galleryBase(appUrl);
  if (!base) throw Error('A deployed HTTPS app URL without query or fragment is required.');
  if (incidentReadings) return [{ name: WELLBEING_FOLLOWUP_TEMPLATE, language: 'en', category: 'UTILITY', components: [
    { type: 'BODY', text: '📋 *Incident update for {{1}}*\nAlert time: {{2}}\n\n{{3}}\n{{4}}\n\n*Watch readings received after the alert*\n{{5}}\n{{6}}\n{{7}}\n{{8}}\n\n{{9}}\n\nWatch estimates; times shown are receipt times, not measurement times. Photos, AI and readings cannot confirm the wearer’s condition. Please keep checking on the wearer.',
      example: { body_text: [['Alex', '5 Oct 2026, 13:22 GMT+4', 'The automatic incident photo is available.',
        'AI description ready in Guardian (unverified).',
        'Heart rate: 72 bpm · received 5 Oct 2026, 13:24 GMT+4', 'Oxygen estimate: 97% · received 5 Oct 2026, 13:24 GMT+4',
        'Blood pressure estimate: 120/80 mmHg · received 5 Oct 2026, 13:24 GMT+4', 'Skin temperature: no fresh reading received.',
        'Additional photo requests close at 5 Oct 2026, 14:22 GMT+4.']] } },
    { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Incident details', url: `${base}{{1}}`, example: [`${base}sampleIncident123`] }] },
  ] }];
  if (!Array.isArray(baseTemplates)) throw Error('Read the six existing v2 templates before preparing v3.');
  const checks = ['sos', 'fall'].flatMap(type => checkCallTemplates(baseTemplates,
    { type, settings: { watchCallPublicOrigin: callOrigin } }));
  if (checks.some(check => !check.ready)) throw Error('Existing v2 approval or calling/location contract does not match. No templates changed.');
  const definitions = [];
  for (const type of ['sos', 'fall']) for (const state of ['fresh', 'last_known', 'unavailable']) {
    const original = baseTemplates.find(row => row.name === DYNAMIC_CALL_TEMPLATES[type][state] && row.language === 'en');
    const components = writableComponents(original.components);
    if (guardianWindow) {
      const photoNotice = state === 'last_known'
        ? 'One photo may follow. The map shows an earlier position; keep checking on the wearer.'
        : state === 'unavailable'
          ? 'One photo may follow. Check on the wearer directly if you cannot reach the watch.'
          : 'One photo may follow. Do not wait to check on the wearer.';
      definitions.push({ name: V5_TEMPLATES[type][state], language: 'en', category: 'UTILITY', components: [
        { type: 'BODY', text: `${type === 'sos' ? '🚨 *SOS from {{1}}*' : '⚠️ *Fall alert for {{1}}*'}\nAlert time: {{2}}\n\n*Please call the watch now.*\n\n{{3}}\n{{4}}\n\n${photoNotice}`,
          example: { body_text: [['Alex', '5 Oct 2026, 13:22 GMT+4', state === 'unavailable' ? 'Location unavailable at the alert.'
            : state === 'last_known' ? 'Current position unconfirmed. Last GPS: Example village · 8 mins before alert receipt.'
              : 'GPS: Example village · less than 1 min before alert receipt.', 'Watch online · battery 80%']] } },
        components.find(component => component.type === 'BUTTONS'),
      ] });
      continue;
    }
    const body = components.find(component => component.type === 'BODY');
    body.text += PHOTO_NOTICE;
    if (body.text.length > 1024) throw Error('The revised body exceeds the template limit. No templates changed.');
    definitions.push({ name: V3_TEMPLATES[type][state], language: 'en', category: 'UTILITY', components });
  }
  if (guardianWindow) {
    definitions.push({ name: GUARDIAN_FOLLOWUP_TEMPLATE, language: 'en', category: 'UTILITY', components: [
      { type: 'BODY', text: '📷 *Photo update for {{1}}*\nAlert time: {{2}}\n\n{{3}}\n{{4}}\n\n{{5}}\n\nPhotos and AI cannot confirm the wearer’s condition. Open Guardian for photos and AI details.',
        example: { body_text: [['Alex', '5 Oct 2026, 13:22 GMT+4', 'The automatic incident photo is available.',
          'AI description ready in Guardian (unverified).', 'Additional photo requests close at 5 Oct 2026, 14:22 GMT+4.']] } },
      { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Photos & AI details', url: `${base}{{1}}`, example: [`${base}sampleIncident123`] }] },
    ] });
    return definitions;
  }
  definitions.push({ name: FOLLOWUP_TEMPLATE, language: 'en', category: 'UTILITY', components: [
    { type: 'HEADER', format: 'TEXT', text: 'Guardian incident update' },
    { type: 'BODY', text: 'Incident photos: {{1}} of up to 5 received; {{2}} analysed.\n\nGuardian AI photo insights (unverified):\n{{3}}\n\nPhotos cannot establish the wearer’s condition or current location. The original alert still needs your attention. Sign in to view each photo and its limitations.',
      example: { body_text: [['3', '2', 'Photo 1: Pale walls and chairs are visible. Photo 2: A doorway is visible.']] } },
    { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Photos & AI details', url: `${base}{{1}}`, example: [`${base}sampleIncident123`] }] },
  ] });
  return definitions;
}

function checkPhotoTemplates(templates, definitions) {
  const comparable = components => writableComponents(components).map(component => {
    const { example, ...rest } = component;
    if (rest.buttons) rest.buttons = rest.buttons.map(({ example, ...button }) => button);
    return rest;
  });
  return definitions.map(definition => {
    const rows = templates.filter(row => row.name === definition.name && row.language === 'en');
    if (!rows.length) return { name: definition.name, ready: false, problems: ['missing_english_template'] };
    const row = rows[0], problems = [];
    if (rows.length !== 1) problems.push('duplicate_english_template');
    if (row.status !== 'APPROVED') problems.push('not_approved');
    if (row.category !== definition.category) problems.push('not_utility');
    if (row.parameter_format && row.parameter_format !== 'POSITIONAL') problems.push('unsupported_parameter_format');
    try {
      if (JSON.stringify(comparable(row.components)) !== JSON.stringify(comparable(definition.components))) problems.push('contract_mismatch');
    } catch { problems.push('contract_mismatch'); }
    return { name: definition.name, ready: problems.length === 0, problems };
  });
}

module.exports = { galleryBase, withIncidentPhotoTemplate, buildFollowupPlan,
  templateDefinitions, checkPhotoTemplates, FOLLOWUP_TEMPLATE, PHOTO_NOTICE, V3_TEMPLATES,
  GUARDIAN_FOLLOWUP_TEMPLATE, WELLBEING_FOLLOWUP_TEMPLATE, GUARDIAN_PHOTO_NOTICE, V4_TEMPLATES, V5_TEMPLATES };
