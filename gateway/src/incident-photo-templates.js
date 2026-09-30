'use strict';
const { validIncidentId } = require('./incident-photo-policy');
const { asBool } = require('./safety-snapshot-runtime');
const { DYNAMIC_CALL_TEMPLATES } = require('./watch-call-links');
const { checkCallTemplates } = require('./watch-call-template-contract');
const FOLLOWUP_TEMPLATE = 'guardian_incident_photo_update_v1';
const PHOTO_NOTICE = '\n\nIncident photos may follow, if available (up to 5). Keep checking on the wearer; do not wait for photos.';
const V3_TEMPLATES = Object.freeze(Object.fromEntries(Object.entries(DYNAMIC_CALL_TEMPLATES)
  .map(([type, states]) => [type, Object.freeze(Object.fromEntries(Object.entries(states)
    .map(([state, name]) => [state, name.replace(/_v2$/, '_v3')])))])));

function galleryBase(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
        /^(localhost|127\.|\[::1\])/.test(url.hostname) || url.hostname.endsWith('.localhost')) return null;
    return `${url.href.replace(/\/$/, '')}/?incident=`;
  } catch { return null; }
}

// After recipient-specific v2 link issuance, change only the approved name.
// Body facts, bearer token and frozen map remain exactly as prepared.
function withIncidentPhotoTemplate(prepared, { type, env = process.env } = {}) {
  const plan = prepared?.plan;
  const names = V3_TEMPLATES[type];
  const enabled = type === 'sos' ? env.INCIDENT_PHOTO_SOS_V3_ENABLED : env.INCIDENT_PHOTO_FALL_V3_ENABLED;
  if (!names || !asBool(enabled) || !plan?.dynamicCallLink ||
      plan.templateName !== DYNAMIC_CALL_TEMPLATES[type][plan.locationState]) return prepared;
  return { ...prepared, plan: { ...plan, templateName: names[plan.locationState] } };
}

function buildFollowupPlan(id, gallery) {
  if (!validIncidentId(id)) throw Error('invalid_incident');
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

function templateDefinitions({ appUrl, callOrigin, baseTemplates } = {}) {
  const base = galleryBase(appUrl);
  if (!base) throw Error('A deployed HTTPS app URL without query or fragment is required.');
  if (!Array.isArray(baseTemplates)) throw Error('Read the six existing v2 templates before preparing v3.');
  const checks = ['sos', 'fall'].flatMap(type => checkCallTemplates(baseTemplates,
    { type, settings: { watchCallPublicOrigin: callOrigin } }));
  if (checks.some(check => !check.ready)) throw Error('Existing v2 approval or calling/location contract does not match. No templates changed.');
  const definitions = [];
  for (const type of ['sos', 'fall']) for (const state of ['fresh', 'last_known', 'unavailable']) {
    const original = baseTemplates.find(row => row.name === DYNAMIC_CALL_TEMPLATES[type][state] && row.language === 'en');
    const components = writableComponents(original.components);
    const body = components.find(component => component.type === 'BODY');
    body.text += PHOTO_NOTICE;
    if (body.text.length > 1024) throw Error('The revised body exceeds the template limit. No templates changed.');
    definitions.push({ name: V3_TEMPLATES[type][state], language: 'en', category: 'UTILITY', components });
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
  templateDefinitions, checkPhotoTemplates, FOLLOWUP_TEMPLATE, PHOTO_NOTICE, V3_TEMPLATES };
