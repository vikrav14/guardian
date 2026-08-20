const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveCallerContext,
  CALLER_ROLES,
  permissionsForCallerRole,
  restrictedCallerReply,
} = require('../src/assistant/tools');

const activeFamily = {
  version: 1,
  managedBy: 'guardian_admin',
  plan: 'family',
  status: 'active',
};

function fakeDb({ users = [], devices = {} } = {}) {
  return {
    collection(name) {
      if (name === 'users') {
        return {
          async get() {
            return {
              docs: users.map((entry) => ({
                id: entry.id,
                data: () => ({ ...entry.data }),
              })),
            };
          },
          doc(uid) {
            const entry = users.find((candidate) => candidate.id === uid);
            return {
              async get() {
                return {
                  exists: Boolean(entry),
                  data: () => (entry ? { ...entry.data } : undefined),
                };
              },
            };
          },
        };
      }

      if (name === 'serviceSubscriptions') {
        return {
          doc(uid) {
            const entry = users.find((candidate) => candidate.id === uid);
            return {
              async get() {
                const value = entry?.data?.subscription;
                return { exists: Boolean(value), data: () => value };
              },
            };
          },
        };
      }

      if (name === 'devices') {
        return {
          doc(imei) {
            return {
              async get() {
                const value = devices[imei];
                return {
                  exists: Boolean(value),
                  data: () => (value ? { ...value } : undefined),
                };
              },
            };
          },
        };
      }

      throw new Error(`Unexpected collection ${name}`);
    },
  };
}

test('registered Guardian uses only own linkedImeis', async () => {
  const db = fakeDb({
    users: [{ id: 'g1', data: { displayName: 'Rav', phone: '+23058590100', role: 'guardian', linkedImeis: ['A'], subscription: activeFamily } }],
    devices: { A: { nickname: 'Jesh' } },
  });

  const ctx = await resolveCallerContext(db, '+23058590100');
  assert.equal(ctx.uid, 'g1');
  assert.equal(ctx.callerRole, CALLER_ROLES.GUARDIAN);
  assert.deepEqual(ctx.linkedImeis, ['A']);
  assert.equal(ctx.devices[0].imei, 'A');
  assert.equal(ctx.permissions.canReadLocation, true);
});

test('direct registered user wins over emergency-contact match', async () => {
  const db = fakeDb({
    users: [
      { id: 'owner', data: { phone: '+23057111111', linkedImeis: ['OWNER'], emergencyContacts: [{ name: 'Rav', phone: '+23058590100' }] } },
      { id: 'rav', data: { whatsapp: '+23058590100', linkedImeis: ['RAV'], subscription: activeFamily } },
    ],
    devices: { OWNER: { nickname: 'Owner wearer' }, RAV: { nickname: 'Rav wearer' } },
  });

  const ctx = await resolveCallerContext(db, 'whatsapp:+23058590100');
  assert.equal(ctx.uid, 'rav');
  assert.equal(ctx.callerRole, CALLER_ROLES.GUARDIAN);
  assert.deepEqual(ctx.linkedImeis, ['RAV']);
});

test('shared family Guardian is authorised only via own linkedImeis', async () => {
  const db = fakeDb({
    users: [{ id: 'family', data: { phone: '+23057222222', role: 'guardian', linkedImeis: ['SHARED'], subscription: activeFamily } }],
    devices: { SHARED: { nickname: 'Mum' }, PRIVATE: { nickname: 'Private' } },
  });

  const ctx = await resolveCallerContext(db, '+23057222222');
  assert.deepEqual(ctx.linkedImeis, ['SHARED']);
  assert.deepEqual(ctx.devices.map((d) => d.imei), ['SHARED']);
});

test('emergency contact is notification-only and gets zero private access', async () => {
  const db = fakeDb({
    users: [{
      id: 'owner',
      data: {
        phone: '+23057111111',
        linkedImeis: ['PRIVATE'],
        emergencyContacts: [{ name: 'Aunt', phone: '+23057333333', whatsapp: '+23057333333' }],
      },
    }],
    devices: { PRIVATE: { nickname: 'Child', location: { lat: -20.1, lng: 57.5 } } },
  });

  const ctx = await resolveCallerContext(db, '+23057333333');
  assert.equal(ctx.uid, null);
  assert.equal(ctx.ownerUid, 'owner');
  assert.equal(ctx.callerRole, CALLER_ROLES.EMERGENCY_CONTACT);
  assert.deepEqual(ctx.linkedImeis, []);
  assert.deepEqual(ctx.devices, []);
  assert.equal(ctx.permissions.canReadLocation, false);
  assert.equal(ctx.permissions.canReadDeviceStatus, false);
  assert.equal(ctx.permissions.canReadAlerts, false);
  assert.equal(ctx.permissions.canReadSafeZones, false);
  assert.equal(ctx.permissions.canControlDevice, false);
  assert.equal(ctx.permissions.canScheduleReminders, false);
  assert.equal(ctx.permissions.canReceiveSafetyAlerts, true);
});

test('unknown number gets zero access', async () => {
  const db = fakeDb({ users: [{ id: 'g1', data: { phone: '+23057111111', linkedImeis: ['PRIVATE'] } }] });
  const ctx = await resolveCallerContext(db, '+23057999999');

  assert.equal(ctx.uid, null);
  assert.equal(ctx.ownerUid, null);
  assert.equal(ctx.callerRole, CALLER_ROLES.UNKNOWN);
  assert.deepEqual(ctx.linkedImeis, []);
  assert.equal(ctx.permissions.canReceiveSafetyAlerts, false);
});

test('admin direct number retains linked-device permissions', async () => {
  const db = fakeDb({
    users: [{ id: 'admin', data: { phone: '+23057444444', role: 'admin', linkedImeis: ['A'], subscription: activeFamily } }],
    devices: { A: { nickname: 'Test' } },
  });
  const ctx = await resolveCallerContext(db, '+23057444444');
  assert.equal(ctx.callerRole, CALLER_ROLES.ADMIN);
  assert.equal(ctx.permissions.canControlDevice, true);
});

test('unknown role fails closed', () => {
  const p = permissionsForCallerRole('future_role');
  assert.equal(p.canUseWhatsAppAssistant, false);
  assert.equal(p.canReadLocation, false);
  assert.equal(p.canControlDevice, false);
});

test('registered user without a trusted subscription gets no WhatsApp service', async () => {
  const db = fakeDb({
    users: [{ id: 'g1', data: { phone: '+23057111111', linkedImeis: ['A'] } }],
    devices: { A: { nickname: 'Test' } },
  });
  const ctx = await resolveCallerContext(db, '+23057111111');
  assert.equal(ctx.uid, 'g1');
  assert.equal(ctx.entitlements.serviceActive, false);
  assert.equal(ctx.permissions.canUseWhatsAppAssistant, false);
  assert.equal(ctx.permissions.canReadLocation, false);
});

test('emergency-contact privacy reply is deterministic', () => {
  const reply = restrictedCallerReply({ callerRole: CALLER_ROLES.EMERGENCY_CONTACT });
  assert.match(reply, /emergency contact/i);
  assert.match(reply, /does not grant/i);
  assert.match(reply, /explicitly share access/i);
});

test('critical emergency-contact reply never claims dispatch', () => {
  const reply = restrictedCallerReply(
    { callerRole: CALLER_ROLES.EMERGENCY_CONTACT },
    { critical: true }
  );
  assert.doesNotMatch(reply, /\bdispatch(?:ed|ing)?\b/i);
  assert.match(reply, /does not trigger an SOS/i);
  assert.match(reply, /emergency services/i);
});
