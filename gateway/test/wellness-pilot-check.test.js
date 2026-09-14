'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEvidence, buildReport } = require('../scripts/inspect-wellness-pilot');

const now = new Date('2026-09-14T21:00:00Z');
const consent = { version: 1, status: 'granted', managedBy: 'guardian_admin',
  wearerAcknowledgedAt: new Date('2026-09-14T10:00:00Z') };
const reading = at => ({ metricSet: 'spo2', observedAt: new Date(at), displayable: false,
  values: { spo2Percent: 98 }, imei: '999999999999999' });

test('pilot summary distinguishes stale evidence, unverified data and schedule uncertainty', () => {
  const report = buildReport({ consent, readings: [
    reading('2026-09-14T18:00:00Z'), reading('2026-09-14T19:00:00Z'),
    reading('2026-09-12T19:00:00Z'), reading('2026-09-15T19:00:00Z'),
  ], device: { online: true, lastHeartbeatAt: new Date('2026-09-14T19:00:00Z'),
    stepsRaw: 103, activityUpdatedAt: new Date('2026-09-14T19:00:00Z') },
  activityDays: [{ localDate: '2026-09-14', reportedSteps: 103, displayable: false }] },
  { adminApiKey: 'secret-fixture', wifiHomePilotImei: '999999999999999' }, now);
  assert.equal(report.watch.freshHeartbeat, false);
  assert.equal(report.activity.counterAgeSeconds, 7200);
  assert.equal(report.activity.days[0].reportedSteps, null);
  assert.equal(report.wellbeing.scheduleState, 'not_proven_by_uploads');
  const oxygen = report.wellbeing.metrics.find(metric => metric.metricSet === 'spo2');
  assert.equal(oxygen.uploads, 2);
  assert.equal(oxygen.maximumGapSeconds, 3600);
  assert.equal(oxygen.displayableUploads, 0);
  assert.equal(report.wellbeing.metrics.find(metric => metric.metricSet === 'heart_rate_blood_pressure').lastUploadAt, null);
  assert.doesNotMatch(JSON.stringify(report), /secret-fixture|999999999999999|spo2Percent/);
});

function database({ initialConsent = consent, finalConsent = consent } = {}) {
  const reads = [], clauses = [];
  let consentReads = 0;
  const ref = path => ({
    collection: name => ref(`${path}/${name}`), doc: name => ref(`${path}/${name}`),
    where: (...args) => { clauses.push(['where', ...args]); return ref(path); },
    orderBy: (...args) => { clauses.push(['orderBy', ...args]); return ref(path); },
    limit: value => { clauses.push(['limit', value]); return ref(path); },
    get: async () => {
      reads.push(path);
      if (path.startsWith('wellbeingConsents/')) {
        const value = ++consentReads === 1 ? initialConsent : finalConsent;
        return { exists: value != null, data: () => value };
      }
      if (path.endsWith('/wellbeingReadings')) return {
        docs: Array.from({ length: 501 }, () => ({ data: () => reading('2026-09-14T19:00:00Z') })),
      };
      return { exists: true, data: () => ({}) };
    },
  });
  return { collection: name => ref(name), reads, clauses };
}

test('read-only check reads two Mauritius dates and skips health history without valid consent', async () => {
  const db = database({ initialConsent: null });
  const evidence = await loadEvidence(db, '999999999999999', now);
  assert.deepEqual(evidence.readings, []);
  assert.equal(db.reads.some(path => path.endsWith('/wellbeingReadings')), false);
  assert.deepEqual(db.reads.filter(path => path.includes('/activityDays/')), [
    'devices/999999999999999/activityDays/2026-09-15',
    'devices/999999999999999/activityDays/2026-09-14',
  ]);
});

test('upload query is bounded and reports truncation instead of claiming a complete trial', async () => {
  const db = database();
  const evidence = await loadEvidence(db, '999999999999999', now);
  assert.equal(evidence.readings.length, 500);
  assert.equal(evidence.truncated, true);
  assert.deepEqual(db.clauses, [
    ['where', 'observedAt', '>=', new Date('2026-09-13T20:00:00Z')],
    ['orderBy', 'observedAt', 'desc'], ['limit', 501],
  ]);
});

test('consent revocation during the query suppresses reading evidence', async () => {
  const db = database({ finalConsent: { ...consent, status: 'revoked' } });
  const evidence = await loadEvidence(db, '999999999999999', now);
  assert.deepEqual(evidence.readings, []);
  const report = buildReport(evidence, {}, now);
  assert.equal(report.wellbeing.consentValid, false);
  assert.equal(report.wellbeing.readingsTruncated, false);
  assert.ok(report.wellbeing.metrics.every(metric => metric.uploads === 0));
});
