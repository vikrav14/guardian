'use strict';
// Read-only operational report. Never load gateway workers or send an AI call.
const { hash, monthKey } = require('../src/intelligence-core/policy');
async function inspectBudget(db, month) {
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) throw Error('invalid_month');
  const bucket = (await db.collection('aiBudgetMonths').doc(hash(`fleet:${month}`)).get()).data();
  const rows = await db.collection('aiAttempts').where('month', '==', month).limit(2000).get();
  const groups = new Map(); let unconfirmed = 0, overReservation = 0;
  for (const doc of rows.docs) {
    const row = doc.data(), key = `${row.feature}:${row.model}`;
    const group = groups.get(key) || { feature: row.feature, model: row.model, attempts: 0, chargedMicroUsd: 0 };
    group.attempts++; group.chargedMicroUsd += row.charged || 0; groups.set(key, group);
    if (['reserved', 'unconfirmed'].includes(row.state)) unconfirmed++;
    if (row.exceededReservation) overReservation++;
  }
  return { month, basis: 'Conservative internal ledger, not a provider invoice',
    fleet: bucket ? { chargedUsd: bucket.charged / 1e6, attempts: bucket.attempts, pricingVersion: bucket.version,
      planningMurPerUsd: bucket.murPerUsd, planningMur: bucket.charged / 1e6 * bucket.murPerUsd } : null,
    sampledAttempts: rows.docs.length, sampleComplete: rows.docs.length < 2000 && rows.docs.length === (bucket?.attempts || 0),
    sampledUnconfirmedAttempts: unconfirmed, sampledOverReservationAttempts: overReservation,
    sampleByFeatureAndModel: [...groups.values()] };
}
async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1) throw Error('usage: node scripts/inspect-ai-budget.js [YYYY-MM]');
  const db = require('../src/firestore').initFirestore({ startWatchers: false });
  if (!db) throw Error('database_unavailable');
  try { console.log(JSON.stringify(await inspectBudget(db, args[0] || monthKey(Date.now())), null, 2)); }
  finally { await db.terminate(); }
}
if (require.main === module) main().catch(() => { console.error('AI budget report unavailable; check the month and database access.'); process.exitCode = 1; });
module.exports = { inspectBudget };
