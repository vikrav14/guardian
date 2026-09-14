'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('../../docs/testing/sos-location-selection.json');
const {
  buildSosLocationSnapshot, readSosLocationSnapshot, deviceAtSos,
  formatSosLocationValue, buildSosSafetyContext, buildSosSafetyMessage,
} = require('../src/sos-location-snapshot');
const { buildSosTemplatePlan } = require('../src/guardian-sos-plan');
const { prepareSosWhatsApp, sendPreparedSosWhatsApp, renderSosFallbackText } = require('../src/sos-whatsapp');

const now = new Date('2026-09-01T12:00:00.000Z');
const later = new Date('2026-09-01T13:00:00.000Z');
function device() { return structuredClone(fixtures[0].device); }
function alertFor(evidence = device()) {
  return { type: 'sos', eventAt: now,
    sosLocationSnapshot: buildSosLocationSnapshot(evidence, { now }) };
}

for (const fixture of fixtures) {
  test(`shared app/SOS selection: ${fixture.name}`, () => {
    const snapshot = buildSosLocationSnapshot(fixture.device, { now: new Date(fixture.now) });
    const point = snapshot.location ? { lat: snapshot.location.lat, lng: snapshot.location.lng } : null;
    assert.deepEqual(point, fixture.expected.location);
    assert.equal(snapshot.state, fixture.expected.state);
    assert.deepEqual(readSosLocationSnapshot({ sosLocationSnapshot: snapshot }), snapshot);
  });
}

test('retained GPS is last-known even inside the ten-minute freshness window', () => {
  const d = device();
  d.lastSatelliteLocation.recordedAt = '2026-09-01T11:58:00.000Z';
  const snapshot = buildSosLocationSnapshot(d, { now });
  assert.equal(snapshot.state, 'last_known');
  assert.equal(snapshot.ageSeconds, 120);
  assert.match(formatSosLocationValue(snapshot), /Current position unconfirmed/);
});

test('primary GPS keeps its own time and label; approximate radius stays secondary', () => {
  const snapshot = alertFor().sosLocationSnapshot;
  assert.equal(snapshot.location.source, 'gps');
  assert.equal(snapshot.location.placeLabel, 'GPS fixture');
  assert.equal(snapshot.location.accuracyMeters, null);
  assert.equal(snapshot.ageSeconds, 780);
  assert.equal(snapshot.latestObservation.accuracyMeters, 600);
  assert.equal(snapshot.latestObservation.placeLabel, 'Network fixture');
  const text = formatSosLocationValue(snapshot);
  assert.match(text, /Last reliable GPS location/);
  assert.match(text, /13 mins before SOS receipt/);
  assert.match(text, /newer approximate network observation/);
  assert.match(text, /estimated radius 600 m, 1 min before SOS receipt/);
});

test('snapshot is detached from input objects and dates', () => {
  const d = device();
  d.lastSatelliteLocation.recordedAt = new Date(d.lastSatelliteLocation.recordedAt);
  const snapshot = buildSosLocationSnapshot(d, { now });
  d.lastSatelliteLocation.lat = 44;
  d.lastSatelliteLocation.recordedAt.setFullYear(2000);
  d.location.accuracyMeters = 1;
  assert.equal(snapshot.location.lat, -20.1);
  assert.equal(snapshot.ageSeconds, 780);
  assert.equal(snapshot.latestObservation.accuracyMeters, 600);
});

test('new alarm GPS wins; a future or invalid alarm fix does not erase prior GPS', () => {
  const observation = { lat: -20.4, lng: 57.4, source: 'gps', recordedAt: now };
  const fresh = buildSosLocationSnapshot(device(), { now, observation });
  assert.equal(fresh.location.lat, -20.4);
  assert.equal(fresh.state, 'fresh');
  for (const invalid of [{ ...observation, recordedAt: later }, { ...observation, lat: null }]) {
    const prior = buildSosLocationSnapshot(device(), { now, observation: invalid });
    assert.equal(prior.location.lat, -20.1);
    assert.equal(prior.state, 'last_known');
  }
});

test('invalid coordinates never produce an SOS map', () => {
  for (const location of [
    { lat: null, lng: 57 }, { lat: '', lng: 57 }, { lat: false, lng: 57 },
    { lat: NaN, lng: 57 }, { lat: Infinity, lng: 57 }, { lat: 91, lng: 57 },
    { lat: 0, lng: 0 }, { lat: -20, lng: 181 },
  ]) {
    const snapshot = buildSosLocationSnapshot({ location }, { now });
    assert.equal(snapshot.state, 'unavailable');
    assert.equal(snapshot.location, null);
  }
});

test('post-incident device observations are excluded rather than called current', () => {
  const location = { lat: -20.4, lng: 57.4, source: 'gps', recordedAt: later };
  const snapshot = buildSosLocationSnapshot({ location, lastSatelliteLocation: location }, { now });
  assert.equal(snapshot.state, 'unavailable');
  assert.equal(snapshot.location, null);
});

