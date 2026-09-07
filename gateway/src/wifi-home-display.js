'use strict';

const { evaluateSubscription } = require('./entitlements');
const { validAnchor, buildHomeWifiDisplay } = require('./wifi-home-display-policy');

// Private pilot binding only. A single active Home zone must belong to a linked
// service owner with an active Family/Care subscription. Never guess a pin from
// the provider's network estimate, an SSID or an arbitrary first safe zone.
async function loadHomeWifiBinding(db, imei, nowMs) {
  const zones = await db.collection('geofences').where('imei', '==', imei)
    .where('active', '==', true).get();
  const homes = zones.docs.map(doc => ({ ...doc.data(), id: doc.id }))
    .filter(zone => zone.imei === imei && zone.active === true &&
      typeof zone.name === 'string' && zone.name.trim().toLowerCase() === 'home');
  if (homes.length !== 1) return { ready: false,
    reason: homes.length ? 'home_zone_ambiguous' : 'home_zone_missing' };
  const home = homes[0];
  const anchor = { geofenceId: home.id, lat: home.center?.lat, lng: home.center?.lng };
  if (!validAnchor(anchor)) return { ready: false, reason: 'home_pin_invalid' };
  const ownerUid = home.createdBy;
  if (typeof ownerUid !== 'string' || !ownerUid || ownerUid.includes('/')) {
    return { ready: false, reason: 'home_owner_unverified' };
  }
  const ownerDoc = await db.collection('users').doc(ownerUid).get();
  const owner = ownerDoc.exists ? ownerDoc.data() : null;
  if (!owner || !Array.isArray(owner.linkedImeis) || !owner.linkedImeis.includes(imei) ||
      (owner.serviceOwnerUid && owner.serviceOwnerUid !== ownerUid)) {
    return { ready: false, reason: 'home_owner_unverified' };
  }
  const subDoc = await db.collection('serviceSubscriptions').doc(ownerUid).get();
  const access = evaluateSubscription(subDoc.exists ? subDoc.data() : null,
    { ownerUid, now: new Date(nowMs) });
  if (!access.serviceActive || !['family', 'care'].includes(access.plan)) {
    return { ready: false, reason: 'home_family_plan_required' };
  }
  return { ready: true, anchor,
    key: JSON.stringify([home.id, anchor.lat, anchor.lng, ownerUid]),
    // Binding is rechecked every 30 seconds; a failed/hung read cannot renew it.
    validUntilMs: Math.min(nowMs + 60_000, access.accessUntil?.getTime() ?? Infinity) };
}

function createHomeWifiPublisher({ readBinding, readObservation, resetObservation,
  persist, now = Date.now, report = () => {} }) {
  let binding = null;
  let bindingKey;
  let nextBindingAt = 0;
  let lastValue;
  let lastWriteAt = -Infinity;
  let working = false;
  let queued = false;
  let stopped = false;
  let lastDiagnostic;

  function diagnose(reason, displaying) {
    const key = `${reason}|${displaying}`;
    if (key === lastDiagnostic) return;
    lastDiagnostic = key;
    report({ pilot: true, displayEnabled: true, displayingHome: displaying, reason });
  }

  async function tick() {
    if (stopped) return;
    if (working) { queued = true; return; }
    working = true;
    try {
      if (now() >= nextBindingAt) {
        nextBindingAt = now() + 30_000;
        try { binding = await readBinding(now()); }
        catch { binding = { ready: false, reason: 'home_binding_unavailable' }; }
        if (stopped) return;
        const key = binding?.ready ? binding.key : null;
        if (key !== bindingKey) {
          bindingKey = key;
          resetObservation(); // Reconfirm after enrollment/anchor/owner changes.
        }
      }
      const clock = now();
      const observation = readObservation(clock);
      const value = buildHomeWifiDisplay(observation, binding, clock);
      const same = JSON.stringify(value) === JSON.stringify(lastValue);
      // Clear invalid evidence immediately and bound periodic renewal writes.
      // A freshly verified binding can extend the display lease only as far as
      // the ORIGINAL radio expiry (capped by buildHomeWifiDisplay). Its source
      // time never changes. This avoids a gap between valid 40–60s radio reports
      // without turning cellular packets or heartbeats into Home observations.
      const shorterLease = value && lastValue && value.expiresAt < lastValue.expiresAt;
      const renewalThrottled = value && lastValue && !shorterLease && clock - lastWriteAt < 20_000;
      if (!same && !renewalThrottled) {
        await persist(value);
        lastValue = value;
        lastWriteAt = clock;
      }
      const displaying = Boolean(lastValue && Date.parse(lastValue.expiresAt) > now());
      diagnose(displaying ? 'home_wifi_detected' : value ? 'awaiting_new_router_observation' :
        binding?.ready ? binding.validUntilMs <= clock ? 'home_binding_expired' :
          observation?.reason || 'awaiting_router_evidence' :
          binding?.reason || 'awaiting_home_binding', displaying);
    } catch {
      diagnose('home_display_write_unavailable', false);
    } finally {
      working = false;
      if (queued && !stopped) { queued = false; void tick(); }
    }
  }
  return { tick, stop: () => { stopped = true; } };
}

function startHomeWifiPublisher({ db, imei, readObservation, resetObservation }) {
  if (!db || !/^\d{15}$/.test(imei || '')) return null;
  const publisher = createHomeWifiPublisher({
    readBinding: nowMs => loadHomeWifiBinding(db, imei, nowMs),
    readObservation, resetObservation,
    // A separate backend-owned field: no updatedAt, location, history, presence
    // heartbeat, geofence, intelligence or notification writes are triggered.
    persist: value => db.collection('devices').doc(imei).update({ homeWifiPresence: value }),
    report: data => console.log(`[wifi-home-display] ${JSON.stringify(data)}`),
  });
  void publisher.tick();
  const timer = setInterval(() => { void publisher.tick(); }, 1000);
  timer.unref?.();
  return () => { clearInterval(timer); publisher.stop(); };
}

module.exports = { loadHomeWifiBinding, createHomeWifiPublisher, startHomeWifiPublisher };
