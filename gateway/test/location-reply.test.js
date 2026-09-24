'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('../../docs/testing/sos-location-selection.json');
const { getLastLocation } = require('../src/assistant/tools');
const { buildLocationReplyData, formatLocationReply } = require('../src/location-reply');

const now = new Date('2026-09-07T17:00:00Z');
const ago = minutes => new Date(now.getTime() - minutes * 60000);
const gps = { lat: -20.25, lng: 57.5, source: 'gps', gpsValid: true,
  recordedAt: ago(120), placeLabel: 'GPS test area' };
const network = { lat: -20.26, lng: 57.51, source: 'wifi', gpsValid: false,
  recordedAt: ago(1), accuracyMeters: 600, placeLabel: 'Network test area' };

async function location(device) {
  return getLastLocation({ devices: [{ imei: 'TEST-A', nickname: 'Test wearer', ...device }] },
    { imei: 'TEST-A' }, { now });
}

for (const fixture of fixtures) {
  test(`WhatsApp/app/SOS map contract: ${fixture.name}`, () => {
    const result = buildLocationReplyData(fixture.device, { now: new Date(fixture.now) });
    assert.deepEqual(result.mapsUrl ? { lat: result.lat, lng: result.lng } : null,
      fixture.expected.location);
    assert.equal(result.locationState, fixture.expected.state);
    const reply = formatLocationReply({ name: 'Test wearer', ...result });
    if (fixture.expected.state === 'last_known') assert.match(reply, /Current position unconfirmed/);
    if (!fixture.expected.location) assert.doesNotMatch(reply, /maps\.google/);
  });
}

test('old GPS survives the old 30-minute cutoff without borrowing network facts or heartbeat age', async () => {
  for (const gpsAge of [29, 30, 31, 120, 2880]) {
    const result = await location({
      lastSatelliteLocation: { ...gps, recordedAt: ago(gpsAge) },
      location: network, lastLocationObservation: network,
      lastHeartbeatAt: { toDate: () => ago(0) }, updatedAt: ago(0), batteryPercent: 80,
    });
    assert.equal(result.lat, gps.lat);
    assert.equal(result.lng, gps.lng);
    assert.equal(result.ageSeconds, gpsAge * 60);
    assert.equal(result.recordedAt, ago(gpsAge).toISOString());
    assert.equal(result.placeLabel, gps.placeLabel);
    assert.equal(result.accuracyMeters, null);
    assert.equal(result.latestObservationAgeSeconds, 60);
    assert.equal(result.latestObservationAccuracyMeters, 600);
    const reply = formatLocationReply(result);
    assert.match(reply, /Last known GPS location for Test wearer/);
    assert.match(reply, /Current position unconfirmed/);
    assert.match(reply, /Newer approximate Wi-Fi reading: 1 minute ago\. Estimated radius 600 m/);
    assert.match(reply, /Watch online · last check-in less than a minute ago/);
    assert.match(reply, /Battery last reported 80% less than a minute ago/);
    assert.match(reply, /View last known GPS location:\nhttps:\/\/maps.google.com\/\?q=-20.25,57.5/);
    assert.equal((reply.match(/https:/g) || []).length, 1);
    assert.doesNotMatch(reply, /Network test area|Test wearer is at|Last updated/);
  }
});

test('recent GPS uses its own timestamp and replaces the retained GPS pin', async () => {
  const result = await location({ lastSatelliteLocation: gps,
    location: { ...gps, lat: -20.24, recordedAt: ago(2) }, lastHeartbeatAt: ago(0) });
  assert.equal(result.lat, -20.24);
  assert.equal(result.retainedSatellite, false);
  const reply = formatLocationReply(result);
  assert.match(reply, /Latest recorded GPS location/);
  assert.match(reply, /Recorded 2 minutes ago · 7 Sept 2026, 20:58 MUT/);
  assert.doesNotMatch(reply, /Last known GPS|approximate|is at/);
});

