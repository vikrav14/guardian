'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { trackJourneyPoint, forceCloseJourney, shouldAcceptJourneyPoint } = require('../src/journey-builder');
const { recoverGpsHistory, pointsFromJourney } = require('../src/journey-history-recovery');

const start = Date.parse('2026-09-01T06:45:00Z');
const point = (minute, lat) => ({ lat, lng: 57.5, recordedAt: new Date(start + minute * 60000),
  source: 'gps', accuracySource: 'gps', gpsValid: true, speedKmh: 50 });
const points = () => [point(0, -20.25), point(10, -20.19), point(20, -20.12), point(30, -20.06)];
const zones = [{ id: 'home', center: { lat: -20.25, lng: 57.5 }, radiusMeters: 50 }];

test('ten-minute motorway reports retain the Home anchor and every recorded fix in the live journey', () => {
  const state = {};
  const route = points();
  trackJourneyPoint(state, route[0], route[0].recordedAt,
    { hasActiveSafeZones: true, insideAnySafeZone: true, insideSafeZoneIds: ['home'] });
  state.lastPersistedLocation = route[0];
  const result = trackJourneyPoint(state, route[1], route[1].recordedAt,
    { geofenceTransition: true, transitionType: 'geofence_exit', geofenceId: 'home',
      geofenceName: 'Home', hasActiveSafeZones: true });
  assert.equal(result.started, true);
  for (const p of route.slice(2)) trackJourneyPoint(state, p, p.recordedAt);
  const saved = forceCloseJourney(state, route.at(-1).recordedAt);
  assert.equal(saved.pointCount, 4);
  assert.equal(+saved.startAt, start);
  assert.equal(+saved.departureAt, +route[1].recordedAt);
  assert.equal(saved.routeGaps.length, 3);
  assert.equal(saved.distanceKm, 0, 'unobserved road distance must not be invented');
});

test('an entirely sparse trip survives recovery even when all connecting intervals are gaps', () => {
  const recovered = recoverGpsHistory(points(), { zones });
  assert.equal(recovered.rejectedPoints, 0);
  assert.equal(recovered.journeys.length, 1);
  const saved = recovered.journeys[0];
  assert.equal(saved.pointCount, 4);
  assert.equal(+saved.startAt, start);
  assert.equal(saved.distanceKm, 0);
  assert.equal(saved.routeCoverage.interrupted, true);
  assert.deepEqual(pointsFromJourney(saved).map(p => +p.recordedAt), points().map(p => +p.recordedAt));
});

test('elapsed-time validation still rejects impossible GPS jumps and cannot be relaxed by Wi-Fi or missing timestamps', () => {
  const home = point(0, -20.25);
  assert.equal(shouldAcceptJourneyPoint(home, home), true, 'Home resume can seed its own fresh baseline');
  assert.equal(shouldAcceptJourneyPoint(point(10, -20.19), home), true);
  assert.equal(shouldAcceptJourneyPoint(point(0.1, -20.19), home), false);
  assert.equal(shouldAcceptJourneyPoint({ ...point(10, -20.19), source: 'wifi', accuracySource: 'wifi', gpsValid: false }, home), false);
  assert.equal(shouldAcceptJourneyPoint({ ...point(10, -20.19), recordedAt: undefined }, home), false);
  assert.equal(shouldAcceptJourneyPoint(point(0, -20.19), home), false);
});
