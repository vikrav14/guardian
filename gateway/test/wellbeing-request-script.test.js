'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRequestPayload } = require('../scripts/request-wellbeing-reading');

const base = {
  imei: '000000000000001',
  metricSet: 'heart_rate_blood_pressure',
};

test('request script builds hourly, acceptance-test and stop operations', () => {
  assert.deepEqual(buildRequestPayload({ ...base, scheduleSeconds: '3600', stop: false }), {
    ...base, action: 'schedule', intervalSeconds: 3600,
  });
  assert.deepEqual(buildRequestPayload({ ...base, scheduleSeconds: '300', stop: false }), {
    ...base, action: 'schedule', intervalSeconds: 300,
  });
  assert.deepEqual(buildRequestPayload({ ...base, scheduleSeconds: null, stop: true }), {
    ...base, action: 'stop',
  });
});

test('request script rejects unsafe schedule arguments', () => {
  assert.throws(
    () => buildRequestPayload({ ...base, scheduleSeconds: '299', stop: false }),
    /300 to 65535/,
  );
  assert.throws(
    () => buildRequestPayload({ ...base, scheduleSeconds: '3600', stop: true }),
    /either --stop or --schedule-seconds/,
  );
});
