'use strict';

const { createWifiHomeObserver } = require('./wifi-home-observer');
const { inspectV52WifiScan } = require('./wifi-fence-scan');
const { loadHomeWifiBinding, startHomeWifiPublisher } = require('./wifi-home-display');
const { readFirstSnapshot } = require('./firestore-first-snapshot');
const { COLLECTION, createWifiDiscovery, homeKey } = require('./home-wifi-setup');

function validEnrollment(r) {
  return r?.enabled === true && Number.isSafeInteger(r.version) && r.version > 0 &&
    /^[^/\s]{1,128}$/.test(r.ownerUid || '') && /^[^/]{1,128}$/.test(r.geofenceId || '') &&
    /^[a-f0-9]{64}$/.test(r.routerHash || '') && /^[a-f0-9]{64}$/.test(r.hashKey || '') &&
    /^[a-f0-9]{64}$/.test(r.homeKey || '');
}

// Use the same expiry/qualification/presentation rules as the existing pilot.
// Network discovery and observation never generate CR, UPLOAD or WIFIFENCE.
function createHomeWifiEnrollmentRuntime({ db, legacy = null, now = Date.now,
  publish = startHomeWifiPublisher, report = () => {} }) {
  const discovery = createWifiDiscovery({ now });
  const entries = new Map();
  let ready = false;
  let stopped = false;
  let unsubscribe;
  function stopEntry(entry) { entry?.publisher?.(); if (entry) entry.publisher = null; }
  function replace(imei, record, legacyEntry = false) {
    const old = entries.get(imei);
    if (old && JSON.stringify(old.record) === JSON.stringify(record) && old.legacy === legacyEntry) return;
    stopEntry(old);
    entries.set(imei, { record, legacy: legacyEntry, observer: null, publisher: null, lastPacket: now() });
  }
  function current(imei, entry) { return ready && !stopped && entries.get(imei) === entry; }
  async function bindingFor(imei, entry, at, read, restorePresence = false) {
    const enrolled = await read(db.collection(COLLECTION).doc(imei));
    const r = entry.record;
    if (entry.legacy ? enrolled.exists : !enrolled.exists || enrolled.data()?.version !== r.version || !enrolled.data()?.enabled) {
      return { ready: false, reason: 'wifi_enrollment_changed' };
    }
    const binding = await loadHomeWifiBinding(db, imei, at, { read, restorePresence });
    if (!binding.ready || entry.legacy) return binding;
    if (homeKey(binding) !== r.homeKey || binding.anchor.geofenceId !== r.geofenceId) {
      return { ready: false, reason: 'home_changed' };
    }
    return { ...binding, key: `${binding.key}|wifi:${r.version}` };
  }
  function activate(imei, entry) {
    if (entry.publisher || !current(imei, entry) || (!entry.legacy && !validEnrollment(entry.record))) return;
    const reset = () => { entry.observer = createWifiHomeObserver({ enabled: true, imei,
      routerHash: entry.record.routerHash, hashKey: entry.record.hashKey }); };
    reset();
    entry.publisher = publish({ db, imei,
      readObservation: at => entry.observer.snapshot(at),
      readGpsObservation: () => entry.observer.readGpsObservation(), resetObservation: reset,
      readBinding: (at, { signal, restorePresence }) => bindingFor(imei, entry, at,
        ref => readFirstSnapshot(ref, signal), restorePresence),
      persist: (value, detection) => db.runTransaction(async tx => {
        if (!current(imei, entry)) return;
        const binding = await bindingFor(imei, entry, now(), ref => tx.get(ref));
        // A stale publisher cannot undo a replacement/removal, even if its
        // Firestore operation finishes after the new enrollment transaction.
        if (!current(imei, entry) || binding.reason === 'wifi_enrollment_changed') return;
        const ref = db.collection('devices').doc(imei);
        const device = await tx.get(ref);
        if (!device.exists || !current(imei, entry)) return;
        tx.update(ref, {
          homeWifiPresence: binding.ready && value && Date.parse(value.expiresAt) > now() ? value : null,
          lastHomeWifiDetection: binding.ready ? detection : null,
        });
      }),
    });
  }
  function applySnapshot(snapshot) {
    if (stopped) return;
    ready = true;
    const ids = new Set();
    for (const doc of snapshot.docs) {
      if (!/^\d{15}$/.test(doc.id)) continue;
      ids.add(doc.id); replace(doc.id, doc.data());
    }
    if (legacy && !ids.has(legacy.imei)) {
      ids.add(legacy.imei); replace(legacy.imei, legacy, true);
    }
    for (const [imei, entry] of entries) if (!ids.has(imei)) { stopEntry(entry); entries.delete(imei); }
  }
  function fail() {
    ready = false;
    for (const entry of entries.values()) stopEntry(entry);
    entries.clear();
    discovery.close();
    report('enrollment_unavailable');
  }
  function subscribe() {
    if (stopped || unsubscribe) return;
    unsubscribe = db.collection(COLLECTION).onSnapshot(applySnapshot, () => {
      unsubscribe?.(); unsubscribe = null; fail();
    });
  }
  subscribe();
  const timer = setInterval(() => {
    discovery.sweep();
    if (!unsubscribe) subscribe();
    for (const entry of entries.values()) {
      if (now() - entry.lastPacket >= 15 * 60_000) stopEntry(entry);
    }
  }, 30_000);
  timer.unref?.();
  return {
    discovery,
    get ready() { return ready && !stopped; },
    observe(event, receivedAt, args) {
      if (!ready || stopped) return;
      discovery.observe(event, receivedAt, args);
      const entry = entries.get(event?.imei);
      if (!entry || !['location', 'alarm'].includes(event.type)) return;
      entry.lastPacket = now(); activate(event.imei, entry);
      if (entry.publisher) entry.observer.observe(event, receivedAt.getTime(), inspectV52WifiScan(args));
    },
    evidence(imei, at = now()) { return ready ? entries.get(imei)?.publisher?.getEvidence(at) || null : null; },
    status(imei, at = now()) {
      const entry = entries.get(imei);
      return { ready: ready && !stopped, enrolled: validEnrollment(entry?.record),
        version: entry?.record?.version || 0,
        observer: entry?.observer?.snapshot(at) || null,
        publisher: entry?.publisher?.getStatus(at) || null };
    },
    stop() {
      stopped = true; ready = false; clearInterval(timer); unsubscribe?.();
      for (const entry of entries.values()) stopEntry(entry);
      entries.clear(); discovery.close();
    },
  };
}
module.exports = { validEnrollment, createHomeWifiEnrollmentRuntime };
