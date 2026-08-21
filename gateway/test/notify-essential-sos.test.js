const test = require('node:test');
const assert = require('node:assert/strict');

const config = require('../src/config');
const { notifyEmergencyContacts } = require('../src/notify');

function fakeDb() {
  const subscription = {
    version: 1,
    managedBy: 'guardian_admin',
    plan: 'essential',
    status: 'active',
  };
  const user = {
    linkedImeis: ['359633100123456'],
    emergencyContacts: [
      { name: 'Backup', phone: '+23057111111' },
      {
        name: 'Primary',
        phone: '+23057222222',
        whatsapp: '+23057222222',
        isPrimary: true,
      },
    ],
  };

  return {
    collection(name) {
      if (name === 'users') {
        return {
          where() {
            return {
              async get() {
                return {
                  docs: [{ id: 'owner', data: () => user }],
                };
              },
            };
          },
        };
      }
      if (name === 'serviceSubscriptions') {
        return {
          doc() {
            return {
              async get() {
                return { exists: true, data: () => subscription };
              },
            };
          },
        };
      }
      if (name === 'devices') {
        return {
          doc() {
            return {
              async get() {
                return {
                  exists: true,
                  data: () => ({
                    nickname: 'Jesh',
                    online: true,
                    batteryPercent: 70,
                    simNumber: '+23057333333',
                    location: null,
                  }),
                };
              },
            };
          },
        };
      }
      if (name === 'notificationLogs') {
        return {
          async add(data) {
            return { id: 'notification-log-1', data };
          },
        };
      }
      throw new Error(`Unexpected collection ${name}`);
    },
  };
}

test('Essential SOS sends one Meta template to the primary contact only', async () => {
  const previous = {
    notifySms: config.notifySms,
    notifyWhatsApp: config.notifyWhatsApp,
    accessToken: config.metaWhatsAppAccessToken,
    phoneNumberId: config.metaWhatsAppPhoneNumberId,
    fetch: global.fetch,
  };
  const requests = [];

  config.notifySms = false;
  config.notifyWhatsApp = true;
  config.metaWhatsAppAccessToken = 'test-meta-token';
  config.metaWhatsAppPhoneNumberId = '123456789';
  global.fetch = async (url, options) => {
    requests.push({ url, options, body: JSON.parse(options.body) });
    return {
      ok: true,
      status: 200,
      async json() {
        return { messages: [{ id: 'wamid.essential-sos' }] };
      },
    };
  };

  try {
    const result = await notifyEmergencyContacts(
      fakeDb(),
      '359633100123456',
      { type: 'sos', severity: 'critical', eventAt: new Date() },
      { alertId: 'alert-1' }
    );

    assert.equal(requests.length, 1);
    assert.equal(requests[0].body.to, '23057222222');
    assert.equal(requests[0].body.template.name, 'guardian_sos_unavailable_v1');
    assert.equal(result.results[0].channels.whatsapp.skipped, true);
    assert.equal(
      result.results[0].channels.whatsapp.reason,
      'PRIMARY_WHATSAPP_RECIPIENT_ONLY'
    );
    assert.equal(result.results[1].channels.whatsapp.ok, true);
    assert.equal(result.results[1].channels.whatsapp.messageId, 'wamid.essential-sos');
    assert.equal(result.deliverySummary.status, 'accepted');
  } finally {
    config.notifySms = previous.notifySms;
    config.notifyWhatsApp = previous.notifyWhatsApp;
    config.metaWhatsAppAccessToken = previous.accessToken;
    config.metaWhatsAppPhoneNumberId = previous.phoneNumberId;
    global.fetch = previous.fetch;
  }
});
