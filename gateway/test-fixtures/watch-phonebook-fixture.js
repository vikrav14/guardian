'use strict';
const imei = '861397000000000', protocolId = '9700000000', phone = '+23050000000';
class MemoryDb {
  constructor() { this.rows = new Map(); this.tail = Promise.resolve(); this.transactions = 0; }
  collection(name) { return { doc: value => ({ path: `${name}/${value}` }) }; }
  seed(path, value) { this.rows.set(path, structuredClone(value)); return this; }
  get(path) { return structuredClone(this.rows.get(path)); }
  runTransaction(body) {
    const work = this.tail.then(async () => {
      if (++this.transactions === this.failTransaction) throw new Error('database unavailable');
      const writes = [];
      const result = await body({
        get: async ref => ({ exists: this.rows.has(ref.path), data: () => this.get(ref.path) }),
        set: (ref, data, options) => writes.push({ ref, data, merge: options?.merge }),
        update: (ref, data) => writes.push({ ref, data, merge: true }),
      });
      for (const { ref, data, merge } of writes) this.seed(ref.path, merge ? { ...this.get(ref.path), ...data } : data);
      return result;
    });
    this.tail = work.catch(() => {}); return work;
  }
}
const inventory = () => ({ imei, managerUid: 'owner', inventoryConfirmed: true, emptySlots: [2, 3],
  contacts: [{ slot: 1, name: 'Existing', phone: '+23050000001' }] });
const request = (now = Date.now()) => ({ imei, requestedBy: 'owner', name: 'Éva', phone,
  policyRevision: 'revision-1', status: 'pending', createdAt: new Date(now - 1000), expiresAt: new Date(now + 60000) });
module.exports = { MemoryDb, imei, protocolId, phone, inventory, request };
