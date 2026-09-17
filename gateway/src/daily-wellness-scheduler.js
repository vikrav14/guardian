'use strict';

const TIME_ZONE = 'Indian/Mauritius';
const DUE_WINDOW_MS = 60_000;
const SLOT_COUNTS = Object.freeze({ manual: 0, gentle: 2, balanced: 3 });

function asDate(value) {
  try {
    const date = value?.toDate?.() || (value instanceof Date ? value : null);
    return date instanceof Date && Number.isFinite(+date) ? new Date(+date) : null;
  } catch { return null; }
}

function parseDailyRoutine(request) {
  if (!request || request.version !== 2 || !Object.hasOwn(SLOT_COUNTS, request.routine) ||
      Object.keys(request).some(key => !['version', 'routine', 'times', 'timeZone', 'updatedAt', 'requestedBy', 'revision'].includes(key)) ||
      request.timeZone !== TIME_ZONE || !Array.isArray(request.times) ||
      request.times.length !== SLOT_COUNTS[request.routine] ||
      typeof request.requestedBy !== 'string' || !request.requestedBy.trim() ||
      request.requestedBy.length > 128 || request.requestedBy.includes('/')) return null;
  const updatedAt = asDate(request.updatedAt);
  if (!updatedAt || request.times.some(time => typeof time !== 'string' || time.length !== 5 ||
    !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))) return null;
  const minutes = request.times.map(time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3)));
  for (let i = 1; i < minutes.length; i++) if (minutes[i] - minutes[i - 1] < 5) return null;
  if (minutes.length && 1440 - minutes.at(-1) + minutes[0] < 5) return null;
  return { version: 2, routine: request.routine, times: [...request.times],
    timeZone: TIME_ZONE, updatedAt, requestedBy: request.requestedBy };
}

// This product contract accepts Mauritius only; its clock is UTC+04:00.
function localDate(at) { return new Date(+at + 4 * 3600_000).toISOString().slice(0, 10); }
function scheduledAt(date, time) { return new Date(`${date}T${time}:00+04:00`); }
function slotFor(date, time) {
  return { slotId: `${date}-${time.replace(':', '')}`, date, time, scheduledAt: scheduledAt(date, time) };
}
function nextCheck(request, at) {
  if (!request || !request.times.length) return null;
  const date = localDate(at);
  for (const time of request.times) {
    const candidate = scheduledAt(date, time);
    if (+candidate > +at && +candidate >= +request.updatedAt) return candidate;
  }
  const tomorrow = localDate(+scheduledAt(date, '00:00') + 86400_000);
  return scheduledAt(tomorrow, request.times[0]);
}
function restoredAttempt(record) {
  if (!record) return null;
  const normalized = { ...record };
  for (const key of ['scheduledAt', 'claimedAt', 'startedAt', 'updatedAt', 'finishedAt', 'expiresAt', 'activeUntil']) {
    if (record[key] != null) normalized[key] = asDate(record[key]) || record[key];
  }
  return normalized;
}

