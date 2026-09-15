'use strict';

const { randomUUID } = require('node:crypto');
const { validConsent } = require('./care-wellbeing');
const { loadEntitlementsForUser } = require('./entitlements');
const { createRoutineController, parseTemperatureMode, temperatureCommand } = require('./wellness-routine');
const { findSocketsForDevice } = require('./sessions');
const { sendDownlinkCommand } = require('./downlink');

let runtime;
const date = value => value?.toDate?.() || (value == null ? null : new Date(value));

function startWellnessRoutineRuntime({ db, config, wearEvidence }) {
  const imei = config.wifiHomePilotImei;
  if (!db || !/^\d{15}$/.test(imei || '')) return null;
  const owner = randomUUID();
  const stateRef = db.collection('devices').doc(imei).collection('wellnessRoutine').doc('current');
  const requestRef = db.collection('wellnessRoutineRequests').doc(imei);
  const sessionIds = new WeakMap();
  function live() {
    const matches = findSocketsForDevice(imei).filter(({ socket }) => !socket.destroyed);
    if (matches.length !== 1) return { connected: false, reason: 'single_session_required' };
    const session = matches[0].session;
    if (!sessionIds.has(session)) sessionIds.set(session, randomUUID());
    return { connected: true, sessionId: sessionIds.get(session),
      bt: session.wellnessTemperatureMode?.bt ?? null,
      tm: session.wellnessTemperatureMode?.tm ?? null,
      wear: wearEvidence.current(imei) };
  }
  async function read() {
    const [requestDoc, grantDoc, consentDoc] = await Promise.all([
      requestRef.get(), db.collection('wellnessPilots').doc(imei).get(),
      db.collection('wellbeingConsents').doc(imei).get(),
    ]);
    const request = requestDoc.data(), grant = grantDoc.data(), consent = consentDoc.data();
    const at = new Date();
    const state = await db.runTransaction(async tx => {
      const prior = (await tx.get(stateRef)).data() || {};
      if (prior.leaseOwner && prior.leaseOwner !== owner && +date(prior.leaseUntil) > +at) return null;
      // No routine means no default commands. A diagnostic summary is useful
      // even before the first request, without retaining raw CONFIG contents.
      tx.set(stateRef, { leaseOwner: owner, leaseUntil: new Date(+at + 60_000) }, { merge: true });
      return prior;
    });
    if (!state) return null;
    const uid = request?.requestedBy;
    const userDoc = typeof uid === 'string' && uid.length > 0 && !uid.includes('/')
      ? await db.collection('users').doc(uid).get() : null;
    const user = userDoc?.data();
    const access = user ? await loadEntitlementsForUser(db, { ...user, uid }, { now: new Date() }) : null;
    const now = new Date();
    const grantValid = grant?.version === 1 && grant.managedBy === 'guardian_admin' &&
      grant.enabled === true && grant.viewerUid === uid &&
      +date(grant.createdAt) <= +now && +date(grant.expiresAt) > +now &&
      +date(grant.expiresAt) - +date(grant.createdAt) <= 86400_000;
    const linked = user?.linkedImeis?.includes(imei) === true && access?.serviceActive === true;
    const requestTime = date(request?.updatedAt);
    const requestValid = request?.version === 1 && Number.isFinite(+requestTime) && requestTime != null &&
      +requestTime <= +now && typeof request?.routine === 'string';
    return { state, request: requestValid ? { ...request, revision: requestTime.toISOString() } : null,
      enabled: config.wellnessRoutinePilotEnabled && config.careWellbeingRequestEnabled && config.careWellbeingIngestEnabled,
      canStop: linked && grantValid,
      authorized: linked && grantValid && validConsent(consent, now),
      validUntil: new Date(Math.min(+date(grant?.expiresAt) || 0,
        +(access?.accessUntil || new Date('9999-01-01')),
        +(date(consent?.expiresAt) || new Date('9999-01-01')))),
    };
  }
  async function save(patch) {
    await db.runTransaction(async tx => {
      const doc = (await tx.get(stateRef)).data();
      if (doc?.leaseOwner !== owner || +date(doc?.leaseUntil) <= Date.now()) throw new Error('routine_lease_lost');
      tx.set(stateRef, patch, { merge: true });
    });
  }
  const controller = createRoutineController({ read, live, save,
    send: command => {
      if (!live().connected) return { ok: false };
      return sendDownlinkCommand(imei, command);
    } });
  function tick() { return controller.tick().catch(() => console.warn('[wellness-routine] reconciliation_failed')); }
  function observe(decoded, session) {
    if (session?.imei !== imei) return;
    const mode = parseTemperatureMode(decoded);
    if (mode !== undefined) session.wellnessTemperatureMode = mode;
    // No async read in the GPS/SOS/ACK path. Coalescing occurs in tick().
  }
  let singleRequestAt = 0;
  async function requestTemperature() {
    // A bounded operator comparison, not an app/customer action. A supplied
    // reading never upgrades wearing evidence or validates an automatic cycle.
    if (!config.careWellbeingRequestEnabled || !config.careWellbeingIngestEnabled) {
      throw new Error('Wellbeing request and ingestion must be enabled.');
    }
    const consent = (await db.collection('wellbeingConsents').doc(imei).get()).data();
    if (!validConsent(consent, new Date())) throw new Error('Current wearer consent is required.');
    const device = live();
    if (!device.connected) throw new Error('One connected watch session is required.');
    if (device.bt !== 2) throw new Error('Waiting for this session to report CONFIG BT:2.');
    if (Date.now() - singleRequestAt < 120_000) throw new Error('Wait two minutes before another temperature request.');
    singleRequestAt = Date.now();
    const result = sendDownlinkCommand(imei, temperatureCommand({ action: 'single' }));
    return { outcome: result.ok ? 'request_handed_off' : 'watch_not_connected',
      readingConfirmed: false, wearingConfirmed: false };
  }
  const timer = setInterval(tick, 20_000); timer.unref?.();
  void tick();
  runtime = { observe, tick, requestTemperature,
    async status() {
      const state = (await stateRef.get()).data() || {};
      const { leaseOwner, leaseUntil, handoffKey, revision, ...summary } = state;
      const device = live();
      return { ...summary, connected: device.connected, temperatureBt: device.bt ?? null,
        temperatureTm: device.tm ?? null, observedModeFrom: 'current_gateway_session',
        routinePilotEnabled: config.wellnessRoutinePilotEnabled === true };
    },
    close: () => clearInterval(timer),
  };
  return runtime;
}

module.exports = { startWellnessRoutineRuntime, getWellnessRoutineRuntime: () => runtime };
