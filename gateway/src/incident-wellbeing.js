'use strict';

const { randomUUID } = require('node:crypto');
const { normalizeWellbeingEvent } = require('./care-wellbeing');
const { asDate } = require('./safety-snapshot-policy');
const { validIncidentId } = require('./incident-photo-policy');

const { OPTICAL_WINDOW_MS } = require('./conditional-wellness-trial');
const RESULT_WINDOW_MS = 9 * 60_000;
// Camera completion can be later than minute five. Allow a new optical stage
// while its full response window fits; later temperature needs its own budget.
// Persist deadlines once. Existing jobs keep their original start deadline.
const START_WINDOW_MS = RESULT_WINDOW_MS - OPTICAL_WINDOW_MS;
const RETENTION_MS = 24 * 60 * 60_000;
const LEASE_MS = 30_000;
const DEVICE_RESERVATION_MS = 4 * 60_000 + LEASE_MS;
const ACTIVE = ['queued', 'dispatching', 'collecting'];
const ms = value => asDate(value)?.getTime() ?? NaN;

// The V52 does not echo our request ID or a measurement timestamp. Keep the
// original session/request correlation explicit; never copy "latest readings".
function samplesFromSequence(job, sequence, at) {
  const readings = { ...(job.readings || {}) };
  function add(key, record, event, requestedAt, deadlineAt) {
    if (readings[key] || !record?.usable) return;
    const received = ms(record.receivedAt), requested = ms(requestedAt);
    if (!Number.isFinite(received) || !Number.isFinite(requested) ||
        requested < ms(job.eventAt) || received < requested || received > +at ||
        received >= ms(deadlineAt) || received >= ms(job.deadlineAt)) return;
    const result = normalizeWellbeingEvent({ type: 'health_reading', imei: job.imei, ...event }, new Date(received));
    if (!result.ok) return;
    readings[key] = { values: result.values, metricSet: result.metricSet,
      requestedAt: new Date(requested), receivedAt: new Date(received),
      sourceCommand: result.sourceCommand, quality: 'transport_valid_unverified',
      timeBasis: 'gateway_receipt_not_measurement_time', correlationOnly: true,
      wearingConfirmed: false };
  }
  const heart = sequence?.optical?.heartBloodPressure;
  add('heartBloodPressure', heart, { metric: 'heart_rate_bp',
    heartRate: heart?.values?.heartRateBpm, systolic: heart?.values?.systolicMmHg,
    diastolic: heart?.values?.diastolicMmHg }, sequence?.requestedAt, sequence?.opticalDeadlineAt);
  const oxygen = sequence?.optical?.oxygen;
  add('oxygen', oxygen, { metric: 'spo2', value: oxygen?.values?.spo2Percent },
    sequence?.requestedAt, sequence?.opticalDeadlineAt);
  const temperature = sequence?.temperature?.trial;
  if (temperature?.handoff === 'command_handed_off' && temperature.sessionMatches === true &&
      temperature.positionBasis === 'incident' && !sequence.temperature.temperatureIngestionSuppressed) {
    for (const packet of temperature.packets || []) {
      if (packet.kind !== 'temperature_upload' || !packet.accepted || packet.command !== 'btemp2') continue;
      add('temperature', { usable: true, receivedAt: packet.receivedAt },
        { metric: 'skin_temperature', sourceCommand: 'btemp2', args: packet.args },
        temperature.requestedAt, temperature.captureExpiresAt);
    }
  }
  return readings;
}

function resultState(readings) {
  const count = Object.keys(readings || {}).length;
  return count === 3 ? 'available' : count ? 'partial' : 'unavailable';
}

