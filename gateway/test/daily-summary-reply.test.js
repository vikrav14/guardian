const test = require('node:test');
const assert = require('node:assert/strict');
const { formatDailySummaryReply } = require('../src/daily-summary-reply');

test('daily summary renders only supplied factual aggregates', () => {
  const reply = formatDailySummaryReply({
    name: 'Jesh',
    periodLabel: 'today',
    journeyCount: 2,
    distanceKm: 30.24,
    criticalAlertCount: 0,
    safeZoneEventCount: 2,
    batteryPercent: 69,
    batteryAgeSeconds: 120,
    batteryStale: false,
    online: true,
  });
  assert.match(reply, /Jesh — today/);
  assert.match(reply, /2 confirmed journeys · 30\.2 km/);
  assert.match(reply, /2 safe-zone updates · no SOS\/fall alerts/);
  assert.match(reply, /battery last reported 69% 2 minutes ago/);
});

test('daily summary qualifies stale offline battery', () => {
  const reply = formatDailySummaryReply({
    name: 'Mum',
    periodLabel: 'yesterday',
    journeyCount: 0,
    distanceKm: 0,
    criticalAlertCount: 0,
    safeZoneEventCount: 0,
    batteryPercent: 40,
    batteryAgeSeconds: 7200,
    batteryStale: true,
    online: false,
  });
  assert.match(reply, /Watch offline/);
  assert.match(reply, /last reported 40% 2 hours ago/);
  assert.match(reply, /may be stale/);
});

test('daily summary never fabricates missing data', () => {
  const reply = formatDailySummaryReply({
    name: 'Jesh',
    periodLabel: 'today',
    journeyCount: 0,
    criticalAlertCount: 0,
    safeZoneEventCount: 0,
    batteryPercent: null,
    online: false,
  });
  assert.match(reply, /No confirmed journeys recorded/);
  assert.match(reply, /no battery reading available/);
  assert.doesNotMatch(reply, /\d+%/);
});

test('daily summary qualifies incomplete alert coverage', () => {
  const reply = formatDailySummaryReply({
    name: 'Jesh',
    periodLabel: 'today',
    journeyCount: 0,
    criticalAlertCount: 0,
    safeZoneEventCount: 0,
    alertCoverageComplete: false,
    batteryPercent: null,
    online: false,
  });
  assert.match(reply, /most recent checked records/);
  assert.doesNotMatch(reply, /No SOS, fall, or safe-zone alerts recorded/);
});
