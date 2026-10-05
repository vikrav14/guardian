'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSosLocationSnapshot } = require('../src/sos-location-snapshot');
const { buildFallLocationSnapshot } = require('../src/fall-location-snapshot');
const { buildSosTemplatePlan } = require('../src/guardian-sos-plan');
const { buildFallTemplatePlan } = require('../src/guardian-fall-plan');
const { DYNAMIC_CALL_TEMPLATES } = require('../src/watch-call-links');
const { withIncidentPhotoTemplate, V5_TEMPLATES, buildFollowupPlan } = require('../src/incident-photo-templates');
const { compactLocation, incidentDateTime } = require('../src/incident-message-copy');
const { CAPTURE_POLICY } = require('../src/incident-photo-policy');
const at = new Date('2026-10-05T09:22:00Z');
const gps = { lat: -20.2, lng: 57.5, source: 'gps', gpsValid: true,
  recordedAt: new Date(+at - 480000), placeLabel: 'Example village' };
const network = { lat: -20.3, lng: 57.6, source: 'wifi', gpsValid: false,
  recordedAt: new Date(+at - 30000), accuracyMeters: 267, placeLabel: 'Different village' };
function prepared(type, device) {
  const alert = { type, eventAt: at, ...(type === 'sos'
    ? { sosLocationSnapshot: buildSosLocationSnapshot(device, { now: at }) }
    : { payload: { locationSnapshot: buildFallLocationSnapshot(device, { now: at }) } }) };
  const plan = (type === 'sos' ? buildSosTemplatePlan : buildFallTemplatePlan)({ device, alert, now: at });
  plan.dynamicCallLink = true;
  plan.templateName = DYNAMIC_CALL_TEMPLATES[type][plan.locationState];
  plan.components = [{ type: 'body', parameters: plan.bodyParameters.map(text => ({ type: 'text', text })) },
    { type: 'button', index: '0', sub_type: 'url', parameters: [{ type: 'text', text: 'private-recipient-token' }] },
    ...(plan.buttonUrlParameter ? [{ type: 'button', index: '1', sub_type: 'url', parameters: [{ type: 'text', text: plan.buttonUrlParameter }] }] : [])];
  return { alert, value: { plan } };
}
const env = { INCIDENT_PHOTO_GUARDIAN_WINDOW_APPROVED: 'true', INCIDENT_PHOTO_SOS_V3_ENABLED: 'true', INCIDENT_PHOTO_FALL_V3_ENABLED: 'true' };

test('compact alerts keep frozen map/call tokens, old GPS age and uncertainty across newer device reads', () => {
  for (const type of ['sos', 'fall']) {
    const oldGps = { ...gps, recordedAt: new Date(+at - 780000) };
    const device = { nickname: 'Alex', online: true, lastHeartbeatAt: at, batteryPercent: 80,
      location: oldGps, accuracySource: 'gps', lastSatelliteLocation: oldGps };
    const p = prepared(type, device), original = structuredClone(p.value);
    const result = withIncidentPhotoTemplate(p.value, { type, alert: p.alert,
      device: { ...device, location: network, batteryPercent: 5 }, env });
    assert.equal(result.plan.templateName, V5_TEMPLATES[type].last_known);
    assert.deepEqual(result.plan.components.slice(1), p.value.plan.components.slice(1));
    assert.deepEqual(result.plan.bodyParameters, [ 'Alex', incidentDateTime(at),
      'Current position unconfirmed. Last GPS: Example village · 13 mins before alert receipt.',
      'Watch online · battery 80%' ]);
    assert.deepEqual(p.value, original);
    assert.doesNotMatch(JSON.stringify(result.plan.bodyParameters), /Different village|267/);
  }
});

test('retained GPS does not inherit the newer network time/place, even when GPS is recent', () => {
  const recentGps = { ...gps, recordedAt: new Date(+at - 60000) };
  const snapshot = buildSosLocationSnapshot({ location: network, lastSatelliteLocation: recentGps }, { now: at });
  const text = compactLocation(snapshot);
  assert.match(text, /Current position unconfirmed.*Last GPS: Example village.*1 min before alert receipt/);
  assert.doesNotMatch(text, /Different village|267|less than/);
});