test('unknown provenance and missing times remain qualified', () => {
  const snapshot = buildSosLocationSnapshot({ location: { lat: -20.4, lng: 57.4 } }, { now });
  assert.equal(snapshot.state, 'last_known');
  assert.match(formatSosLocationValue(snapshot), /source unconfirmed/);
  assert.match(formatSosLocationValue(snapshot), /recording time unavailable/);
  const context = buildSosSafetyContext({ alert: { sosLocationSnapshot: snapshot }, now });
  assert.equal(context.approximate, true);
});

test('Firestore timestamps round-trip without relabelling approximate data as GPS', () => {
  const d = device();
  const snapshot = buildSosLocationSnapshot(d, { now });
  snapshot.capturedAt = { toDate: () => now };
  snapshot.location.recordedAt = { toDate: () => new Date('2026-09-01T11:47:00Z') };
  const read = readSosLocationSnapshot({ sosLocationSnapshot: snapshot });
  assert.equal(read.ageSeconds, 780);
  assert.equal(read.location.source, 'gps');
  assert.equal(read.latestObservation.source, 'wifi');
  assert.equal(read.location.accuracyMeters, null);
});

test('legacy, forged payload and malformed snapshots never borrow a later live fix', async () => {
  const valid = alertFor().sosLocationSnapshot;
  for (const alert of [
    { type: 'sos' },
    { type: 'sos', payload: { locationSnapshot: valid, sosLocationSnapshot: valid } },
    { type: 'sos', sosLocationSnapshot: { ...valid, version: 999 } },
    { type: 'sos', sosLocationSnapshot: { ...valid, state: 'fresh' } },
    { type: 'sos', sosLocationSnapshot: { ...valid, capturedAt: 'invalid' } },
  ]) {
    assert.equal(deviceAtSos(device(), alert).location, null);
    const prepared = await prepareSosWhatsApp({ device: device(), alert, now: later });
    assert.equal(prepared.plan.locationState, 'unavailable');
    assert.equal(prepared.plan.buttonUrlParameter, null);
    assert.doesNotMatch(renderSosFallbackText(prepared), /maps\.google/);
  }
});

test('delayed standard and callback templates keep event coordinates and receipt-relative age', async () => {
  const alert = alertFor();
  const moved = { nickname: 'Fixture wearer', online: true, lastHeartbeatAt: later,
    batteryPercent: 70, location: { lat: -21, lng: 58, source: 'gps', recordedAt: later },
    accuracySource: 'gps' };
  for (const callbackTemplatesEnabled of [false, true]) {
    const prepared = await prepareSosWhatsApp({ device: moved, alert, now: later, callbackTemplatesEnabled });
    const plan = prepared.plan;
    assert.equal(plan.templateName, callbackTemplatesEnabled
      ? 'guardian_sos_callback_last_location_v1' : 'guardian_sos_last_location_v1');
    assert.equal(plan.buttonUrlParameter, '-20.1,57.1');
    assert.equal(plan.components[1].index, callbackTemplatesEnabled ? '1' : '0');
    assert.equal(plan.bodyParameters.length, 4);
    assert.match(plan.bodyParameters[2], /13 mins before SOS receipt/);
    assert.match(plan.bodyParameters[3], /online.*70%/);
    assert.equal(prepared.composeResult.context.locationFreshness, '13 mins ago');
    assert.equal(prepared.composeResult.context.mapsUrl, 'https://maps.google.com/?q=-20.1,57.1');
    const sends = [];
    await sendPreparedSosWhatsApp('23050000000', prepared, {
      sendTemplate: async (to, templateName, options) => {
        sends.push({ to, templateName, options });
        return { ok: true, provider: 'meta', messageId: 'wamid.fixture' };
      },
    });
    assert.equal(sends.length, 1);
    assert.equal(sends[0].options.languageCode, 'en');
    assert.equal(sends[0].options.components[1].parameters[0].text, '-20.1,57.1');
    assert.doesNotMatch(JSON.stringify(sends), /-21,58/);
    assert.match(renderSosFallbackText(prepared), /q=-20\.1,57\.1/);
    assert.match(buildSosSafetyMessage({ device: moved, alert, now: later }), /q=-20\.1,57\.1/);
  }
});

test('composer context cannot inject a different pin or source into the SOS plan', () => {
  const plan = buildSosTemplatePlan({ device: device(), alert: alertFor(), now,
    composeResult: { source: 'llm', narration: 'Please check on the wearer.',
      context: { mapsUrl: 'https://maps.google.com/?q=1,2', approximate: true,
        positioningLabel: 'WiFi positioning', hasLocation: true, placeLabel: 'Wrong place' } } });
  assert.equal(plan.buttonUrlParameter, '-20.1,57.1');
  assert.match(plan.bodyParameters[2], /GPS fixture/);
  assert.doesNotMatch(plan.bodyParameters[2], /Wrong place/);
});

test('a later independent SOS captures new evidence, without changing the first incident', () => {
  const first = alertFor();
  const second = { type: 'sos', sosLocationSnapshot: buildSosLocationSnapshot({
    location: { lat: -20.4, lng: 57.4, source: 'gps', recordedAt: later },
  }, { now: later }) };
  assert.equal(buildSosTemplatePlan({ alert: first, now: later }).buttonUrlParameter, '-20.1,57.1');
  assert.equal(buildSosTemplatePlan({ alert: second, now: later }).buttonUrlParameter, '-20.4,57.4');
});
