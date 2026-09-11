'use strict';

const { evaluateSubscription } = require('./entitlements');
const { validAnchor, evaluateHomeWifiDisplay } = require('./wifi-home-display-policy');
const { validHomeRadius } = require('./wifi-home-gps-policy');

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
  // Match the existing legacy-zone default; malformed supplied radii fail closed.
  const anchor = { geofenceId: home.id, lat: home.center?.lat, lng: home.center?.lng,
    radiusMeters: home.radiusMeters ?? 150 };
  if (!validAnchor(anchor)) return { ready: false, reason: 'home_pin_invalid' };
  if (!validHomeRadius(anchor.radiusMeters)) return { ready: false, reason: 'home_radius_invalid' };
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
    key: JSON.stringify([home.id, anchor.lat, anchor.lng, anchor.radiusMeters, ownerUid]),
    // Binding is rechecked every 30 seconds; a failed/hung read cannot renew it.
    validUntilMs: Math.min(nowMs + 60_000, access.accessUntil?.getTime() ?? Infinity) };
}

function createHomeWifiPublisher({ readBinding, readObservation, readGpsObservation = () => null, resetObservation,
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
  let phase = 'idle';
  let operationStartedAt = null;
  let lastHomePublication = null;
  let lastConflictPublication = null;
  let lastClearedAt = null;
  let lastClearedReason = null;

  function selection(clock = now()) {
    return evaluateHomeWifiDisplay(readObservation(clock), binding, clock, readGpsObservation());
  }

  // Read the running publisher even while an SDK operation is pending. Keep
  // only the last successful, still-usable Home write, so normal expiry can be
  // distinguished from a publisher that never published. No persistent history
  // or device/router identifiers are added for this operator diagnostic.
  function getStatus(clock = now()) {
    const bindingReady = binding?.ready === true && binding.validUntilMs > clock;
    const decision = selection(clock);
    const eligible = decision.value?.state === 'matched';
    const conflictEligible = decision.value?.state === 'conflict';
    const pendingSeconds = operationStartedAt == null ? null :
      Math.max(0, Math.floor((clock - operationStartedAt) / 1000));
    const publishedHomeFresh = Boolean(eligible && lastValue?.state === 'matched' &&
      Date.parse(lastValue.observedAt) <= clock && Date.parse(lastValue.expiresAt) > clock);
    const publishedConflictFresh = Boolean(conflictEligible && lastValue?.state === 'conflict' &&
      Date.parse(lastValue.observedAt) <= clock && Date.parse(lastValue.expiresAt) > clock);
    return {
      active: !stopped,
      phase,
      pendingSeconds,
      operationSlow: pendingSeconds != null && pendingSeconds >= 15,
      homeBindingReady: bindingReady,
      bindingReason: bindingReady ? 'ready' : binding?.ready ? 'home_binding_expired' :
        binding?.reason || 'awaiting_home_binding',
      homeEvidenceEligible: !stopped && eligible,
      selectionReason: decision.reason,
      publishedHomeFresh: !stopped && publishedHomeFresh,
      wifiConflictEligible: !stopped && conflictEligible,
      publishedConflictFresh: !stopped && publishedConflictFresh,
      lastHomePublication: lastHomePublication ? { ...lastHomePublication } : null,
      lastConflictPublication: lastConflictPublication ? { ...lastConflictPublication } : null,
      lastClearedAt,
      lastClearedReason,
    };
  }

  function diagnose(reason, displaying) {
    const displayingConflict = getStatus().publishedConflictFresh;
    const key = `${reason}|${displaying}|${displayingConflict}`;
    if (key === lastDiagnostic) return;
    lastDiagnostic = key;
    report({ pilot: true, displayEnabled: true, displayingHome: displaying,
      displayingConflict, reason });
  }

  async function tick() {
    if (stopped) return;
    if (working) {
      queued = true;
      const status = getStatus();
      if (status.operationSlow) diagnose(`${phase}_pending`, status.publishedHomeFresh);
      return;
    }
    working = true;
    try {
      if (now() >= nextBindingAt) {
        nextBindingAt = now() + 30_000;
        phase = 'home_binding_read';
        operationStartedAt = now();
        try { binding = await readBinding(now()); }
        catch { binding = { ready: false, reason: 'home_binding_unavailable' }; }
        phase = 'idle';
        operationStartedAt = null;
        if (stopped) return;
        const key = binding?.ready ? binding.key : null;
        if (key !== bindingKey) {
          bindingKey = key;
          resetObservation(); // Reconfirm after enrollment/anchor/owner changes.
        }
      }
      const clock = now();
      const decision = selection(clock);
      const value = decision.value;
      const same = JSON.stringify(value) === JSON.stringify(lastValue);
      // Clear invalid evidence immediately and bound periodic renewal writes.
      // A freshly verified binding can extend the display lease only as far as
      // the ORIGINAL radio expiry (capped by buildHomeWifiDisplay). Its source
      // time never changes. This avoids a gap between valid 40–60s radio reports
      // without turning cellular packets or heartbeats into Home observations.
      const shorterLease = value && lastValue && value.expiresAt < lastValue.expiresAt;
      const stateChanged = value?.state !== lastValue?.state || value?.conflictReason !== lastValue?.conflictReason;
      const renewalThrottled = value && lastValue && !shorterLease && !stateChanged && clock - lastWriteAt < 20_000;
      if (!same && !renewalThrottled) {
        phase = 'home_presence_write';
        operationStartedAt = now();
        await persist(value);
        if (stopped) return;
        lastValue = value;
        lastWriteAt = now();
        const currentValue = selection(lastWriteAt).value;
        if (value && Date.parse(value.expiresAt) > lastWriteAt && currentValue?.state === value.state) {
          const publication = { confirmedAt: new Date(lastWriteAt).toISOString(),
            observedAt: value.observedAt, expiresAt: value.expiresAt };
          if (value.state === 'matched') lastHomePublication = publication;
          else lastConflictPublication = publication;
        } else if (!value) {
          lastClearedAt = new Date(lastWriteAt).toISOString();
          lastClearedReason = decision.reason;
        }
      }
      const current = getStatus();
      diagnose(current.publishedHomeFresh ? 'home_wifi_detected' : current.selectionReason,
        current.publishedHomeFresh);
    } catch {
      diagnose('home_display_write_unavailable', false);
    } finally {
      phase = 'idle';
      operationStartedAt = null;
      working = false;
      if (queued && !stopped) { queued = false; void tick(); }
    }
  }
  // Packet tracking reads the same current decision synchronously. No database
  // access, writes, hardware commands or dependency on publication latency.
  const getEvidence = (clock = now()) => stopped ? null : selection(clock).value;
  return { tick, getStatus, getEvidence, stop: () => { stopped = true; } };
}

function startHomeWifiPublisher({ db, imei, readObservation, readGpsObservation, resetObservation }) {
  if (!db || !/^\d{15}$/.test(imei || '')) return null;
  const publisher = createHomeWifiPublisher({
    readBinding: nowMs => loadHomeWifiBinding(db, imei, nowMs),
    readObservation, readGpsObservation, resetObservation,
    // A separate backend-owned field: no updatedAt, location, history, presence
    // heartbeat, geofence, intelligence or notification writes are triggered.
    persist: value => db.collection('devices').doc(imei).update({ homeWifiPresence: value }),
    report: data => console.log(`[wifi-home-display] ${JSON.stringify(data)}`),
  });
  void publisher.tick();
  const timer = setInterval(() => { void publisher.tick(); }, 1000);
  timer.unref?.();
  const stop = () => { clearInterval(timer); publisher.stop(); };
  stop.getStatus = publisher.getStatus;
  stop.getEvidence = publisher.getEvidence;
  return stop;
}

module.exports = { loadHomeWifiBinding, createHomeWifiPublisher, startHomeWifiPublisher };
