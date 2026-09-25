'use strict';
const assert = require('node:assert/strict');
const { createSnapshotController } = require('../../src/safety-snapshot-live');
const jpeg = require('../fixtures/photo-synthetic');
const imei = '861397052547492', protocolId = '9705254749';
const clone = value => value == null ? value : structuredClone(value);

// Serialized transactions model competing gateway workers against one durable store.
function database() {
  const rows = new Map(); let tail = Promise.resolve(); let ids = 0;
  const snapshot = path => ({ id: path.split('/').at(-1), ref: doc(path), exists: rows.has(path), data: () => clone(rows.get(path)) });
  function doc(path) {
    return { path, id: path.split('/').at(-1), get: async () => snapshot(path),
      set: async data => rows.set(path, clone(data)), update: async data => {
        assert(rows.has(path)); rows.set(path, { ...rows.get(path), ...clone(data) });
      }, collection: name => collection(`${path}/${name}`) };
  }
  function collection(path, filters = [], ordering = null, count = Infinity) {
    return { doc: id => doc(`${path}/${id}`), add: async data => { const ref = doc(`${path}/${++ids}`); await ref.set(data); return ref; },
      where: (field, op, value) => collection(path, [...filters, [field, op, value]], ordering, count),
      orderBy: (field, direction) => collection(path, filters, [field, direction], count),
      limit: n => collection(path, filters, ordering, n),
      get: async () => {
        let docs = [...rows.keys()].filter(key => key.startsWith(`${path}/`) && key.split('/').length === path.split('/').length + 1).map(snapshot);
        docs = docs.filter(doc => filters.every(([field, op, value]) => {
          const actual = doc.data()[field];
          return op === '==' ? actual === value : op === 'in' ? value.includes(actual) : actual <= value;
        }));
        if (ordering) docs.sort((a, b) => { const x = a.data()[ordering[0]], y = b.data()[ordering[0]]; return (x > y ? 1 : x < y ? -1 : 0) * (ordering[1] === 'desc' ? -1 : 1); });
        return { docs: docs.slice(0, count), empty: !docs.length };
      } };
  }
  const db = { rows, collection, runTransaction: fn => {
    const run = tail.then(async () => {
      const writes = []; let written = false;
      const tx = { get: async ref => { assert(!written, 'all transaction reads precede writes'); return ref.get(); },
        create: (ref, data) => { written = true; writes.push(() => { assert(!rows.has(ref.path)); rows.set(ref.path, clone(data)); }); },
        set: (ref, data) => { written = true; writes.push(() => rows.set(ref.path, clone(data))); },
        update: (ref, data) => { written = true; writes.push(() => { assert(rows.has(ref.path)); rows.set(ref.path, { ...rows.get(ref.path), ...clone(data) }); }); } };
      const result = await fn(tx); writes.forEach(write => write()); return result;
    }); tail = run.catch(() => {}); return run;
  } };
  for (const [uid, data] of Object.entries({ owner: { linkedImeis: [imei], memberUids: ['member'] },
    member: { linkedImeis: [imei], serviceOwnerUid: 'owner' }, outsider: { linkedImeis: [imei] },
    unlinked: { linkedImeis: [] }, essential: { linkedImeis: [imei] } })) {
    rows.set(`users/${uid}`, data);
    rows.set(`serviceSubscriptions/${uid}`, { version: 1, managedBy: 'guardian_admin', status: 'active', plan: uid === 'essential' ? 'essential' : 'family' });
  }
  return db;
}
function frame({ image = jpeg, id = protocolId, trailer = 6 } = {}) {
  const codes = new Map([[0x7d, 1], [0x5b, 2], [0x5d, 3], [0x2c, 4], [0x2a, 5]]);
  const body = Buffer.concat([Buffer.from('img,5,260925002653,'), Buffer.from([...Buffer.concat([image, Buffer.alloc(trailer)])].flatMap(byte => codes.has(byte) ? [0x7d, codes.get(byte)] : [byte]))]);
  return Buffer.concat([Buffer.from(`[3G*${id}*${body.length.toString(16).padStart(4, '0')}*`), body, Buffer.from(']')]);
}
function setup({ captureRejectedFrame = null } = {}) {
  const db = database(), objects = new Map(), writes = [], logs = [];
  let date = new Date('2026-09-25T00:00:00Z');
  const socket = { writable: true, destroyed: false, write: (data, callback) => { writes.push(Buffer.from(data)); callback?.(); return true; } };
  const session = { imei, protocolId };
  let matches = [{ socket, session }];
  const bucket = { failSave: false, failDelete: false, pause: null, file: path => ({
    save: async (bytes, options) => {
      assert.equal(options.preconditionOpts.ifGenerationMatch, 0); assert.equal(options.metadata.cacheControl, 'private, no-store');
      assert.equal(options.metadata.metadata.firebaseStorageDownloadTokens, undefined);
      if (bucket.pause) await bucket.pause;
      objects.set(path, Buffer.from(bytes));
      if (bucket.failSave) throw Error('ambiguous_storage_failure');
    },
    download: async () => [objects.get(path)],
    delete: async () => { if (bucket.failDelete) throw Error('storage_unavailable'); objects.delete(path); },
  }) };
  const args = { db, bucket, findSessions: () => matches, runtime: { deviceDispatchAllowed: true, acceptedImeis: [imei] }, now: () => date, log: value => logs.push(value), captureRejectedFrame };
  const api = createSnapshotController(args);
  return { api, args, db, bucket, objects, writes, logs, socket, session,
    advance: ms => { date = new Date(date.getTime() + ms); }, matches: value => { matches = value; },
    auth: id => db.rows.get(`safetySnapshotAuthorizations/${id}`),
  };
}
async function until(fn) { for (let i = 0; i < 200; i++) { if (fn()) return; await new Promise(resolve => setImmediate(resolve)); } assert.fail('operation did not finish'); }
async function receive(s, id, bytes = frame()) { s.api.observe(bytes, s.socket, s.session); await until(() => !['dispatching', 'waiting_for_image', 'receiving'].includes(s.auth(id).state)); }

module.exports = { database, setup, frame, receive, until, imei, protocolId };
