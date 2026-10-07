'use strict';
const { fail, hash, FEATURES, INCIDENT, policy, monthKey, dayKey, cost, usageCost } = require('./policy');
function createLedger(db, { now = Date.now, limits = policy() } = {}) {
  if (!db?.runTransaction) fail('ai_budget_unavailable');
  const bucket = (scope, month) => db.collection('aiBudgetMonths').doc(hash(`${scope}:${month}`));
  const jobRef = key => db.collection('aiAttempts').doc(hash(key));
  const clean = data => {
    const value = data || { charged: 0, routine: 0, attempts: 0 };
    if (!['charged', 'routine', 'attempts'].every(k => Number.isSafeInteger(value[k]) && value[k] >= 0)) fail('ai_budget_invalid');
    return value;
  };
  async function reserve({ serviceKey, plan, jobId, attempt, feature, model, inputTokens, maxTokens }) {
    if (!FEATURES.has(feature) || !serviceKey || !jobId || !Number.isSafeInteger(attempt) ||
        attempt < 1 || attempt > limits.callsPerJob || !['family', 'care', 'background'].includes(plan)) fail('ai_scope_invalid');
    if (!Number.isSafeInteger(inputTokens) || inputTokens < 1 || inputTokens > limits.maxInputTokens ||
        !Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > limits.maxOutputTokens) fail('ai_request_too_large');
    const month = monthKey(now()), day = dayKey(now()), incident = INCIDENT.has(feature);
    const ref = jobRef(`${serviceKey}:${jobId}:${attempt}`);
    const service = bucket(serviceKey, month), fleet = bucket('fleet', month);
    const daily = db.collection('aiBudgetDays').doc(hash(`${serviceKey}:${day}`));
    // Count endpoints are estimates. Reserve 20% + 256 input tokens in addition
    // to the full output limit. Ambiguous or missing usage keeps this charge.
    const reserved = cost(model, Math.ceil(inputTokens * 1.2) + 256, maxTokens);
    return db.runTransaction(async tx => {
      if ((await tx.get(ref)).exists) fail('ai_duplicate_attempt', 409);
      const s = clean((await tx.get(service)).data()), f = clean((await tx.get(fleet)).data());
      const d = (await tx.get(daily)).data() || { attempts: 0 };
      if (!Number.isSafeInteger(d.attempts) || d.attempts < 0) fail('ai_budget_invalid');
      if (d.attempts >= limits.callsPerDay) fail('ai_daily_limit', 429);
      const ceiling = limits[plan];
      const question = ['question', 'assistant'].includes(feature) && attempt === 1;
      const questions = s.questions || 0;
      if (!Number.isSafeInteger(questions) || questions < 0) fail('ai_budget_invalid');
      if (question && questions >= (plan === 'care' ? 100 : 50)) fail('ai_question_limit', 429);
      if (s.charged + reserved > ceiling || f.charged + reserved > limits.fleet ||
          (!incident && s.routine + reserved > Math.floor(ceiling * limits.routineShare))) fail('ai_budget_reached', 429);
      tx.create(ref, { version: limits.version, month, day, serviceHash: hash(serviceKey), model, feature,
        state: 'reserved', reserved, charged: reserved, createdAtMs: now(),
        expiresAt: new Date(now() + 95 * 86400000) });
      tx.set(service, { ...s, month, version: limits.version, murPerUsd: limits.murPerUsd,
        charged: s.charged + reserved, routine: s.routine + (incident ? 0 : reserved), attempts: s.attempts + 1,
        questions: questions + (question ? 1 : 0) });
      tx.set(fleet, { ...f, month, version: limits.version, murPerUsd: limits.murPerUsd,
        charged: f.charged + reserved, routine: f.routine + (incident ? 0 : reserved), attempts: f.attempts + 1 });
      tx.set(daily, { attempts: d.attempts + 1, expiresAt: new Date(now() + 35 * 86400000) });
      return { ref, service, fleet, model, incident, reserved };
    });
  }
  async function settle(claim, usage, state = 'complete') {
    return db.runTransaction(async tx => {
      const row = (await tx.get(claim.ref)).data();
      if (!row || row.state !== 'reserved') return;
      const s = clean((await tx.get(claim.service)).data()), f = clean((await tx.get(claim.fleet)).data());
      const actual = usage ? usageCost(claim.model, usage) : claim.reserved;
      const delta = actual - claim.reserved;
      tx.update(claim.ref, { state: usage ? state : 'unconfirmed', charged: actual,
        usage: usage || null, finishedAtMs: now(), exceededReservation: actual > claim.reserved });
      tx.set(claim.service, { ...s, charged: s.charged + delta, routine: s.routine + (claim.incident ? 0 : delta) });
      tx.set(claim.fleet, { ...f, charged: f.charged + delta, routine: f.routine + (claim.incident ? 0 : delta) });
    });
  }
  return { reserve, settle };
}
module.exports = { createLedger };