test('fresh approximate evidence retains source, radius and incident-relative age', () => {
  const snapshot = buildSosLocationSnapshot({ location: network }, { now: at });
  assert.equal(compactLocation(snapshot), 'Approximate location: Different village · Wi-Fi, radius 267 m · less than 1 min before alert receipt.');
  assert.match(compactLocation({ ...snapshot, location: { ...network, accuracyMeters: null } }), /accuracy unknown/);
  assert.match(compactLocation({ ...snapshot, ageSeconds: null }), /recording time unknown/);
});

test('unavailable location never borrows live coordinates and incompatible evidence retains the approved alert', () => {
  for (const type of ['sos', 'fall']) {
    const p = prepared(type, {});
    const result = withIncidentPhotoTemplate(p.value, { type, alert: p.alert, device: { location: network }, env });
    assert.equal(result.plan.bodyParameters[2], 'Location unavailable at the alert.');
    assert.equal(result.plan.components.length, 2);
    const located = prepared(type, { location: gps });
    assert.equal(withIncidentPhotoTemplate(located.value, { type, alert: {}, env }), located.value);
  }
});

test('template name input cannot create extra lines or markdown; date contains day and timezone', () => {
  const p = prepared('sos', {});
  const result = withIncidentPhotoTemplate(p.value, { type: 'sos', alert: p.alert,
    device: { nickname: '*Alex*\nFake headline' }, env });
  assert.equal(result.plan.bodyParameters[0], 'Alex Fake headline');
  assert.match(result.plan.bodyParameters[1], /5 Oct 2026.*13:22.*GMT\+4/);
  assert.equal(incidentDateTime(null), 'Time unavailable');
  assert.equal(incidentDateTime(at, 'invalid/timezone'), incidentDateTime(at));
});

function photoPlan({ state = 'available', analysis = 'ready', now = at, access = {} } = {}) {
  return buildFollowupPlan('incident123', { capturePolicy: CAPTURE_POLICY, eventAt: at,
    photos: [{ captureSource: 'automatic', state, analysis: { status: analysis } },
      { captureSource: 'guardian', state: 'available', analysis: { status: 'ready' } }],
    summary: [{ photo: 1, text: 'PRIVATE IMAGE DESCRIPTION MUST STAY IN GALLERY' }],
    photoAccess: { canRequest: true, requestWindowEndsAt: new Date(+at + 3600000), ...access } },
    { incident: { eventAt: at }, device: { nickname: 'Alex' }, now });
}

test('concise photo update contains status and exact hour deadline, never private AI descriptions', () => {
  const plan = photoPlan();
  assert.equal(plan.templateName, 'guardian_incident_photo_update_v3');
  const values = plan.components[0].parameters.map(p => p.text);
  assert.deepEqual(values.slice(0, 4), ['Alex', incidentDateTime(at),
    'The automatic incident photo is available.', 'AI description ready in Guardian (unverified).']);
  assert.match(values[4], /5 Oct 2026.*14:22.*GMT\+4/);
  assert.doesNotMatch(JSON.stringify(plan), /PRIVATE|of up to|60 minutes remaining/);
  assert.equal(plan.components[1].parameters[0].text, 'incident123');
});

test('failed automatic photo is not presented as success because a guardian photo exists', () => {
  const values = photoPlan({ state: 'failed' }).components[0].parameters.map(p => p.text);
  assert.equal(values[2], 'No automatic incident photo was received.');
  assert.equal(values[3], 'No AI description is available.');
});

test('photo success does not imply AI success or image clarity', () => {
  for (const [analysis, expected] of [['unavailable', 'AI description unavailable.'],
    ['too_unclear', 'AI could not describe this photo clearly.'], ['analysing', 'AI description is still processing.']]) {
    assert.equal(photoPlan({ analysis }).components[0].parameters[3].text, expected);
  }
});

test('delayed followup, closed window and revoked capture cannot promise new photo access', () => {
  for (const args of [{ now: new Date(+at + 3600000) }, { access: { reason: 'photo_window_closed' } }]) {
    assert.equal(photoPlan(args).components[0].parameters[4].text, 'The one-hour photo request window has ended.');
  }
  assert.equal(photoPlan({ access: { reason: 'capture_disabled' } }).components[0].parameters[4].text,
    'Further photo requests are unavailable.');
});
