'use strict';

const crypto = require('node:crypto');
const { inspectV52WifiScan, readRadioName } = require('./wifi-fence-scan');
const { fingerprintRouter, normalizeRouterId } = require('./wifi-home-observer');
const { loadHomeWifiBinding } = require('./wifi-home-display');
const COLLECTION = 'homeWifiEnrollments';
const SCAN_AGE_MS = 120_000;
const DISCOVERY_MS = 10 * 60_000;
const MAX_DISCOVERIES = 64;
const MAX_CHOICES = 5;
class HomeWifiError extends Error {
  constructor(code, status = 409) { super(code); this.code = code; this.status = status; }
}
const homeKey = binding => crypto.createHash('sha256').update(binding.key).digest('hex');

// Names/MACs exist only in bounded memory while an authorized owner has this
// screen open. Opaque choices are scoped to user, watch, zone and saved pin.
function createWifiDiscovery({ now = Date.now, randomId = () => crypto.randomBytes(16).toString('hex') } = {}) {
  const sessions = new Map();
  function prune() {
    for (const [key, s] of sessions) {
      if (now() >= s.expiresAt) sessions.delete(key);
      else s.radios = s.radios.filter(r => now() < r.expiresAt && now() >= r.observedMs);
    }
  }
  const keyFor = a => JSON.stringify([a.uid, a.imei, a.geofenceId, a.homeKey]);
  return {
    open(access) {
      prune();
      const key = keyFor(access);
      if (!sessions.has(key)) {
        if (sessions.size >= MAX_DISCOVERIES) throw new HomeWifiError('setup_busy', 429);
        sessions.set(key, { ...access, expiresAt: now() + DISCOVERY_MS, lastSource: -Infinity, radios: [] });
      }
      const s = sessions.get(key);
      s.expiresAt = now() + DISCOVERY_MS;
      return s.radios.map(r => ({ id: r.id, name: r.name || r.phoneName || 'Unnamed network',
        nameSource: r.name ? 'watch' : r.phoneName ? 'phone' : null,
        radioHint: r.macAddress.slice(-5).toUpperCase(), signalDbm: r.signalStrength,
        observedAt: new Date(r.observedMs).toISOString(), expiresAt: new Date(r.expiresAt).toISOString() }));
    },
    observe(event, receivedAt, args) {
      prune();
      if (!['location', 'alarm'].includes(event?.type)) return;
      const targets = [...sessions.values()].filter(s => s.imei === event.imei);
      if (!targets.length) return;
      const receivedMs = receivedAt.getTime();
      const sourceMs = new Date(event.location?.recordedAt).getTime();
      if (!Number.isFinite(sourceMs) || !Number.isFinite(receivedMs) || sourceMs > now() + 5000 ||
          receivedMs > now() + 5000 || now() - sourceMs >= SCAN_AGE_MS || now() - receivedMs >= SCAN_AGE_MS) return;
      const scan = inspectV52WifiScan(args, { includeNames: true });
      if (scan.status !== 'decoded') return;
      for (const s of targets) {
        if (sourceMs <= s.lastSource) continue;
        s.lastSource = sourceMs;
        // Discovery lists recently seen radios, not current Home presence.
        // Empty/partial scans cannot erase a still-fresh choice or renew it.
        const recent = new Map(s.radios.map(r => [r.macAddress, r]));
        for (const r of scan.accessPoints) {
          recent.set(r.macAddress, { ...r, phoneName: recent.get(r.macAddress)?.phoneName,
            id: recent.get(r.macAddress)?.id || randomId(),
            observedMs: sourceMs, expiresAt: Math.min(sourceMs, receivedMs) + SCAN_AGE_MS,
          });
        }
        s.radios = [...recent.values()].sort((a, b) =>
          b.observedMs - a.observedMs || b.signalStrength - a.signalStrength).slice(0, MAX_CHOICES);
      }
    },
    select(access, id) {
      prune();
      const r = sessions.get(keyFor(access))?.radios.find(r => r.id === id);
      if (!r) throw new HomeWifiError('network_expired');
      return { ...r, name: r.name || r.phoneName || '' };
    },
    matchPhoneNetworks(access, networks) {
      // Phone input supplies labels only. It cannot create a watch candidate,
      // refresh its evidence, change its token, or qualify Home presence.
      if (!Array.isArray(networks) || networks.length > 32) throw new HomeWifiError('invalid_phone_scan', 400);
      const seen = new Set();
      const validated = networks.map(point => {
        if (!point || Object.keys(point).sort().join(',') !== 'bssid,frequency,ssid') {
          throw new HomeWifiError('invalid_phone_scan', 400);
        }
        const macAddress = normalizeRouterId(point.bssid);
        const name = readRadioName(point.ssid, 3);
        if (!macAddress || seen.has(macAddress) || name.status !== 'available' ||
            !Number.isInteger(point.frequency) || point.frequency < 2400 || point.frequency > 2500) {
          throw new HomeWifiError('invalid_phone_scan', 400);
        }
        seen.add(macAddress);
        return { macAddress, name: name.name };
      });
      prune();
      const radios = sessions.get(keyFor(access))?.radios || [];
      const matchedIndexes = [];
      validated.forEach((point, index) => {
        const radio = radios.find(r => r.macAddress === point.macAddress);
        if (radio) {
          radio.phoneName = point.name;
          matchedIndexes.push(index);
        }
      });
      return matchedIndexes;
    },
    sweep: prune,
    close() { sessions.clear(); },
  };
}

