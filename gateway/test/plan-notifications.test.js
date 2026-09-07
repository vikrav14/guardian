const test = require('node:test');
const assert = require('node:assert/strict');

const { findContactsForImei } = require('../src/notify');
const { requiredFeatureForAlert } = require('../src/push');
const { FEATURE } = require('../src/entitlements');

function sub(plan) {
  return { version: 1, managedBy: 'guardian_admin', plan, status: 'active' };
}

function fakeDb(users) {
  return {
    collection(name) {
      if (name === 'serviceSubscriptions') {
        return {
          doc(uid) {
            const index = Number(String(uid).replace(/^u/, '')) - 1;
            const value = users[index]?.subscription;
            return { async get() { return { exists: Boolean(value), data: () => value }; } };
          },
        };
      }
      assert.equal(name, 'users');
      return {
        where() {
          return {
            async get() {
              return {
                docs: users.map((data, index) => ({
                  id: `u${index + 1}`,
                  data: () => data,
                })),
              };
            },
          };
        },
      };
    },
  };
}

test('notification alert types map to the correct advertised feature', () => {
  assert.equal(requiredFeatureForAlert({ type: 'sos' }), FEATURE.SOS_ALERTS);
  assert.equal(requiredFeatureForAlert({ type: 'fall' }), FEATURE.SOS_ALERTS);
  assert.equal(requiredFeatureForAlert({ type: 'low_battery' }), FEATURE.BATTERY_ALERTS);
  assert.equal(requiredFeatureForAlert({ type: 'geofence_exit' }), FEATURE.SAFE_ZONES);
  assert.equal(requiredFeatureForAlert({ type: 'offline' }), FEATURE.PROACTIVE_SMART_NOTIFICATIONS);
});

test('only active service accounts contribute emergency contacts', async () => {
  const contacts = await findContactsForImei(fakeDb([
    {
      subscription: sub('essential'),
      emergencyContacts: [{ name: 'Active', phone: '+23057111111' }],
    },
    {
      emergencyContacts: [{ name: 'Inactive', phone: '+23057222222' }],
    },
  ]), 'A');
  assert.deepEqual(contacts.map((contact) => contact.name), ['Active']);
});

test('Essential safety contacts receive only the SOS WhatsApp entitlement', async () => {
  const [contact] = await findContactsForImei(fakeDb([{
    subscription: sub('essential'),
    emergencyContacts: [{ name: 'Contact', phone: '+23057111111' }],
  }]), 'A');
  assert.equal(contact.entitlements.features.includes(FEATURE.SOS_ALERTS), true);
  assert.equal(contact.entitlements.features.includes(FEATURE.SOS_WHATSAPP_ALERTS), true);
  assert.equal(contact.entitlements.features.includes(FEATURE.WHATSAPP_SAFETY_ALERTS), false);
});
