const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SOS_TEMPLATE_LANGUAGE,
  prepareSosWhatsApp,
  renderSosFallbackText,
  sendPreparedSosWhatsApp,
  callbackTemplatesEnabledForDevice,
} = require('../src/sos-whatsapp');

const now = new Date('2026-08-13T00:00:00.000Z');

function device(recordedAt, overrides = {}) {
  return {
    nickname: 'Jesh',
    online: true,
    lastHeartbeatAt: new Date('2026-08-12T23:59:00.000Z'),
    batteryPercent: 63,
    accuracySource: 'gps',
    location: {
      lat: -20.1609,
      lng: 57.5012,
      placeLabel: 'Lower Vale',
      recordedAt,
    },
    ...overrides,
  };
}

function providerWith(text, counter = null) {
  return {
    async complete() {
      if (counter) counter.calls += 1;
      return {
        content: [{ type: 'text', text }],
        usage: { input_tokens: 30, output_tokens: 15 },
        provider: 'gemini',
        latencyMs: 20,
      };
    },
  };
}

test('SOS templates use English language code selected in Meta', () => {
  assert.equal(SOS_TEMPLATE_LANGUAGE, 'en');
});

test('callback templates require an exact private pilot IMEI and SIM match', () => {
  const pilot = {
    metaWhatsAppSosCallbackPilotImei: '999999999999999',
    metaWhatsAppSosCallbackPilotNumber: '+230 5000 0000',
  };
  const matching = device(now, {
    imei: '999999999999999',
    simNumber: '+23050000000',
  });

  assert.equal(callbackTemplatesEnabledForDevice(matching, pilot), true);
  assert.equal(
    callbackTemplatesEnabledForDevice(
      { ...matching, imei: '999999999999998' },
      pilot
    ),
    false
  );
  assert.equal(
    callbackTemplatesEnabledForDevice(
      { ...matching, simNumber: '+23059999999' },
      pilot
    ),
    false
  );
  assert.equal(callbackTemplatesEnabledForDevice(matching, {}), false);
});

test('fresh SOS prepares exact Meta template with human narration', async () => {
  const prepared = await prepareSosWhatsApp({
    device: device(new Date('2026-08-12T23:58:00.000Z')),
    alert: { type: 'sos', eventAt: now },
    now,
    provider: providerWith(
      'Jesh triggered an SOS and may need your attention now. Please check on Jesh.'
    ),
  });

  assert.equal(prepared.composeResult.source, 'llm');
  assert.equal(prepared.plan.locationState, 'fresh');
  assert.equal(prepared.plan.templateName, 'guardian_sos_alert');
  assert.equal(prepared.plan.bodyParameters.length, 4);
  assert.equal(prepared.plan.buttonUrlParameter, '-20.1609,57.5012');
});

test('last-known SOS prepares exact last-location Meta template', async () => {
  const prepared = await prepareSosWhatsApp({
    device: device(new Date('2026-08-12T23:22:00.000Z')),
    alert: { type: 'sos', eventAt: now },
    now,
    provider: null,
  });

  assert.equal(prepared.plan.locationState, 'last_known');
  assert.equal(
    prepared.plan.templateName,
    'guardian_sos_last_location_v1'
  );
  assert.match(prepared.plan.bodyParameters[2], /recorded 38 mins ago/);
  assert.equal(prepared.plan.buttonUrlParameter, '-20.1609,57.5012');
});

test('unavailable SOS prepares exact no-location Meta template with no button', async () => {
  const prepared = await prepareSosWhatsApp({
    device: device(null, {
      location: null,
      accuracySource: null,
    }),
    alert: { type: 'sos', eventAt: now },
    now,
    provider: null,
  });

  assert.equal(prepared.plan.locationState, 'unavailable');
  assert.equal(
    prepared.plan.templateName,
    'guardian_sos_unavailable_v1'
  );
  assert.equal(prepared.plan.buttonUrlParameter, null);
  assert.equal(prepared.plan.components.length, 1);
});

test('callback SOS prepares approved call-watch template contract', async () => {
  const prepared = await prepareSosWhatsApp({
    device: device(new Date('2026-08-12T23:58:00.000Z')),
    alert: { type: 'sos', eventAt: now },
    now,
    provider: providerWith('This text must not control the emergency action.'),
    callbackTemplatesEnabled: true,
  });

  assert.equal(
    prepared.plan.templateName,
    'guardian_sos_callback_alert_v1'
  );
  assert.equal(prepared.plan.callButtonIncluded, true);
  assert.equal(prepared.plan.components[1].sub_type, 'url');
  assert.equal(prepared.plan.components[1].index, '1');
  assert.match(prepared.plan.bodyParameters[0], /Please call Jesh's watch now/);
  assert.doesNotMatch(prepared.plan.bodyParameters[0], /must not control/);
});

test('prepared SOS can fan out to multiple contacts with only one LLM call', async () => {
  const counter = { calls: 0 };
  const prepared = await prepareSosWhatsApp({
    device: device(new Date('2026-08-12T23:58:00.000Z')),
    alert: { type: 'sos', eventAt: now },
    now,
    provider: providerWith(
      'Jesh triggered an SOS. Please check on Jesh now.',
      counter
    ),
  });

  const sends = [];
  const sendTemplate = async (to, templateName, options) => {
    sends.push({ to, templateName, options });
    return { ok: true, provider: 'meta', messageId: `wamid.${sends.length}` };
  };

  await sendPreparedSosWhatsApp('+23057111111', prepared, { sendTemplate });
  await sendPreparedSosWhatsApp('+23057222222', prepared, { sendTemplate });

  assert.equal(counter.calls, 1);
  assert.equal(sends.length, 2);
  assert.equal(sends[0].templateName, 'guardian_sos_alert');
  assert.equal(sends[0].options.languageCode, 'en');
  assert.equal(sends[0].options.components.length, 2);
});

test('Meta failure remains failed and never invokes another WhatsApp provider', async () => {
  const prepared = await prepareSosWhatsApp({
    device: device(new Date('2026-08-12T23:58:00.000Z')),
    alert: { type: 'sos', eventAt: now },
    now,
    provider: null,
  });

  const result = await sendPreparedSosWhatsApp(
    '+23057111111',
    prepared,
    {
      sendTemplate: async () => ({
        ok: false,
        provider: 'meta',
        status: 400,
        error: 'template not approved',
      }),
    }
  );

  assert.equal(result.ok, false);
  assert.equal(result.transport, 'meta');
  assert.equal(result.fallbackUsed, false);
  assert.equal(result.error, 'template not approved');
});

test('last-known fallback text never presents old location as current', async () => {
  const prepared = await prepareSosWhatsApp({
    device: device(new Date('2026-08-12T23:22:00.000Z')),
    alert: { type: 'sos', eventAt: now },
    now,
    provider: null,
  });

  const text = renderSosFallbackText(prepared);
  assert.match(text, /Last known location:/);
  assert.match(text, /38 mins ago/);
  assert.match(text, /View last known location:/);
});

test('unavailable fallback text has no map link', async () => {
  const prepared = await prepareSosWhatsApp({
    device: device(null, { location: null, accuracySource: null }),
    alert: { type: 'sos', eventAt: now },
    now,
    provider: null,
  });

  const text = renderSosFallbackText(prepared);
  assert.match(text, /Current location unavailable/);
  assert.doesNotMatch(text, /maps\.google/);
  assert.doesNotMatch(text, /View location:/);
});
