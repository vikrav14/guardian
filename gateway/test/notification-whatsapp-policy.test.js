const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PLAN,
  evaluateSubscription,
} = require('../src/entitlements');
const {
  whatsappFeatureForAlert,
  selectWhatsAppContacts,
} = require('../src/notification-whatsapp-policy');

function entitlements(plan, ownerUid = 'owner') {
  return evaluateSubscription(
    { version: 1, managedBy: 'guardian_admin', plan, status: 'active' },
    { ownerUid }
  );
}

function contact(name, plan, overrides = {}) {
  return {
    name,
    phone: `+2305${name.length}000000`,
    guardianUid: 'owner',
    contactIndex: 0,
    entitlements: entitlements(plan),
    ...overrides,
  };
}

test('SOS uses its narrow Essential WhatsApp entitlement', () => {
  assert.equal(whatsappFeatureForAlert({ type: 'sos' }), 'sos_whatsapp_alerts');
  assert.equal(
    whatsappFeatureForAlert({ type: 'fall' }),
    'whatsapp_safety_alerts'
  );
});

test('Essential sends SOS WhatsApp only to the explicit primary contact', () => {
  const contacts = [
    contact('First', PLAN.ESSENTIAL, { contactIndex: 0 }),
    contact('Primary', PLAN.ESSENTIAL, { contactIndex: 1, isPrimary: true }),
    contact('Third', PLAN.ESSENTIAL, { contactIndex: 2 }),
  ];

  assert.deepEqual(
    selectWhatsAppContacts(contacts, { type: 'sos' }).map((item) => item.name),
    ['Primary']
  );
});

test('Essential legacy contacts fall back to the owner first, then stored order', () => {
  const member = contact('Member', PLAN.ESSENTIAL, {
    guardianUid: 'member',
    contactIndex: 0,
  });
  const ownerFirst = contact('Owner first', PLAN.ESSENTIAL, {
    guardianUid: 'owner',
    contactIndex: 0,
  });
  const ownerSecond = contact('Owner second', PLAN.ESSENTIAL, {
    guardianUid: 'owner',
    contactIndex: 1,
  });

  assert.deepEqual(
    selectWhatsAppContacts(
      [member, ownerSecond, ownerFirst],
      { type: 'sos' }
    ).map((item) => item.name),
    ['Owner first']
  );
});

test('Essential does not receive fall or routine WhatsApp alerts', () => {
  const contacts = [contact('Primary', PLAN.ESSENTIAL, { isPrimary: true })];
  assert.deepEqual(selectWhatsAppContacts(contacts, { type: 'fall' }), []);
  assert.deepEqual(
    selectWhatsAppContacts(contacts, { type: 'geofence_exit' }),
    []
  );
});

test('Family and Care retain full WhatsApp safety fan-out', () => {
  const contacts = [
    contact('Family one', PLAN.FAMILY),
    contact('Family two', PLAN.FAMILY, { contactIndex: 1 }),
    contact('Care', PLAN.CARE, {
      guardianUid: 'care-owner',
      entitlements: entitlements(PLAN.CARE, 'care-owner'),
    }),
  ];

  for (const type of ['sos', 'fall']) {
    assert.deepEqual(
      selectWhatsAppContacts(contacts, { type }).map((item) => item.name),
      ['Family one', 'Family two', 'Care']
    );
  }
});
