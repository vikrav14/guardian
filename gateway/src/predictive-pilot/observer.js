'use strict';

// This module only uses document/query reads. It must never import the gateway,
// notification transports, watch commands, provider clients or Firestore writers.
const crypto = require('node:crypto');
const path = require('node:path');
const { authorizeIntelligence } = require('../intelligence-core/access');
const model = require('./models');
const { DAY, HOUR, MINUTE, ms, localDay } = model;
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const HISTORY_LIMIT = 120;
const FIELDS = ['departureAt', 'returnAt', 'originGeofenceId', 'closeReason', 'evidenceVersion', 'routeStartAnchored', 'pointCount', 'departureEvidence', 'returnEvidence'];

function validateConfig(input) {
  if (!input || !/^\d{15}$/.test(input.imei || '') || !/^[^/\s]{1,128}$/.test(input.uid || '') || input.uid !== input.ownerUid ||
      !/^[^/\s]{1,128}$/.test(input.homeZoneId || '') || !/^[a-z][a-z0-9-]{3,62}$/.test(input.projectId || '') ||
      !path.isAbsolute(input.outputDirectory || '')) throw new Error('invalid_pilot_config');
  const startedAt = ms(input.startedAt), endsAt = ms(input.endsAt);
  if (!startedAt || !endsAt || endsAt <= startedAt || endsAt - startedAt > 14 * DAY) throw new Error('invalid_pilot_duration');
  return { imei: input.imei, uid: input.uid, ownerUid: input.ownerUid, homeZoneId: input.homeZoneId, projectId: input.projectId,
    outputDirectory: path.resolve(input.outputDirectory), startedAt, endsAt, pollMs: 10 * MINUTE, dailyReadCap: 800 };
}
function configKey(c) { return digest([c.projectId, c.imei, c.uid, c.ownerUid, c.homeZoneId, c.startedAt, c.endsAt]); }
function initialState(c) {
  return { version: 1, configKey: configKey(c), budget: {}, forecasts: [], samples: [], history: null,
    scopeKey: null, homeKey: null, lastSuccessfulPollAt: null, lastPollAt: null, observationGaps: 0, status: 'starting' };
}
function checkState(state, c) {
  if (state.version !== 1 || state.configKey !== configKey(c) || !state.budget || Array.isArray(state.budget) ||
      Object.entries(state.budget).some(([day, count]) => !/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isSafeInteger(count) || count < 0 || count > c.dailyReadCap) ||
      Object.keys(state.budget).length > 15 || !Array.isArray(state.forecasts) || state.forecasts.length > 30 ||
      state.forecasts.some(p => !['arrival', 'battery'].includes(p.kind) || !ms(p.issuedAt) || !ms(p.evidenceThrough) ||
        !ms(p.lowerAt) || !ms(p.upperAt) || p.lowerAt >= p.upperAt ||
        !['pending', 'scored', 'inconclusive'].includes(p.outcome?.status)) ||
      !Array.isArray(state.samples) || state.samples.length > 200 ||
      state.samples.some(s => !ms(s.at) || !Number.isFinite(s.percent) || s.percent < 0 || s.percent > 100) ||
      (state.history && (!ms(state.history.readAt) || typeof state.history.complete !== 'boolean' || !Array.isArray(state.history.returns)))) throw new Error('pilot_state_mismatch');
}
function invalidate(state, reason) {
  state.samples = []; state.history = null; state.forecasts = []; state.decisions = null;
  state.status = reason; state.scopeKey = null; state.homeKey = null;
}
function safeError(error) {
  const code = error?.code || error?.message;
  return ['access_not_shared', 'active_service_required', 'service_needs_review', 'pilot_permission_required', 'pilot_access_changed',
    'pilot_home_unavailable', 'daily_read_cap_reached', 'pilot_clock_moved_backwards'].includes(code) ? code : 'read_failed';
}

