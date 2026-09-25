'use strict';
const { validIncidentId } = require('./incident-photo-policy');
const FOLLOWUP_TEMPLATE = 'guardian_incident_photo_update_v1';

function galleryBase(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
    return `${url.href.replace(/\/$/, '')}/?incident=`;
  } catch { return null; }
}
function templateName(type, state, callback) {
  if (!['sos', 'fall'].includes(type) || !['fresh', 'last_known', 'unavailable'].includes(state)) throw Error('invalid_template');
  const variant = { fresh: 'alert', last_known: 'last_location', unavailable: 'unavailable' }[state];
  return `guardian_${type}${callback ? '_callback' : ''}_${variant}_photos_v1`;
}
function photoTemplatePlan(plan, { type, alertId, approved = false, appUrl, callback = false } = {}) {
  if (!approved || !validIncidentId(alertId) || !galleryBase(appUrl)) return plan;
  const hasMap = Boolean(plan.buttonUrlParameter);
  const body = { type: 'body', parameters: plan.bodyParameters.map(text => ({ type: 'text', text })) };
  const urlButton = (index, text) => ({ type: 'button', sub_type: 'url', index: String(index), parameters: [{ type: 'text', text }] });
  const mapIndex = callback ? 1 : 0;
  return { ...plan, templateName: templateName(type, plan.locationState, callback),
    callButtonIncluded: callback, incidentId: alertId,
    components: [body, ...(hasMap ? [urlButton(mapIndex, plan.buttonUrlParameter)] : []),
      urlButton(mapIndex + (hasMap ? 1 : 0), alertId)] };
}
function buildFollowupPlan(id, gallery) {
  if (!validIncidentId(id)) throw Error('invalid_incident');
  const received = gallery.photos.filter(p => p.state === 'available');
  const analysed = received.filter(p => ['ready', 'too_unclear'].includes(p.analysis?.status));
  const facts = gallery.summary.slice(0, 2).map(item => `Photo ${item.photo}: ${item.text}`).join(' ');
  const summary = facts || (received.length ? 'Photos are available; AI details are unavailable or the views are too unclear.' : 'No incident photos were received.');
  return { templateName: FOLLOWUP_TEMPLATE, components: [
    { type: 'body', parameters: [String(received.length), String(analysed.length), summary]
      .map(text => ({ type: 'text', text })) },
    { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: id }] },
  ] };
}

// Create reviewed versions alongside the existing live templates. Switching is
// independent from submission and requires approved names plus a deployed app.
function templateDefinitions({ appUrl, callNumber = null } = {}) {
  const base = galleryBase(appUrl);
  if (!base) throw Error('A deployed HTTPS app URL without query or fragment is required.');
  if (callNumber && !/^\+[1-9]\d{7,14}$/.test(callNumber)) throw Error('Call watch number must be E.164.');
  const definitions = [];
  for (const type of ['sos', 'fall']) for (const state of ['fresh', 'last_known', 'unavailable']) {
    for (const callback of (callNumber ? [false, true] : [false])) {
      const buttons = callback ? [{ type: 'PHONE_NUMBER', text: 'Call watch', phone_number: callNumber }] : [];
      if (state !== 'unavailable') buttons.push({ type: 'URL', text: state === 'last_known' ? 'Last known location' : 'View location',
        url: 'https://maps.google.com/?q={{1}}', example: ['https://maps.google.com/?q=-20.16,57.50'] });
      buttons.push({ type: 'URL', text: 'Photos & AI details', url: `${base}{{1}}`, example: [`${base}sampleIncident123`] });
      definitions.push({ name: templateName(type, state, callback), language: 'en', category: 'UTILITY', components: [
        { type: 'HEADER', format: 'TEXT', text: type === 'sos' ? 'Guardian SOS alert' : 'Guardian fall alert' },
        { type: 'BODY', text: 'Safety event: {{1}}\n\nEvent time: {{2}}\nLocation: {{3}}\n{{4}}\n\nGuardian AI photo insights\nAwaiting incident photos, if available (up to 5). Use Photos & AI details for progress. Keep checking on the wearer; do not wait for photos.',
          example: { body_text: [[type === 'sos' ? 'Alex pressed SOS and is requesting help.' : 'The watch reported a possible fall for Alex. Please check on Alex now.',
            '25 September, 23:35', state === 'unavailable' ? 'Current position unconfirmed' : state === 'last_known' ? 'Last known GPS fix, recorded 2 hours before the alert; current position unconfirmed' : 'GPS fix recorded 30 seconds before the alert', 'Battery: 55%']] } },
        { type: 'BUTTONS', buttons },
      ] });
    }
  }
  definitions.push({ name: FOLLOWUP_TEMPLATE, language: 'en', category: 'UTILITY', components: [
    { type: 'HEADER', format: 'TEXT', text: 'Guardian incident update' },
    { type: 'BODY', text: 'Incident photos: {{1}} of up to 5 received; {{2}} analysed.\n\nGuardian AI photo insights (unverified):\n{{3}}\n\nPhotos cannot establish the wearer’s condition or current location. The original alert still needs your attention. Sign in to view each photo and its limitations.',
      example: { body_text: [['3', '2', 'Photo 1: Pale walls and chairs are visible. Photo 2: A doorway is visible.']] } },
    { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Photos & AI details', url: `${base}{{1}}`, example: [`${base}sampleIncident123`] }] },
  ] });
  return definitions;
}
module.exports = { galleryBase, templateName, photoTemplatePlan, buildFollowupPlan, templateDefinitions, FOLLOWUP_TEMPLATE };