function createIncidentWellbeing({ db, enabled = () => false, authorize,
  availability, request, status, now = () => new Date(), workerId = randomUUID() }) {
  const ref = id => db.collection('incidentWellbeing').doc(id);
  const alertRef = id => db.collection('alerts').doc(id);
  const lockRef = imei => db.collection('incidentWellbeingLocks').doc(imei);
  let running;

  async function enqueue(id) {
    if (!validIncidentId(id)) return;
    const alert = (await alertRef(id).get()).data();
    if (!alert?.incidentWellbeingPending || alert.incidentWellbeingEligible !== true ||
        !['sos', 'fall'].includes(alert.type) || !/^\d{15}$/.test(alert.imei)) return;
    const access = enabled() ? await authorize(alert.imei) : null;
    await db.runTransaction(async tx => {
      const fresh = (await tx.get(alertRef(id))).data();
      const existing = await tx.get(ref(id));
      if (!fresh?.incidentWellbeingPending) return;
      if (existing.exists) {
        tx.update(alertRef(id), { incidentWellbeingPending: false, wellbeingIncidentId: id }); return;
      }
      const at = now();
      const allowed = enabled() && access?.ok && ms(alert.eventAt) <= +at && +at - ms(alert.eventAt) <= 90_000;
      tx.create(ref(id), { version: 2, id, imei: alert.imei, type: alert.type,
        ownerUid: access?.ownerUid || null, eventAt: asDate(alert.eventAt), createdAt: at,
        startDeadlineAt: new Date(ms(alert.eventAt) + START_WINDOW_MS || +at),
        deadlineAt: new Date(ms(alert.eventAt) + RESULT_WINDOW_MS || +at),
        expiresAt: new Date(+at + RETENTION_MS), state: allowed ? 'queued' : 'unavailable',
        reason: allowed ? null : 'access_disabled_or_alert_expired', readings: {},
        automaticRetry: false, updatedAt: at });
      tx.update(alertRef(id), { incidentWellbeingPending: false, wellbeingIncidentId: id });
    });
  }

  async function finish(job, reason, readings, { clear = false } = {}) {
    await db.runTransaction(async tx => {
      const fresh = (await tx.get(ref(job.id))).data();
      if (!fresh || !ACTIVE.includes(fresh.state) || fresh.frozenAt) return;
      const saved = clear ? {} : { ...readings, ...fresh.readings };
      tx.update(ref(job.id), { state: resultState(saved), reason,
        readings: saved, completedAt: now(), updatedAt: now() });
    });
  }

  async function isCurrent(job) {
    if (!enabled()) return false;
    const access = await authorize(job.imei, job.ownerUid);
    const fresh = (await ref(job.id).get()).data();
    return !!access?.ok && access.ownerUid === job.ownerUid &&
      fresh?.workerId === workerId && ['dispatching', 'collecting'].includes(fresh.state) &&
      !fresh.frozenAt && ms(fresh.leaseUntil) > +now() && ms(fresh.deadlineAt) > +now();
  }

  async function tick(id) {
    const job = (await ref(id).get()).data();
    if (!job || !ACTIVE.includes(job.state)) return;
    const access = enabled() ? await authorize(job.imei, job.ownerUid) : null;
    if (!access?.ok || access.ownerUid !== job.ownerUid) return finish(job, 'access_or_consent_unavailable', {}, { clear: true });
    if (job.state === 'queued') {
      if (+now() >= ms(job.startDeadlineAt)) return finish(job, job.waitReason || 'start_window_expired');
      const busy = await availability(job);
      if (busy) {
        if (busy === 'unsupported_device') return finish(job, busy);
        await ref(id).update({ waitReason: busy, updatedAt: now() }); return;
      }
      const claimed = await db.runTransaction(async tx => {
        const fresh = (await tx.get(ref(id))).data();
        const lock = (await tx.get(lockRef(job.imei))).data();
        if (fresh?.state !== 'queued' || ms(fresh.startDeadlineAt) <= +now()) return false;
        if (lock && ms(lock.until) > +now()) return false;
        // Durable before any hardware write. An ambiguous send is never retried.
        // The device reservation survives restart and excludes overlapping jobs;
        // a distinct alert always owns a new reading, never another alert's data.
        tx.set(lockRef(job.imei), { incidentId: id, until: new Date(+now() + DEVICE_RESERVATION_MS) });
        tx.update(ref(id), { state: 'dispatching', workerId, dispatchClaimedAt: now(),
          leaseUntil: new Date(+now() + LEASE_MS), updatedAt: now() }); return true;
      });
      if (!claimed) return;
      try {
        const result = await request({ imei: job.imei, startDeadlineAt: ms(job.startDeadlineAt),
          deadlineAt: ms(job.deadlineAt),
          isCurrent: () => isCurrent(job) });
        if (result?.outcome !== 'optical_request_handed_off') return finish(job, 'measurement_not_sent_or_handoff_unknown');
        await db.runTransaction(async tx => {
          const fresh = (await tx.get(ref(id))).data();
          if (fresh?.state !== 'dispatching' || fresh.workerId !== workerId || fresh.frozenAt ||
              !(ms(fresh.leaseUntil) > +now())) return;
          tx.update(ref(id), { state: 'collecting', attemptId: result.attemptId,
            requestedAt: new Date(result.requestedAt), leaseUntil: new Date(+now() + LEASE_MS), updatedAt: now() });
        });
      } catch { await finish(job, 'measurement_preflight_or_handoff_failed'); }
      return;
    }
    // Another process may still be collecting. A lost lease never means replay.
    if (job.workerId !== workerId) {
      if (ms(job.leaseUntil) <= +now()) await finish(job, 'gateway_interrupted');
      return;
    }
    if (job.state === 'dispatching') return finish(job, 'dispatch_outcome_unknown');
    if (+now() >= ms(job.deadlineAt)) return finish(job, 'result_window_expired');
    const snapshot = await status({ includeValues: true });
    const sequence = snapshot?.sequence;
    if (!sequence || sequence.attemptId !== job.attemptId || sequence.positionBasis !== 'incident') {
      return finish(job, 'measurement_session_unavailable');
    }
    const readings = samplesFromSequence(job, sequence, now());
    // Status includes asynchronous consent reads. Never save a late result
    // after revocation, a lost lease or another worker's interruption decision.
    if (!await isCurrent(job)) return finish(job, 'access_or_lease_changed', {}, { clear: true });
    if (sequence.terminal || +now() >= ms(job.deadlineAt)) {
      return finish(job, sequence.reason || (sequence.terminal ? 'measurement_finished' : 'result_window_expired'), readings);
    }
    await db.runTransaction(async tx => {
      const fresh = (await tx.get(ref(id))).data();
      if (fresh?.state !== 'collecting' || fresh.workerId !== workerId || fresh.frozenAt ||
          !(ms(fresh.leaseUntil) > +now())) return;
      tx.update(ref(id), { readings: { ...readings, ...fresh.readings },
        leaseUntil: new Date(+now() + LEASE_MS), updatedAt: now() });
    });
  }

  async function readForFollowup(alertId, ownerUid, { freeze = false } = {}) {
    const alert = (await alertRef(alertId).get()).data();
    if (alert?.incidentWellbeingPending && ms(alert.eventAt) + RESULT_WINDOW_MS > +now()) return { pending: true };
    if (!validIncidentId(alert?.wellbeingIncidentId)) return { pending: false, state: 'unavailable', readings: {} };
    const id = alert.wellbeingIncidentId;
    const job = (await ref(id).get()).data();
    if (!job || id !== alertId || job.id !== id || job.imei !== alert.imei || job.ownerUid !== ownerUid ||
        !(ms(job.expiresAt) > +now())) return { pending: false, state: 'unavailable', readings: {} };
    const access = enabled() ? await authorize(job.imei, ownerUid) : null;
    if (!access?.ok || access.ownerUid !== ownerUid) return { pending: false, state: 'unavailable', readings: {} };
    if (ACTIVE.includes(job.state) && ms(job.deadlineAt) > +now()) return { pending: true };
    if (ACTIVE.includes(job.state)) await finish(job, 'result_window_expired');
    return db.runTransaction(async tx => {
      const fresh = (await tx.get(ref(id))).data();
      if (!fresh || !(ms(fresh.expiresAt) > +now())) return { pending: false, state: 'unavailable', readings: {} };
      if (ACTIVE.includes(fresh.state)) return { pending: true };
      if (freeze && !fresh.frozenAt) tx.update(ref(id), { frozenAt: now() });
      return { pending: false, state: fresh.state, eventAt: fresh.eventAt,
        requestedAt: fresh.requestedAt || null, readings: fresh.readings || {}, incidentId: id };
    });
  }

  async function sweep() {
    if (running) return running;
    running = (async () => {
      const queue = await db.collection('alerts').where('incidentWellbeingPending', '==', true).limit(25).get();
      for (const doc of queue.docs) await enqueue(doc.id);
      const work = await db.collection('incidentWellbeing').where('state', 'in', ACTIVE).limit(25).get();
      for (const doc of work.docs) await tick(doc.id);
    })().finally(() => { running = null; });
    return running;
  }
  return { enqueue, tick, sweep, readForFollowup };
}

module.exports = { createIncidentWellbeing, samplesFromSequence, START_WINDOW_MS,
  RESULT_WINDOW_MS, RETENTION_MS, LEASE_MS, DEVICE_RESERVATION_MS };