for (const [source, label] of [['wifi', 'Wi-Fi'], ['lbs', 'cellular']]) {
  test(`${source}-only evidence is approximate even when recent and online`, async () => {
    const result = await location({ location: { ...network, source }, lastHeartbeatAt: ago(0) });
    const reply = formatLocationReply(result);
    assert.ok(reply.includes(`Approximate ${label} location for Test wearer`));
    assert.match(reply, /Near Network test area/);
    assert.match(reply, /Recorded 1 minute ago/);
    assert.match(reply, /Estimated radius 600 m/);
    assert.match(reply, /Current position unconfirmed/);
    assert.match(reply, /View approximate location/);
    assert.doesNotMatch(reply, /GPS|is at|detected via home Wi-Fi|confirmed at Home/);
  });
}

test('unknown source and recording time never become GPS or a current location', async () => {
  const result = await location({ location: { ...gps, source: 'unknown', recordedAt: null },
    lastHeartbeatAt: ago(0), updatedAt: ago(0) });
  const reply = formatLocationReply(result);
  assert.match(reply, /source unconfirmed/);
  assert.match(reply, /Recording time unavailable/);
  assert.match(reply, /Current position unconfirmed/);
  assert.equal(result.ageSeconds, null);
  assert.doesNotMatch(reply.split('\n').filter(line => !line.includes('test area')).join('\n'), /GPS|Recorded less than/);
});

test('GPS without a time remains last-known and a secondary observation is not called newer', async () => {
  const result = await location({ lastSatelliteLocation: { ...gps, recordedAt: null }, location: network });
  const reply = formatLocationReply(result);
  assert.match(reply, /Last known GPS/);
  assert.match(reply, /Recording time unavailable/);
  assert.match(reply, /Approximate Wi-Fi reading: 1 minute ago/);
  assert.doesNotMatch(reply, /Newer approximate/);
});

test('unusable or future-only observations have no map; malformed times stay unknown', async () => {
  for (const observation of [null, { ...gps, lat: null }, { ...gps, lat: 100 },
    { ...gps, lat: 0, lng: 0 }, { ...gps, gpsValid: false }, { ...gps, recordedAt: ago(-1) }]) {
    const result = await location({ location: observation, lastHeartbeatAt: 'bad-time' });
    const reply = formatLocationReply(result);
    assert.match(reply, /No usable recorded location/);
    assert.match(reply, /Watch offline · check-in time unavailable/);
    assert.doesNotMatch(reply, /maps\.google|GPS location|Last updated/);
  }
});

test('battery and heartbeat ages remain independent of the selected location', async () => {
  const result = await location({ location: network, lastSatelliteLocation: gps,
    lastHeartbeatAt: ago(1).toISOString(), batteryUpdatedAt: ago(180), batteryPercent: 80 });
  const reply = formatLocationReply(result);
  assert.match(reply, /Recorded 2 hours ago/);
  assert.match(reply, /Watch online · last check-in 1 minute ago/);
  assert.match(reply, /Battery last reported 80% 3 hours ago\. This reading may be stale/);
});

test('long display labels do not crowd out source, uncertainty or the single map link', async () => {
  const result = await location({ nickname: 'Wearer '.repeat(80),
    lastSatelliteLocation: { ...gps, placeLabel: 'Test area '.repeat(100) },
    location: network, batteryPercent: 80, batteryUpdatedAt: ago(120) });
  const reply = formatLocationReply(result);
  assert.ok(reply.length < 1000, reply.length);
  assert.match(reply, /Current position unconfirmed/);
  assert.equal((reply.match(/https:/g) || []).length, 1);
});

test('a missing linked watch returns an error and cannot expose another watch', async () => {
  const result = await getLastLocation({ devices: [{ imei: 'TEST-A', location: gps }] }, { imei: 'TEST-B' }, { now });
  assert.ok(result.error);
  assert.doesNotMatch(formatLocationReply(result), /maps\.google|TEST-A|TEST-B/);
});

test('display labels cannot insert another map or disclose a hardware identifier', async () => {
  const result = await location({ nickname: 'Test 123456789012345',
    location: { ...gps, placeLabel: 'Test area\nhttps://maps.google.com/?q=1,2' } });
  const reply = formatLocationReply(result);
  assert.equal((reply.match(/https:/g) || []).length, 1);
  assert.doesNotMatch(reply, /123456789012345|\?q=1,2/);
  assert.match(reply, /\?q=-20.25,57.5/);
});
