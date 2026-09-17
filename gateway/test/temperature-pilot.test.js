'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { decodeFrame, handlePacket } = require('../src/protocol/gt06');
const { createWellbeingStore, normalizeWellbeingEvent, buildWellbeingRequestCommand } = require('../src/care-wellbeing');
const { parseArguments, parseCapture, importCapture } = require('../scripts/import-temperature-capture');
const { buildReport } = require('../scripts/inspect-wellness-pilot');
const { formatWellbeingReply } = require('../src/wellbeing-reply');

// Synthetic values and identity; no operator health measurements in fixtures.
const IMEI = '861000000000001';
const AT = new Date('2026-08-25T14:00:00.000Z');
const NOW = new Date(+AT + 60_000);
const granted = { version: 1, status: 'granted', managedBy: 'guardian_admin',
  wearerAcknowledgedAt: new Date(+AT - 3600_000) };
const event = (args = ['1', '34.56']) => ({ type: 'health_reading', imei: IMEI,
  metric: 'skin_temperature', sourceCommand: 'btemp2', args });
const capture = (overrides = {}) => ({ version: 1, command: 'btemp2',
  receivedAt: AT.toISOString(), timeBasis: 'gateway_receipt', fieldMeaning: 'unverified',
  args: ['1', '34.56'], ...overrides });
const text = (overrides) => JSON.stringify(capture(overrides));
function database(consent = granted) {
  const docs = new Map();
  const ref = path => ({ collection: name => ref(`${path}/${name}`), doc: id => ref(`${path}/${id}`),
    get: async () => ({ exists: consent != null, data: () => consent }),
    create: async payload => {
      if (docs.has(path)) throw Object.assign(new Error('duplicate'), { code: 6 });
      docs.set(path, payload);
    } });
  return { docs, collection: name => ref(name) };
}
const store = (db, overrides = {}) => createWellbeingStore({ db, enabled: true,
  temperaturePilotImei: IMEI, now: () => NOW, ...overrides });

test('wire upload preserves the bare ACK and decodes only the compared variant', () => {
  const payload = 'btemp2,1,34.56';
  const decoded = decodeFrame(Buffer.from(`[3G*${IMEI}*${payload.length.toString(16).padStart(4, '0')}*${payload}]`));
  const result = handlePacket(decoded, {});
  assert.equal(result.acks[0].toString(), '[SG*0000000000*0006*btemp2]');
  const reading = normalizeWellbeingEvent(result.events[0], AT);
  assert.equal(reading.ok, true);
  assert.deepEqual(reading.values, { skinTemperatureCelsius: 34.56 });
  assert.equal(reading.measurementType, null);
  assert.equal(reading.sourceVariant, '1');
  assert.equal(reading.privatePreviewOnly, true);
});

test('unknown prefixes, extra fields, sentinels and non-decimal encodings fail closed', () => {
  for (const args of [[], ['1'], ['0','34.56'], ['2','34.56'], ['1','34.56','0'],
    ['1',34.56], ['1','34.56junk'], ['1',' 34.56'], ['1','NaN'], ['1','Infinity'],
    ['1','3456'], ['1','3.456e1'], ['1','0x24'], ['1','34,56'], ['1','34.5'],
    ['1','00.00'], ['1','99.99'], ['1','-1.00'], ['1','34.567']]) {
    assert.equal(normalizeWellbeingEvent(event(args), AT).ok, false, JSON.stringify(args));
  }
  assert.equal(normalizeWellbeingEvent({ ...event(), sourceCommand: 'bodytemp2' }, AT).ok, false);
  assert.throws(() => buildWellbeingRequestCommand('skin_temperature'), /No confirmed/);
});

test('temperature requires the configured pilot, ingestion and current consent', async () => {
  for (const options of [{ temperaturePilotImei: '' }, { temperaturePilotImei: '861000000000002' }, { enabled: false }]) {
    const db = database();
    assert.equal((await store(db, options).ingest(event(), AT)).ok, false);
    assert.equal(db.docs.size, 0);
  }
  for (const consent of [null, { ...granted, status: 'revoked' }, { ...granted, expiresAt: NOW }]) {
    const db = database(consent);
    assert.equal((await store(db).ingest(event(), AT)).status, 'consent_required');
    assert.equal(db.docs.size, 0);
  }
});

