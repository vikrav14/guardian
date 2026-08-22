const test = require('node:test');
const assert = require('node:assert/strict');

const config = require('../src/config');
const {
  deliveryIdFor,
  eligibleVoiceRecipients,
  ingestSosVoiceMessage,
  deliverSosVoiceButton,
} = require('../src/sos-voice-messages');

function oneFrameAmr() {
  const frame = Buffer.alloc(13, 0);
  frame[0] = 0x04;
  return Buffer.concat([Buffer.from('#!AMR\n', 'ascii'), frame]);
}

function fakeFirestore(seed = {}) {
  const records = new Map(Object.entries(seed));

  function refFor(path) {
    return {
      id: path.split('/').at(-1),
      path,
      async get() {
        return snapshot(path);
      },
      async set(value, options = {}) {
        const existing = records.get(path) || {};
        records.set(path, options.merge ? { ...existing, ...value } : { ...value });
      },
      async delete() {
        records.delete(path);
      },
    };
  }

  function snapshot(path) {
    const value = records.get(path);
    return {
      id: path.split('/').at(-1),
      exists: value != null,
      data: () => value,
      ref: refFor(path),
    };
  }

  function queryFor(collectionName, filters = [], limitValue = Infinity) {
    return {
      where(field, operator, value) {
        return queryFor(collectionName, [...filters, { field, operator, value }], limitValue);
      },
      orderBy() {
        return this;
      },
      limit(value) {
        return queryFor(collectionName, filters, value);
      },
      async get() {
        const prefix = `${collectionName}/`;
        const docs = [...records.entries()]
          .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
          .map(([path]) => snapshot(path))
          .filter((doc) => filters.every(({ field, operator, value }) => {
            const actual = doc.data()?.[field];
            if (operator === '==') return actual === value;
            if (operator === '<=') return actual <= value;
            throw new Error(`Unsupported fake operator ${operator}`);
          }))
          .sort((a, b) => {
            const left = a.data()?.createdAt?.getTime?.() || 0;
            const right = b.data()?.createdAt?.getTime?.() || 0;
            return right - left;
          })
          .slice(0, limitValue);
        return { docs };
      },
    };
  }

  return {
    records,
    collection(name) {
      return {
        doc(id) {
          return refFor(`${name}/${id}`);
        },
        ...queryFor(name),
      };
    },
  };
}

function fakeBucket() {
  const files = new Map();
  return {
    files,
    file(path) {
      return {
        async save(content, options) {
          files.set(path, { content: Buffer.from(content), options });
        },
        async download() {
          const item = files.get(path);
          if (!item) throw new Error('object_not_found');
          return [Buffer.from(item.content)];
        },
        async delete() {
          files.delete(path);
        },
      };
    },
  };
}

function familyEntitlements() {
  return {
    serviceActive: true,
    features: ['sos_voice_messages', 'whatsapp_safety_alerts'],
  };
}

test('eligible voice recipients require Family voice and WhatsApp safety entitlements', () => {
  const recipients = eligibleVoiceRecipients([
    { phone: '+15550000001', entitlements: familyEntitlements() },
    { phone: '+15550000002', entitlements: { serviceActive: true, features: ['sos_alerts'] } },
    { phone: '+15550000001', entitlements: familyEntitlements() },
  ]);
  assert.deepEqual(recipients.map((item) => item.target), ['15550000001']);
});

test('SOS voice ingestion fails closed while the acceptance flag is disabled', async () => {
  const result = await ingestSosVoiceMessage({
    db: fakeFirestore(),
    bucket: fakeBucket(),
    imei: '123456789012345',
    audio: oneFrameAmr(),
    enabled: false,
  });
  assert.deepEqual(result, { ok: false, reason: 'feature_disabled' });
});

test('valid AMR is rejected when it cannot be tied to an active unresolved SOS', async () => {
  const result = await ingestSosVoiceMessage({
    db: fakeFirestore(),
    bucket: fakeBucket(),
    imei: '123456789012345',
    audio: oneFrameAmr(),
    enabled: true,
  });
  assert.deepEqual(result, { ok: false, reason: 'no_active_sos' });
});