// save() must persist atomically. Reservations are saved BEFORE every network
// read, including failures and a pessimistic 121 reads for the bounded query.
async function poll({ db, config: c, state, save, now = Date.now(), accessNow = () => now }) {
  checkState(state, c);
  if (now < c.startedAt) { state.status = 'not_started'; await save(state); return state; }
  if (now >= c.endsAt) {
    for (const p of state.forecasts.filter(p => p.outcome.status === 'pending')) p.outcome = { status: 'inconclusive', reason: 'pilot_ended_before_evaluation' };
    state.status = 'complete'; state.decisions = null; await save(state); return state;
  }
  const day = localDay(now);
  async function read(cost, fn) {
    const used = state.budget[day] || 0;
    if (used + cost > c.dailyReadCap) throw new Error('daily_read_cap_reached');
    state.budget[day] = used + cost;
    await save(state);
    return fn();
  }
  async function access() {
    const a = await read(1, () => authorizeIntelligence(db, c.uid, c.imei, { now: accessNow() }));
    if (a.ownerUid !== c.ownerUid || !['location', 'history'].every(p => a.permissions.includes(p))) throw new Error('pilot_permission_required');
    return a;
  }
  try {
    if (state.lastPollAt && now < state.lastPollAt) throw new Error('pilot_clock_moved_backwards');
    const priorPoll = state.lastPollAt;
    state.lastPollAt = now;
    const grant = await access();
    if (state.scopeKey && state.scopeKey !== grant.scopeKey) invalidate(state, 'scope_changed');
    const device = (await read(1, () => db.collection('devices').doc(c.imei).get())).data();
    const rawHome = (await read(1, () => db.collection('geofences').doc(c.homeZoneId).get())).data();
    if (!device || !rawHome || rawHome.imei !== c.imei || rawHome.active !== true ||
        !Number.isFinite(rawHome.center?.lat) || Math.abs(rawHome.center.lat) > 90 ||
        !Number.isFinite(rawHome.center?.lng) || Math.abs(rawHome.center.lng) > 180 ||
        !Number.isFinite(rawHome.radiusMeters) || rawHome.radiusMeters < 1) throw new Error('pilot_home_unavailable');
    const home = { id: c.homeZoneId, center: rawHome.center, radiusMeters: rawHome.radiusMeters, updatedAt: ms(rawHome.updatedAt) };
    const homeKey = digest(home);
    if (state.homeKey && state.homeKey !== homeKey) invalidate(state, 'home_changed');
    let history = state.history;
    if (!history || localDay(history.readAt) !== day) {
      const result = await read(HISTORY_LIMIT + 1, () => db.collection('devices').doc(c.imei).collection('journeys')
        .where('endAt', '>=', new Date(now - 56 * DAY)).orderBy('endAt', 'desc').limit(HISTORY_LIMIT + 1).select(...FIELDS).get());
      history = { readAt: now, examined: result.docs.length, complete: result.docs.length <= HISTORY_LIMIT,
        returns: model.homeReturns(result.docs.map(d => d.data()), home, now) };
    }
    const recheck = await access();
    if (recheck.scopeKey !== grant.scopeKey) throw new Error('pilot_access_changed');
    state.scopeKey = grant.scopeKey; state.homeKey = homeKey; state.history = history;
    if (priorPoll && now - priorPoll > 45 * MINUTE) state.observationGaps++;
    const sample = model.batterySample(device, now);
    if (sample && !state.samples.some(s => s.at === sample.at)) state.samples.push(sample);
    state.samples.sort((a, b) => a.at - b.at);
    // Retain baseline samples until evaluation has finished (horizon <= 12h).
    state.samples = state.samples.filter(s => now - s.at <= 24 * HOUR).slice(-200);
    for (const p of state.forecasts.filter(p => p.outcome.status === 'pending')) {
      p.outcome = p.kind === 'arrival' && !history.complete ? { status: 'inconclusive', reason: 'history_query_truncated' }
        : model.evaluate(p, { returns: history.returns, samples: state.samples, now });
      if (p.outcome.status !== 'pending') p.evaluatedAt = now;
    }
    const candidates = [model.arrivalForecast({ returns: history.returns, home, device, now, historyComplete: history.complete }),
      model.batteryForecast({ samples: state.samples, device, now })];
    state.decisions = {};
    for (let i = 0; i < candidates.length; i++) {
      const kind = i === 0 ? 'arrival' : 'battery', candidate = candidates[i];
      if (state.forecasts.some(p => p.kind === kind && (p.day === day || p.outcome.status === 'pending'))) {
        state.decisions[kind] = { status: 'withheld', reason: 'forecast_already_issued' };
      } else {
        state.decisions[kind] = candidate;
        if (candidate.status === 'forecast') state.forecasts.push({ ...candidate, id: digest([kind, day, now]).slice(0, 16), outcome: { status: 'pending' } });
      }
    }
    state.lastSuccessfulPollAt = now; state.status = 'observing';
  } catch (error) {
    const reason = safeError(error);
    if (['access_not_shared', 'active_service_required', 'service_needs_review', 'pilot_permission_required', 'pilot_access_changed', 'pilot_home_unavailable'].includes(reason)) invalidate(state, reason);
    else { state.status = reason; state.decisions = null; }
  }
  await save(state);
  return state;
}

