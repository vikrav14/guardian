'use strict';
const assert = require('node:assert/strict');
const imei = '861000000000001';
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
module.exports = { database, imei };
