'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

test('incident persistence skips a repeated place lookup while retaining provenance and ordinary enrichment', async () => {
  const writes = [], calls = [];
  const modules = {
    './imei': { normalizeImei: v => v, isProtocolId: () => false, isFullImei: () => false },
    './location-provenance': require('../src/location-provenance'),
    './ops-metrics/collector': { increment: () => {} },
    './geolocate/google': { reverseGeocodeToPlaceName: async (...args) => { calls.push(args); return 'Fixture town'; } },
  };
  const sandbox = { require: name => modules[name] || {}, module: { exports: {} },
    process: { env: {} }, console: { log: (_message, json) => writes.push(JSON.parse(json)) } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/firestore.js'), 'utf8'), sandbox);
  const patch = { location: { lat: -20.2, lng: 57.2, source: 'lbs', recordedAt: new Date(), accuracyMeters: 267 }, accuracySource: 'lbs' };
  await sandbox.module.exports.upsertDevice('fixture', patch, { skipPlaceLookup: true });
  assert.equal(calls.length, 0);
  assert.equal(writes[0].location.lat, -20.2);
  assert.equal(writes[0].lastApproximateLocation.accuracyMeters, 267);
  assert.equal(Object.hasOwn(writes[0], 'skipPlaceLookup'), false);
  await sandbox.module.exports.upsertDevice('fixture', patch);
  assert.equal(calls.length, 1);
  assert.equal(writes[1].location.placeLabel, 'Fixture town');
  assert.equal(writes[1].lastApproximateLocation.placeLabel, 'Fixture town');
});