test('general device acceptance and wearing proof cannot promote temperature', async () => {
  const db = database();
  const worn = { version: 1, state: 'worn', deviceAccepted: true, continuityId: 'test',
    observedAt: AT, expiresAt: new Date(+AT + 120_000) };
  const result = await store(db, { deviceMode: 'accepted', customerEnabled: true })
    .ingest({ ...event(), wearEvidence: worn }, AT);
  const data = [...db.docs.values()][0];
  assert.equal(result.displayable, false);
  assert.equal(data.deviceMode, 'unverified');
  assert.equal(data.quality, 'transport_valid_unverified');
  assert.equal(data.privatePreviewOnly, true);
  assert.equal(data.timeBasis, 'gateway_receipt_not_measurement_time');
  assert.equal(formatWellbeingReply({ readings: [data] }).includes('34.56'), false);
});

test('import is dry by default, preserves receipt time, and repeated apply is idempotent', async () => {
  const db = database();
  const opts = { db, imei: IMEI, enabled: true, now: () => NOW };
  assert.equal((await importCapture(text(), opts)).outcome, 'dry_run');
  assert.equal(db.docs.size, 0);
  assert.equal((await importCapture(text(), { ...opts, apply: true })).results[0].status, 'stored');
  assert.equal((await importCapture(text(), { ...opts, apply: true })).results[0].status, 'duplicate');
  assert.equal(db.docs.size, 1);
  const data = [...db.docs.values()][0];
  assert.equal(data.observedAt.toISOString(), AT.toISOString());
  assert.equal(data.receivedAt.toISOString(), AT.toISOString());
  assert.equal(data.wearQualified, false);
});

test('import validates all records before writes and rejects future, old and wrong captures', async () => {
  const db = database();
  for (const invalid of [text({ command: 'bodytemp2' }), text({ timeBasis: 'watch_time' }),
    text({ receivedAt: new Date(+NOW + 1).toISOString() }),
    text({ receivedAt: new Date(+NOW - 30 * 86400_000).toISOString() }),
    text({ receivedAt: 'invalid' }), text({ args: ['1','error'] }), '{}', 'null',
    Array(11).fill(text()).join('\n'), 'x'.repeat(65537), `${text()}\n${text({ args: ['0','34.56'] })}`]) {
    await assert.rejects(importCapture(invalid, { db, imei: IMEI, enabled: true, apply: true, now: () => NOW }));
  }
  assert.equal(db.docs.size, 0);
  assert.equal(parseCapture('\uFEFF' + text() + '\r\n', IMEI, { now: NOW }).length, 1);
  const result = await importCapture(text(), { db: database(null), imei: IMEI,
    enabled: true, apply: true, now: () => NOW });
  assert.equal(result.outcome, 'stopped');
  assert.equal(result.results[0].status, 'consent_required');
});

test('temperature import CLI accepts quoted paths, never enables writes implicitly', () => {
  assert.deepEqual(parseArguments(['--file', 'folder with spaces/test.jsonl']), { file: 'folder with spaces/test.jsonl', apply: false });
  assert.deepEqual(parseArguments(['--file=test.jsonl', '--apply']), { file: 'test.jsonl', apply: true });
  for (const args of [[], ['--file'], ['--file','--apply'], ['--help'], ['--file=x','--apply','--apply']]) {
    assert.throws(() => parseArguments(args));
  }
});

test('temperature diagnostics redact values by default and expose only their own field on request', () => {
  const reading = { metricSet: 'skin_temperature', observedAt: AT, displayable: false,
    values: { skinTemperatureCelsius: 34.56, unrelated: 'private' } };
  const evidence = { consent: granted, readings: [reading] };
  assert.doesNotMatch(JSON.stringify(buildReport(evidence, {}, NOW)), /34.56|unrelated/);
  const report = buildReport(evidence, {}, NOW, { includeReadingValues: true });
  const metric = report.wellbeing.metrics.find(m => m.metricSet === 'skin_temperature');
  assert.equal(metric.uploads, 1);
  assert.equal(metric.displayableUploads, 0);
  assert.deepEqual(metric.latestReadings[0].values, { skinTemperatureCelsius: 34.56 });
});