function createDailyWellnessScheduler({ read, claim, save, execute, status, clock = Date.now }) {
  let pending = null, active = null, cachedDate = null;
  const resolved = new Set();
  let summary = { phase: 'idle', reason: 'no_schedule', routine: 'manual', times: [],
    timeZone: TIME_ZONE, nextCheckAt: null, lastAttempt: null, inFlight: false };

  function snapshot() {
    return { ...summary, times: [...summary.times],
      lastAttempt: summary.lastAttempt ? { ...summary.lastAttempt } : null };
  }
  function remember(record) {
    if (!record) return;
    record = restoredAttempt(record);
    const prior = summary.lastAttempt;
    if (!prior || +new Date(record.scheduledAt) >= +new Date(prior.scheduledAt)) summary.lastAttempt = { ...record };
  }
  async function checkpoint(attempt, patch) {
    const next = { ...attempt, ...patch, updatedAt: new Date(clock()) };
    delete next.restored;
    const result = await save(next);
    if (result?.saved === false) throw new Error('schedule_checkpoint_unavailable');
    Object.assign(attempt, next);
    remember(attempt);
  }
  function block(context) {
    if (!context.enabled) return 'pilot_disabled';
    if (!context.authorized) return 'access_or_consent_unavailable';
    if (!context.connected) return 'watch_offline';
    return context.blockedReason || null;
  }
  async function pollActive() {
    if (!active) return;
    const attempt = active;
    let observed = null;
    try { if (attempt.attemptId) observed = (await status({ attemptId: attempt.attemptId }))?.sequence; }
    catch { /* A lost status response never permits another dispatch. */ }
    if (observed?.attemptId === attempt.attemptId && observed.terminal === true) {
      await checkpoint(attempt, { phase: 'finished', outcome: observed.outcome,
        reason: observed.reason || null, terminal: true, finishedAt: new Date(clock()),
        temperatureRequested: Boolean(observed.temperature?.trialId) });
      active = null;
    } else if ((attempt.restored && observed?.attemptId !== attempt.attemptId) ||
        +new Date(attempt.activeUntil) <= clock()) {
      await checkpoint(attempt, { phase: 'finished', outcome: 'interrupted_unknown',
        reason: 'attempt_status_unavailable', terminal: true, finishedAt: new Date(clock()) });
      active = null;
    }
    summary.inFlight = Boolean(active);
  }

  async function run() {
    const context = await read();
    if (!context) { summary.phase = 'unavailable'; summary.reason = 'schedule_context_unavailable'; return; }
    const at = clock();
    const normalized = parseDailyRoutine(context.request);
    remember(context.lastAttempt);
    if (!active && context.lastAttempt?.terminal === false && context.lastAttempt?.slotId) {
      active = { ...restoredAttempt(context.lastAttempt), restored: true };
    }
    await pollActive();
    summary = { ...summary, routine: normalized?.routine || 'manual', times: normalized?.times || [],
      timeZone: TIME_ZONE, nextCheckAt: nextCheck(normalized, clock()), inFlight: Boolean(active) };
    if (!normalized) { summary.phase = 'blocked'; summary.reason = context.blockedReason || 'schedule_invalid'; return; }
    if (normalized.routine === 'manual') {
      summary.phase = context.blockedReason ? 'blocked' : 'manual';
      summary.reason = context.blockedReason || null;
      return;
    }
    if (+normalized.updatedAt > at) { summary.phase = 'blocked'; summary.reason = 'schedule_from_future'; return; }
    const revision = normalized.updatedAt.toISOString();
    if (context.revision !== revision) { summary.phase = 'blocked'; summary.reason = 'schedule_revision_changed'; return; }
    const date = localDate(clock());
    if (cachedDate !== date) { resolved.clear(); cachedDate = date; }
    summary.phase = active ? 'running' : block(context) ? 'blocked' : 'scheduled';
    summary.reason = block(context);
    for (const time of normalized.times) {
      const slot = slotFor(date, time);
      if (+slot.scheduledAt > clock() || resolved.has(slot.slotId)) continue;
      // Editing a schedule today does not create pretend attempts before the
      // new selection existed. Previously recorded slots remain immutable.
      if (+slot.scheduledAt < +normalized.updatedAt) { resolved.add(slot.slotId); continue; }
      let reason = clock() - +slot.scheduledAt >= DUE_WINDOW_MS ? 'missed'
          : block(context) || (active ? 'attempt_in_progress' : null);
      const disposition = reason ? 'skipped' : 'attempt';
      const result = await claim({ ...slot, revision, requestUpdatedAt: normalized.updatedAt,
        maxAttempts: normalized.times.length, disposition, ...(reason ? { reason } : {}) });
      if (!result?.claimed) {
        if (result?.record) { resolved.add(slot.slotId); remember(result.record); }
        if (result?.reason) { summary.phase = 'blocked'; summary.reason = result.reason; }
        continue;
      }
      resolved.add(slot.slotId);
      const attempt = { ...slot, revision,
        phase: disposition === 'attempt' ? 'dispatch_pending' : 'finished',
        outcome: disposition === 'attempt' ? 'dispatch_pending' : 'skipped',
        terminal: disposition === 'skipped', ...(reason ? { reason } : {}),
        ...restoredAttempt(result.record) };
      remember(attempt);
      if (disposition === 'skipped' || result.record?.terminal === true) continue;
      active = attempt;
      summary.phase = 'running'; summary.reason = null; summary.inFlight = true;
      // The durable claim consumes the slot before I/O. Re-read authorization
      // and revision after transaction latency and before any device request.
      const latest = await read();
      const latestRoutine = parseDailyRoutine(latest?.request);
      reason = !latest || latest.revision !== revision || !latestRoutine ||
        latestRoutine.updatedAt.toISOString() !== revision ? 'schedule_revision_changed'
        : block(latest) || (clock() - +slot.scheduledAt >= DUE_WINDOW_MS ||
          clock() < +slot.scheduledAt ? 'missed' : null);
      if (reason) {
        await checkpoint(attempt, { phase: 'finished', outcome: 'skipped', reason,
          terminal: true, finishedAt: new Date(clock()) });
        active = null; summary.inFlight = false; summary.reason = reason;
        continue;
      }
      let handoff;
      try {
        handoff = await execute({ ...slot, revision,
          isCurrent: () => active === attempt && !attempt.terminal });
      } catch {
        await checkpoint(attempt, { phase: 'finished', outcome: 'handoff_unknown',
          reason: 'dispatch_result_unavailable', terminal: true, finishedAt: new Date(clock()) });
        active = null; summary.inFlight = false;
        continue;
      }
      const handedOff = handoff?.outcome === 'optical_request_handed_off';
      await checkpoint(attempt, { phase: handedOff ? 'waiting_results' : 'finished',
        outcome: typeof handoff?.outcome === 'string' ? handoff.outcome : 'handoff_unknown',
        attemptId: typeof handoff?.attemptId === 'string' ? handoff.attemptId : null,
        terminal: !handedOff,
        ...(handedOff ? {} : { finishedAt: new Date(clock()), reason: 'optical_request_not_confirmed' }) });
      if (!handedOff) { active = null; summary.inFlight = false; }
    }
    summary.nextCheckAt = nextCheck(normalized, clock());
  }
  return { snapshot, tick() {
    if (!pending) pending = run().finally(() => { pending = null; });
    return pending;
  } };
}

module.exports = { createDailyWellnessScheduler, parseDailyRoutine, TIME_ZONE,
  DUE_WINDOW_MS, SLOT_COUNTS, localDate, slotFor };
