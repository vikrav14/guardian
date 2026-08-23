'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  METRIC_SET,
  normalizeWellbeingEvent,
  validConsent,
  readingIdFor,
  buildWellbeingRequestCommand,
  buildWellbeingScheduleCommand,
  createWellbeingStore,
} = require('../src/care-wellbeing');

const IMEI = '000000000000001';
const NOW = new Date('2026-08-23T14:00:00.000Z');

function consent(overrides = {}) {
  return {
    version: 1,
    status: 'granted',
    managedBy: 'guardian_admin',
    wearerAcknowledgedAt: new Date('2026-08-22T10:00:00.000Z'),
    ...overrides,
  };
}

function fakeDb({ consentData = consent(), existingIds = [] } = {}) {
  const readings = new Map(existingIds.map((id) => [id, {}]));
  return {
    readings,
    collection(name) {
      if (name === 'wellbeingConsents') {
        return {
          doc(id) {
            assert.equal(id, IMEI);
            return {
              async get() {
                return {
                  exists: consentData != null,
                  data: () => consentData,
                };
              },
            };
          },
        };
      }
      assert.equal(name, 'devices');
      return {
        doc(imei) {
          assert.equal(imei, IMEI);
          return {
            collection(subcollection) {
              assert.equal(subcollection, 'wellbeingReadings');
              return {
                doc(id) {
                  return {
                    async create(payload) {
                      if (readings.has(id)) {
                        const error = new Error('already exists');
                        error.code = 6;
                        throw error;
                      }
                      readings.set(id, payload);
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
}

test('normalizes confirmed V52 oxygen and bphrt upload shapes', () => {
  const oxygen = normalizeWellbeingEvent({
    type: 'health_reading', imei: IMEI, metric: 'spo2', value: 98, measurementType: '0',
  }, NOW);
  assert.equal(oxygen.ok, true);
  assert.equal(oxygen.metricSet, METRIC_SET.SPO2);
  assert.deepEqual(oxygen.values, { spo2Percent: 98 });

  const heart = normalizeWellbeingEvent({
    type: 'health_reading', imei: IMEI, metric: 'heart_rate_bp',
    heartRate: 72, systolic: 120, diastolic: 72,
  }, NOW);
  assert.equal(heart.ok, true);
  assert.equal(heart.metricSet, METRIC_SET.HEART_RATE_BLOOD_PRESSURE);
  assert.deepEqual(heart.values, {
    heartRateBpm: 72, systolicMmHg: 120, diastolicMmHg: 72,
  });
});

test('rejects malformed and unsupported health values without clinical interpretation', () => {
  assert.equal(normalizeWellbeingEvent({
    type: 'health_reading', imei: IMEI, metric: 'spo2', value: 0,
  }, NOW).reason, 'invalid_spo2_shape');
  assert.equal(normalizeWellbeingEvent({
    type: 'health_reading', imei: IMEI, metric: 'heart_rate_bp',
    heartRate: 72, systolic: 60, diastolic: 90,
  }, NOW).reason, 'invalid_heart_bp_shape');
  assert.equal(normalizeWellbeingEvent({
    type: 'health_reading', imei: IMEI, metric: 'temperature', value: 36.5,
  }, NOW).reason, 'unsupported_metric');
});

test('consent requires durable wearer acknowledgement and trusted management', () => {
  assert.equal(validConsent(consent(), NOW), true);
  assert.equal(validConsent(consent({ wearerAcknowledgedAt: null }), NOW), false);
  assert.equal(validConsent(consent({ managedBy: 'mobile_client' }), NOW), false);
  assert.equal(validConsent(consent({ revokedAt: NOW }), NOW), false);
  assert.equal(validConsent(consent({ expiresAt: NOW }), NOW), false);
});

test('request command is limited to the supplier-guided heart/BP pilot', () => {
  assert.equal(
    buildWellbeingRequestCommand(METRIC_SET.HEART_RATE_BLOOD_PRESSURE),
    'hrtstart,1',
  );
  assert.throws(
    () => buildWellbeingRequestCommand(METRIC_SET.SPO2),
    /No confirmed V52 request command/,
  );
});

test('scheduled wellbeing uses the proven vendor interval and explicit stop commands', () => {
  assert.equal(
    buildWellbeingScheduleCommand({ enabled: true, intervalSeconds: 3600 }),
    'hrtstart,3600',
  );
  assert.equal(
    buildWellbeingScheduleCommand({ enabled: true, intervalSeconds: 300 }),
    'hrtstart,300',
  );
  assert.equal(buildWellbeingScheduleCommand({ enabled: false }), 'hrtstart,0');
  assert.throws(
    () => buildWellbeingScheduleCommand({ enabled: true, intervalSeconds: 299 }),
    /300 to 65535/,
  );
  assert.throws(
    () => buildWellbeingScheduleCommand({ enabled: true, intervalSeconds: 65536 }),
    /300 to 65535/,
  );
});

test('store fails closed while disabled or consent is absent', async () => {
  const event = { type: 'health_reading', imei: IMEI, metric: 'spo2', value: 98 };
  const disabled = createWellbeingStore({ db: fakeDb(), now: () => NOW });
  assert.deepEqual(await disabled.ingest(event, NOW), { ok: false, status: 'disabled' });

  const noConsent = createWellbeingStore({
    db: fakeDb({ consentData: null }), enabled: true, now: () => NOW,
  });
  assert.deepEqual(await noConsent.ingest(event, NOW), {
    ok: false, status: 'consent_required', metricSet: METRIC_SET.SPO2,
  });
});

test('unverified readings persist as protected and non-displayable', async () => {
  const db = fakeDb();
  const store = createWellbeingStore({
    db, enabled: true, deviceMode: 'unverified', customerEnabled: true,
    retentionDays: 30, now: () => NOW,
  });
  const result = await store.ingest({
    type: 'health_reading', imei: IMEI, metric: 'spo2', value: 98,
  }, NOW);

  assert.equal(result.status, 'stored');
  assert.equal(result.displayable, false);
  const payload = db.readings.get(result.id);
  assert.equal(payload.quality, 'transport_valid_unverified');
  assert.equal(payload.displayable, false);
  assert.equal(payload.expiresAt.toISOString(), '2026-09-22T14:00:00.000Z');
});

test('accepted customer-enabled readings display and duplicate packets dedupe', async () => {
  const normalized = normalizeWellbeingEvent({
    type: 'health_reading', imei: IMEI, metric: 'spo2', value: 98,
  }, NOW);
  const id = readingIdFor(normalized);
  const db = fakeDb({ existingIds: [id] });
  const store = createWellbeingStore({
    db, enabled: true, deviceMode: 'accepted', customerEnabled: true, now: () => NOW,
  });

  const result = await store.ingest({
    type: 'health_reading', imei: IMEI, metric: 'spo2', value: 98,
  }, NOW);
  assert.equal(result.status, 'duplicate');
  assert.equal(result.displayable, true);
});