test('active SOS stores one private clip and sends recipient-bound ready template', async () => {
  const now = new Date('2026-08-23T10:00:00.000Z');
  const imei = '123456789012345';
  const db = fakeFirestore({
    'alerts/sos-1': {
      imei,
      type: 'sos',
      resolved: false,
      eventAt: new Date(now.getTime() - 10_000),
      createdAt: new Date(now.getTime() - 10_000),
    },
    [`devices/${imei}`]: { name: 'Alex watch' },
  });
  const bucket = fakeBucket();
  const sends = [];
  const previousNotify = config.notifyWhatsApp;
  const previousSecret = config.metaAppSecret;
  config.notifyWhatsApp = true;
  config.metaAppSecret = 'test-meta-app-secret';

  try {
    const result = await ingestSosVoiceMessage({
      db,
      bucket,
      imei,
      audio: oneFrameAmr(),
      now,
      enabled: true,
      findContacts: async () => [{
        name: 'Sam',
        phone: '+15550000001',
        whatsapp: '+15550000001',
        entitlements: familyEntitlements(),
      }],
      sendTemplate: async (to, name, options) => {
        sends.push({ to, name, options });
        return { ok: true, messageId: 'wamid.TEMPLATE' };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.durationMs, 20);
    assert.equal(result.readyTemplateStatus, 'accepted');
    const clip = db.records.get(`sosVoiceMessages/${result.clipId}`);
    assert.equal(clip.status, 'available');
    assert.equal(clip.alertId, 'sos-1');
    assert.equal(clip.wearerName, 'Alex');
    assert.equal(bucket.files.has(clip.storagePath), true);
    assert.equal(db.records.get('alerts/sos-1').voiceMessage.clipId, result.clipId);

    assert.equal(sends.length, 1);
    assert.equal(sends[0].name, 'guardian_sos_voice_ready_v1');
    const quickReply = sends[0].options.components[1].parameters[0].payload;
    assert.match(quickReply, /^guardian_sos_voice:/);
    assert.equal([...db.records.keys()].some((key) => key.includes(quickReply)), false);

    const delivery = [...db.records.entries()]
      .find(([key]) => key.startsWith('sosVoiceDeliveries/'))[1];
    assert.equal(delivery.clipId, result.clipId);
    assert.equal('recipientHash' in delivery, false);
    const quickReplyToken = quickReply.split(':').at(-1);
    assert.equal(
      db.records.has(
        `sosVoiceDeliveries/${deliveryIdFor(
          quickReplyToken,
          '+15550000001',
          'test-meta-app-secret',
        )}`,
      ),
      true,
    );

    let uploadedBytes = null;
    const played = await deliverSosVoiceButton({
      db,
      bucket,
      from: '+15550000001',
      buttonPayload: quickReply,
      now: new Date(now.getTime() + 60_000),
      enabled: true,
      uploadMedia: async (bytes, options) => {
        uploadedBytes = Buffer.from(bytes);
        assert.equal(options.contentType, 'audio/amr');
        return { ok: true, mediaId: 'media-1' };
      },
      sendAudio: async (to, mediaId) => {
        assert.equal(to, '+15550000001');
        assert.equal(mediaId, 'media-1');
        return { ok: true, messageId: 'wamid.AUDIO' };
      },
    });
    assert.equal(played.ok, true);
    assert.equal(played.messageId, 'wamid.AUDIO');
    assert.deepEqual(uploadedBytes, oneFrameAmr());

    const denied = await deliverSosVoiceButton({
      db,
      bucket,
      from: '+15550000009',
      buttonPayload: quickReply,
      now: new Date(now.getTime() + 60_000),
      enabled: true,
    });
    assert.deepEqual(denied, { ok: false, reason: 'playback_request_not_found' });
  } finally {
    config.notifyWhatsApp = previousNotify;
    config.metaAppSecret = previousSecret;
  }
});
