'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReport } = require('../scripts/inspect-profile-weather');
const now = new Date('2026-09-17T20:30:00Z');
const config = { openWeatherMapKey: 'private-key-must-never-be-printed' };

test('weather diagnostics show actual stale location age without exposing keys', () => {
  const recordedAt = new Date(+now - 75 * 60_000);
  const report = buildReport({ now, config,
    device: { lastHeartbeatAt: now, lastSatelliteLocation: {
      lat: -20.028, lng: 57.596, recordedAt: { toDate: () => recordedAt },
    } },
    weather: { state: 'unavailable', reason: 'location_stale_or_undated',
      fetchedAt: '2026-09-17T20:16:15.969Z' },
  });
  assert.equal(report.selectedLocation.ageMinutes, 75);
  assert.equal(report.selectedLocation.rejectionReason, 'location_stale_or_undated');
  assert.equal(report.locations.lastSatellite.observedAt, recordedAt.toISOString());
  assert.equal(report.storedWeather.fetchedAt, '2026-09-17T20:16:15.969Z');
  assert.equal(report.weatherKeyConfiguredHere, true);
  assert.equal(report.configurationSource, 'this_command_environment_not_running_gateway');
  assert.doesNotMatch(JSON.stringify(report), /private-key-must-never-be-printed/);
});

test('weather diagnostics distinguish missing records and undated coordinates', () => {
  const missing = buildReport({ now, config: {}, device: null, weather: null });
  assert.equal(missing.deviceFound, false);
  assert.equal(missing.storedWeather.exists, false);
  assert.equal(missing.weatherKeyConfiguredHere, false);
  assert.equal(missing.selectedLocation.rejectionReason, 'location_unavailable');

  const undated = buildReport({ now, config, weather: null,
    device: { lastHeartbeatAt: now, location: { lat: -20.028, lng: 57.596, source: 'wifi' } },
  });
  assert.equal(undated.locations.currentLocation.validCoordinates, true);
  assert.equal(undated.locations.currentLocation.ageMinutes, null);
  assert.equal(undated.selectedLocation.rejectionReason, 'location_stale_or_undated');
});
