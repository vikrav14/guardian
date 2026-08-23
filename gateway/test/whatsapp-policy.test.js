const test = require('node:test');
const assert = require('node:assert/strict');

const {
  AUDIO_CHECKIN_DISABLED_REPLY,
  SCOPE_REPLY,
  decideInboundRoute,
  decideProactiveWhatsApp,
} = require('../src/whatsapp-policy');

test('functional Guardian intents may use the assistant', () => {
  for (const type of [
    'LOCATION_REQUEST',
    'DEVICE_STATUS',
    'RECENT_ALERTS',
    'JOURNEY_QUERY',
    'DAILY_SUMMARY',
    'DEVICE_COMMAND',
    'REMINDER_REQUEST',
    'SAFE_ZONE_CHECK',
    'WEATHER_QUERY',
  ]) {
    const decision = decideInboundRoute({ type });
    assert.equal(decision.route, 'guardian', type);
    assert.equal(decision.allowAssistant, true, type);
    assert.equal(decision.reply, null, type);
  }
});

test('voice-monitor requests are blocked deterministically without the assistant', () => {
  const decision = decideInboundRoute({ type: 'VOICE_MONITOR' });
  assert.equal(decision.route, 'safety_block');
  assert.equal(decision.allowAssistant, false);
  assert.equal(decision.reply, AUDIO_CHECKIN_DISABLED_REPLY);
  assert.equal(decision.reason, 'audio_checkin_disabled');
});

test('unclear/general messages get one deterministic scope response', () => {
  for (const type of ['UNCLEAR', 'GENERAL_HELP', 'EMPTY', 'SOMETHING_NEW']) {
    const decision = decideInboundRoute({ type });
    assert.equal(decision.route, 'scope_reply');
    assert.equal(decision.allowAssistant, false);
    assert.equal(decision.reply, SCOPE_REPLY);
  }
});

test('critical intent stays on the non-LLM safety path', () => {
  const decision = decideInboundRoute({ type: 'CRITICAL' });
  assert.equal(decision.route, 'critical');
  assert.equal(decision.allowAssistant, false);
});

test('SOS is always WhatsApp P0 with rich context requirements', () => {
  const decision = decideProactiveWhatsApp({ type: 'sos' });
  assert.equal(decision.sendWhatsApp, true);
  assert.equal(decision.priority, 'P0');
  assert.equal(decision.templateKey, 'guardian_sos_v1');
  assert.ok(decision.requiredContext.includes('mapsUrl'));
  assert.ok(decision.requiredContext.includes('batteryPercent'));
  assert.ok(decision.requiredContext.includes('locationFreshness'));
});

test('confirmed fall is always WhatsApp P0', () => {
  const decision = decideProactiveWhatsApp({
    type: 'fall',
    confirmed: true,
  });
  assert.equal(decision.sendWhatsApp, true);
  assert.equal(decision.priority, 'P0');
});

test('ordinary safe-zone exit remains app-only', () => {
  const decision = decideProactiveWhatsApp({
    type: 'safe_zone_exit',
    profileType: 'child',
    unexpected: false,
  });
  assert.equal(decision.sendWhatsApp, false);
  assert.equal(decision.channel, 'app');
});

test('unexpected child school departure is WhatsApp P1', () => {
  const decision = decideProactiveWhatsApp({
    type: 'safe_zone_exit',
    profileType: 'child',
    unexpected: true,
  });
  assert.equal(decision.sendWhatsApp, true);
  assert.equal(decision.priority, 'P1');
  assert.equal(decision.templateKey, 'guardian_child_unexpected_departure_v1');
});

test('missed child arrival is WhatsApp only when actually flagged as missed', () => {
  assert.equal(
    decideProactiveWhatsApp({
      type: 'missed_expected_arrival',
      profileType: 'child',
      missedExpectedArrival: false,
    }).sendWhatsApp,
    false
  );

  assert.equal(
    decideProactiveWhatsApp({
      type: 'missed_expected_arrival',
      profileType: 'child',
      missedExpectedArrival: true,
    }).sendWhatsApp,
    true
  );
});

test('offline watch escalates only while away and after 15 minutes', () => {
  assert.equal(
    decideProactiveWhatsApp({
      type: 'watch_offline',
      awayFromSafeZone: false,
      offlineMinutes: 30,
    }).sendWhatsApp,
    false
  );

  assert.equal(
    decideProactiveWhatsApp({
      type: 'watch_offline',
      awayFromSafeZone: true,
      offlineMinutes: 10,
    }).sendWhatsApp,
    false
  );

  const decision = decideProactiveWhatsApp({
    type: 'watch_offline',
    awayFromSafeZone: true,
    offlineMinutes: 15,
  });
  assert.equal(decision.sendWhatsApp, true);
  assert.equal(decision.reason, 'offline_while_away');
});

test('critical battery escalates only while away', () => {
  assert.equal(
    decideProactiveWhatsApp({
      type: 'critical_battery',
      awayFromSafeZone: false,
      batteryPercent: 8,
    }).sendWhatsApp,
    false
  );

  assert.equal(
    decideProactiveWhatsApp({
      type: 'critical_battery',
      awayFromSafeZone: true,
      batteryPercent: 25,
    }).sendWhatsApp,
    false
  );

  assert.equal(
    decideProactiveWhatsApp({
      type: 'critical_battery',
      awayFromSafeZone: true,
      batteryPercent: 15,
    }).sendWhatsApp,
    true
  );
});

test('elderly unusual late departure can escalate but routine departure does not', () => {
  assert.equal(
    decideProactiveWhatsApp({
      type: 'safe_zone_exit',
      profileType: 'elderly',
      unusual: false,
    }).sendWhatsApp,
    false
  );

  const decision = decideProactiveWhatsApp({
    type: 'safe_zone_exit',
    profileType: 'elderly',
    unusual: true,
  });
  assert.equal(decision.sendWhatsApp, true);
  assert.equal(decision.templateKey, 'guardian_elderly_unusual_departure_v1');
});

test('environmental alert must be serious and actually affect the wearer', () => {
  assert.equal(
    decideProactiveWhatsApp({
      type: 'environmental_danger',
      severity: 'high',
      affectsWearer: false,
    }).sendWhatsApp,
    false
  );

  assert.equal(
    decideProactiveWhatsApp({
      type: 'environmental_danger',
      severity: 'low',
      affectsWearer: true,
    }).sendWhatsApp,
    false
  );

  assert.equal(
    decideProactiveWhatsApp({
      type: 'environmental_danger',
      severity: 'severe',
      affectsWearer: true,
    }).sendWhatsApp,
    true
  );
});
