'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createTemperatureTrialQuarantine } = require('../src/temperature-trial-quarantine');
const { createWellbeingStore } = require('../src/care-wellbeing');
const IMEI = '861000000000001';
const AT = new Date('2026-09-15T20:00:00Z');
const packet = () => ({ type: 'health_reading', metric: 'skin_temperature',
  imei: IMEI, sourceCommand: 'btemp2', args: ['1', '34.56'] });
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'guardian-temp-trial-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { directory, guard: createTemperatureTrialQuarantine({ pilotImei: IMEI, directory }) };
}

test('exclusion survives a new process object, elapsed capture and changed sessions; only explicit resume clears', t => {
  const { guard, directory } = fixture(t);
  assert.equal(guard.isSuppressed(), false);
  guard.suppress(); guard.suppress();
  const restarted = createTemperatureTrialQuarantine({ pilotImei: IMEI, directory });
  assert.equal(restarted.excludes(IMEI), true);
  assert.equal(restarted.excludes('861000000000002'), false);
  for (let i = 0; i < 30; i++) {
    const events = [packet(), { ...packet(), metric: 'heart_rate_bp' }, { type: 'alarm', imei: IMEI }];
    restarted.markEvents(events);
    assert.equal(events[0].temperatureTrialOnly, true);
    assert.equal(events[1].temperatureTrialOnly, undefined);
    assert.equal(events[2].temperatureTrialOnly, undefined);
  }
  restarted.resume(); restarted.resume();
  assert.equal(guard.isSuppressed(), false);
});

test('filesystem uncertainty blocks intake and a failed marker write cannot authorize a trial', () => {
  const denied = () => { throw Object.assign(Error('denied'), { code: 'EACCES' }); };
  const guard = createTemperatureTrialQuarantine({ pilotImei: IMEI,
    fileSystem: { statSync: denied, mkdirSync: denied, unlinkSync: denied } });
  assert.equal(guard.isSuppressed(), true);
  assert.throws(() => guard.suppress(), /denied/);
  assert.throws(() => guard.resume(), /denied/);
  assert.equal(guard.isSuppressed(), true);
});

test('off-wrist uploads never reach Firestore, including queued receipts after explicit resume', async t => {
  const { guard } = fixture(t); let writes = 0;
  const ref = { collection: () => ref, doc: () => ref,
    get: async () => ({ exists: true, data: () => ({ version: 1, status: 'granted',
      managedBy: 'guardian_admin', wearerAcknowledgedAt: new Date(+AT - 60_000) }) }),
    create: async () => { writes++; } };
  const store = createWellbeingStore({ db: ref, enabled: true,
    temperatureTrialQuarantine: guard, now: () => AT });
  guard.suppress();
  const events = [packet()]; guard.markEvents(events);
  assert.equal((await store.ingest(packet(), AT)).status, 'temperature_trial_excluded');
  guard.resume();
  assert.equal((await store.ingest(events[0], AT)).status, 'temperature_trial_excluded');
  assert.equal(writes, 0);
  assert.equal((await store.ingest(packet(), AT)).status, 'stored');
  assert.equal(writes, 1);
  guard.suppress();
  assert.equal((await store.ingest({ type: 'health_reading', metric: 'spo2', imei: IMEI,
    value: 97 }, AT)).status, 'stored');
  assert.equal(writes, 2);
});

test('exclusion is checked again when a removed trial begins during consent read', async t => {
  const { guard } = fixture(t); let writes = 0;
  const ref = { collection: () => ref, doc: () => ref,
    get: async () => { guard.suppress(); return { exists: true, data: () => ({ version: 1,
      status: 'granted', managedBy: 'guardian_admin', wearerAcknowledgedAt: new Date(+AT - 60_000) }) }; },
    create: async () => { writes++; } };
  const store = createWellbeingStore({ db: ref, enabled: true,
    temperatureTrialQuarantine: guard, now: () => AT });
  assert.equal((await store.ingest(packet(), AT)).status, 'temperature_trial_excluded');
  assert.equal(writes, 0);
});
