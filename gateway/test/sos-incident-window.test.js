const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SOS_INCIDENT_WINDOW_MS,
  claimSosIncident,
  resetSosIncidentWindowForTests,
} = require('../src/sos-incident-window');

test.beforeEach(() => resetSosIncidentWindowForTests());

test('first wearer SOS packet opens an incident', () => {
  assert.deepEqual(claimSosIncident('359633100123456', { nowMs: 1_000 }), {
    accepted: true,
    reason: null,
    elapsedMs: null,
    retryAfterMs: 0,
  });
});

test('repeated SOS packets are collapsed for 90 seconds', () => {
  claimSosIncident('359633100123456', { nowMs: 1_000 });
  const duplicate = claimSosIncident('359633100123456', { nowMs: 60_000 });

  assert.equal(SOS_INCIDENT_WINDOW_MS, 90_000);
  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.reason, 'duplicate_sos_packet');
  assert.equal(duplicate.elapsedMs, 59_000);
  assert.equal(duplicate.retryAfterMs, 31_000);
});

test('a new SOS after the incident window is accepted', () => {
  claimSosIncident('359633100123456', { nowMs: 1_000 });
  assert.equal(
    claimSosIncident('359633100123456', { nowMs: 91_000 }).accepted,
    true
  );
});

test('suppression is isolated per watch and recovers from clock rollback', () => {
  claimSosIncident('A', { nowMs: 100_000 });
  assert.equal(claimSosIncident('B', { nowMs: 100_100 }).accepted, true);
  assert.equal(claimSosIncident('A', { nowMs: 50_000 }).accepted, true);
});