async function authorizeHomeWifi({ db, uid, imei, read = ref => ref.get() }) {
  if (!/^[^/\s]{1,128}$/.test(uid || '') || !/^\d{15}$/.test(imei || '')) {
    throw new HomeWifiError('invalid_request', 400);
  }
  const snap = await read(db.collection('users').doc(uid));
  const user = snap.data();
  if (!snap.exists || !Array.isArray(user?.linkedImeis) || !user.linkedImeis.includes(imei)) {
    throw new HomeWifiError('device_not_linked', 403);
  }
  // Configuration belongs to the service owner; family membership alone does
  // not authorize publishing the household's network list or replacing Home.
  if (user.serviceOwnerUid && user.serviceOwnerUid !== uid) throw new HomeWifiError('owner_required', 403);
  return { uid, imei };
}

async function setupBinding(db, access, geofenceId, nowMs, read = ref => ref.get()) {
  const binding = await loadHomeWifiBinding(db, access.imei, nowMs, { read });
  if (!binding.ready) throw new HomeWifiError(binding.reason, 403);
  const zone = await read(db.collection('geofences').doc(binding.anchor.geofenceId));
  if (zone.data()?.createdBy !== access.uid) throw new HomeWifiError('owner_required', 403);
  if (binding.anchor.geofenceId !== geofenceId) throw new HomeWifiError('home_changed');
  return { ...binding, homeKey: homeKey(binding) };
}

function publicEnrollment(record) {
  return { version: record?.version || 0, enabled: record?.enabled === true,
    name: record?.enabled ? record.name : null, geofenceId: record?.geofenceId || null };
}

function createHomeWifiStore(db, { now = Date.now } = {}) {
  const refFor = imei => db.collection(COLLECTION).doc(imei);
  return {
    async read(imei) { const snap = await refFor(imei).get(); return snap.exists ? snap.data() : null; },
    async save(access, payload, discovery, { remove = false } = {}) {
      const keys = Object.keys(payload || {}).sort().join(',');
      if (keys !== (remove ? 'expectedVersion' : 'candidateId,expectedVersion,geofenceId,homeKey') ||
          !Number.isSafeInteger(payload.expectedVersion) || payload.expectedVersion < 0 ||
          (!remove && (!/^[a-f0-9]{32}$/.test(payload.candidateId || '') ||
            !/^[^/]{1,128}$/.test(payload.geofenceId || '') || !/^[a-f0-9]{64}$/.test(payload.homeKey || '')))) {
        throw new HomeWifiError('invalid_request', 400);
      }
      const hashKey = crypto.randomBytes(32).toString('hex');
      return db.runTransaction(async tx => {
        const read = ref => tx.get(ref);
        await authorizeHomeWifi({ db, ...access, read });
        const ref = refFor(access.imei);
        const snap = await read(ref);
        const previous = snap.exists ? snap.data() : null;
        if ((previous?.version || 0) !== payload.expectedVersion) throw new HomeWifiError('settings_changed');
        if (previous?.ownerUid && previous.ownerUid !== access.uid) throw new HomeWifiError('owner_required', 403);
        let selected = null;
        let binding = null;
        if (!remove) {
          binding = await setupBinding(db, access, payload.geofenceId, now(), read);
          if (binding.homeKey !== payload.homeKey) throw new HomeWifiError('home_changed');
          // Rechecked on every transaction retry: no old scan can be enrolled
          // after a concurrent edit or delayed Firestore response.
          selected = discovery.select({ ...access, geofenceId: payload.geofenceId, homeKey: binding.homeKey }, payload.candidateId);
        }
        const deviceRef = db.collection('devices').doc(access.imei);
        const device = await read(deviceRef);
        if (!device.exists) throw new HomeWifiError('device_unavailable', 404);
        if (selected && now() >= selected.expiresAt) throw new HomeWifiError('network_expired');
        const record = { version: payload.expectedVersion + 1, enabled: !remove,
          ownerUid: access.uid, updatedAt: new Date(now()).toISOString(),
          ...(selected ? { geofenceId: payload.geofenceId, homeKey: binding.homeKey,
            name: selected.name || 'Unnamed network', hashKey,
            routerHash: fingerprintRouter({ imei: access.imei, routerId: selected.macAddress, hashKey }) } : {}),
        };
        // A disabled tombstone prevents an old .env pilot router reappearing.
        tx.set(ref, record);
        tx.update(deviceRef, { homeWifiPresence: null, lastHomeWifiDetection: null });
        return publicEnrollment(record);
      });
    },
  };
}

module.exports = { COLLECTION, SCAN_AGE_MS, DISCOVERY_MS, MAX_DISCOVERIES, HomeWifiError,
  homeKey, createWifiDiscovery, authorizeHomeWifi, setupBinding, publicEnrollment, createHomeWifiStore };
