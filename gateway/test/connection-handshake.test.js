const test = require('node:test');
const assert = require('node:assert/strict');
const { maybeAnnounceConnecting } = require('../src/connection-handshake');

test('maybeAnnounceConnecting writes connecting once per TCP session', async () => {
  const writes = [];
  const session = {};
  const upsertDevice = async (imei, patch) => {
    writes.push({ imei, patch });
  };
  let connected = 0;
  const onDeviceConnect = () => {
    connected += 1;
  };
  const cancelPendingOffline = () => {};

  const first = await maybeAnnounceConnecting(
    session,
    '861397053141170',
    { protocolId: '9705314117' },
    upsertDevice,
    onDeviceConnect,
    cancelPendingOffline
  );
  const second = await maybeAnnounceConnecting(
    session,
    '861397053141170',
    { protocolId: '9705314117' },
    upsertDevice,
    onDeviceConnect,
    cancelPendingOffline
  );

  assert.equal(first, true);
  assert.equal(second, false);
  assert.equal(connected, 1);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].imei, '861397053141170');
  assert.equal(writes[0].patch.online, false);
  assert.equal(writes[0].patch.connectionState, 'connecting');
  assert.ok(writes[0].patch.connectingAt instanceof Date);
});

test('maybeAnnounceConnecting seeds the last-known location from Firestore', async () => {
  const session = {};
  const upsertDevice = async () => {};
  const getDeviceDocument = async () => ({ location: { lat: -20.03, lng: 57.59 } });
  const seeded = [];
  const seedLastKnownLocation = (imei, location) => seeded.push({ imei, location });

  await maybeAnnounceConnecting(
    session,
    '861397053141170',
    {},
    upsertDevice,
    () => {},
    () => {},
    getDeviceDocument,
    seedLastKnownLocation
  );

  assert.equal(seeded.length, 1);
  assert.equal(seeded[0].imei, '861397053141170');
  assert.deepEqual(seeded[0].location, { lat: -20.03, lng: 57.59 });
});

test('maybeAnnounceConnecting tolerates a Firestore lookup failure when seeding', async () => {
  const session = {};
  const upsertDevice = async () => {};
  const getDeviceDocument = async () => {
    throw new Error('firestore unavailable');
  };
  let seeded = 0;
  const seedLastKnownLocation = () => {
    seeded += 1;
  };

  const result = await maybeAnnounceConnecting(
    session,
    '861397053141170',
    {},
    upsertDevice,
    () => {},
    () => {},
    getDeviceDocument,
    seedLastKnownLocation
  );

  assert.equal(result, true);
  assert.equal(seeded, 0);
});

test('maybeAnnounceConnecting skips when session or imei missing', async () => {
  let writes = 0;
  const upsertDevice = async () => {
    writes += 1;
  };
  assert.equal(
    await maybeAnnounceConnecting(null, '1', {}, upsertDevice, () => {}, () => {}),
    false
  );
  assert.equal(
    await maybeAnnounceConnecting({}, null, {}, upsertDevice, () => {}, () => {}),
    false
  );
  assert.equal(writes, 0);
});
