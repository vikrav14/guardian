'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { capture, iso } = require('../scripts/capture-journey-versions');
const { parseArgs, recoverStoredWindow } = require('../scripts/recover-journey-history');
const config = require('../src/config');

test('historical snapshot capture preserves stored lat/lng and source time, not read time', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guardian-version-capture-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filename = path.join(dir, 'capture.json');
  const sourceAt = new Date('2026-09-01T10:00:00Z');
  const p = { source: 'gps', gpsValid: true, lat: -20.25, lng: 57.5, recordedAt: { toDate: () => sourceAt } };
  const options = [];
  const db = { collection: () => ({ doc: () => ({}) }), runTransaction: async (_fn, option) => {
    options.push(option);
    return { data: () => ({ lastSatelliteLocation: p, location: p }), updateTime: option.readTime };
  } };
  const result = await capture(db, '123456789012345', new Date('2026-09-01T11:00:00Z'), new Date('2026-09-01T11:00:05Z'), filename);
  const saved = JSON.parse(fs.readFileSync(filename));
  assert.equal(result.snapshotsRead, 6); assert.equal(saved.points.length, 1);
  assert.equal(saved.points[0].recordedAt, sourceAt.toISOString());
  assert.equal(saved.points[0].lat, p.lat);
  assert.ok(options.every(o => o.readOnly === true));
  assert.equal(iso(null), null);
});

test('recovery defaults to preview and validates the time window and capture provenance', async () => {
  const values = ['--imei', '123456789012345', '--from', '2026-09-01T10:00:00Z', '--to', '2026-09-01T11:00:00Z'];
  const args = parseArgs(values);
  assert.equal(args.apply, false);
  assert.equal(parseArgs([...values, '--apply']).apply, true);
  assert.throws(() => parseArgs(values.slice(0, 4)), /Supply/);
  assert.throws(() => parseArgs([...values, '--unknown', 'yes']), /Use/);
  const empty = { size: 0, docs: [] };
  const query = { where: () => query, orderBy: () => query, limit: () => query, get: async () => empty,
    doc: () => ({ collection: () => query, get: async () => ({ data: () => ({}) }) }) };
  const db = { collection: () => query };
  const result = await recoverStoredWindow(db, args);
  assert.equal(result.outcome, 'original_timestamps_or_route_evidence_unavailable');
  await assert.rejects(recoverStoredWindow(db, args, { capture: { version: 1, kind: 'firestore_document_versions',
    imei: '987654321098765', projectId: config.firebaseProjectId, points: [] } }), /provenance/);
});