function report(state, c, now = Date.now()) {
  const summary = {};
  for (const kind of ['arrival', 'battery']) {
    const all = state.forecasts.filter(p => p.kind === kind), scored = all.filter(p => p.outcome.status === 'scored');
    summary[kind] = { issued: all.length, pending: all.filter(p => p.outcome.status === 'pending').length,
      inconclusive: all.filter(p => p.outcome.status === 'inconclusive').length, scored: scored.length,
      withinWindow: scored.filter(p => p.outcome.withinWindow).length,
      windowHitRate: scored.length ? scored.filter(p => p.outcome.withinWindow).length / scored.length : null,
      currentDecision: state.decisions?.[kind] || null };
  }
  const arrivalScored = state.forecasts.filter(p => p.kind === 'arrival' && p.outcome.status === 'scored');
  summary.arrival.meanAbsoluteErrorMinutes = arrivalScored.length ? arrivalScored.reduce((sum, p) => sum + p.outcome.absoluteErrorMinutes, 0) / arrivalScored.length : null;
  return { pilot: 'Guardian predictive pilot', mode: 'local evaluation only', model: model.VERSION,
    generatedAt: new Date(now).toISOString(), startedAt: new Date(c.startedAt).toISOString(), endsAt: new Date(c.endsAt).toISOString(),
    status: state.status, lastSuccessfulPollAt: state.lastSuccessfulPollAt ? new Date(state.lastSuccessfulPollAt).toISOString() : null,
    observationGaps: state.observationGaps, history: state.history ? { readAt: new Date(state.history.readAt).toISOString(),
      journeysExamined: state.history.examined, queryComplete: state.history.complete, eligibleReturnDays: state.history.returns.length } : null,
    batteryObservations: state.samples.length, summary, forecasts: state.forecasts,
    costs: { paidModelCalls: 0, paidModelCost: 0, currency: 'USD', reservedDocumentReadsByDay: state.budget,
      dailyDocumentReadReservationCap: c.dailyReadCap, note: 'Conservative read reservations, including failures; not a bill. Existing Firestore/storage/network charges may apply.' },
    limitations: ['Experimental baselines; intervals are not calibrated probabilities.', 'Laptop and internet must remain available. No backfilled battery history.',
      'Arrival target is first GPS-confirmed Home return after noon, not a live ETA.', 'History refreshes daily; arrival scoring can be delayed until the next day.',
      'No family alerts, provider calls, route reconstruction, watch commands or Firestore writes.'] };
}
module.exports = { validateConfig, configKey, initialState, checkState, poll, report };
