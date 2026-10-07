'use strict';
// Isolated qualification of the real service, evidence adapter and metered client.
// Uses synthetic in-memory records with a durable local evidence file. It never
// starts a gateway, reads Firestore, sends a notification or issues a watch command.
const fs = require('node:fs'), path = require('node:path');
const { database } = require('../test/helpers/command-database');
const { cases, seedCase, grade } = require('../eval/intelligence-cases');
const { createIntelligenceService } = require('../src/intelligence-core/service');
const { collectEvidence } = require('../src/intelligence-core/evidence');
const AnthropicProvider = require('../src/providers/anthropic-provider');
const MODEL = 'claude-haiku-4-5-20251001';
function parseArgs(args) {
  const live = args.includes('--live');
  const remaining = args.filter(a => a !== '--live');
  if (remaining.length !== 2 || remaining[0] !== '--out' || !remaining[1]) throw Error('Use [--live] --out NEW_DIRECTORY');
  return { live, outDir: path.resolve(remaining[1]) };
}
async function qualify({ live = false, outDir, apiKey = process.env.ANTHROPIC_API_KEY, caseIds = null } = {}) {
  if (caseIds && (!Array.isArray(caseIds) || !caseIds.length || caseIds.some(id => !cases.some(c => c.id === id)))) throw Error('Unknown qualification case');
  const selectedCases = caseIds ? cases.filter(c => caseIds.includes(c.id)) : cases;
  if (live && !apiKey) throw Error('ANTHROPIC_API_KEY is required for explicit live qualification.');
  if (!outDir || fs.existsSync(outDir)) throw Error('Choose a new evidence directory; existing runs cannot be overwritten or resumed.');
  fs.mkdirSync(outDir, { recursive: true });
  // Fixed run ceilings, not caller-supplied production policy. Rs5 at the
  // versioned Rs50/USD planning conversion; actual provider invoices can differ.
  Object.assign(process.env, { AI_BUDGET_MUR_PER_USD: '50', AI_FAMILY_MONTHLY_MUR: '5',
    AI_CARE_MONTHLY_MUR: '5', AI_FLEET_MONTHLY_MUR: '5', AI_BACKGROUND_MONTHLY_MUR: '5' });
  const db = database(), transaction = db.runTransaction, clock = Date.now();
  const save = () => fs.writeFileSync(path.join(outDir, 'synthetic-ledger.json'), JSON.stringify([...db.rows], null, 2));
  db.runTransaction = async fn => { const value = await transaction(fn); save(); return value; };
  let generations = 0, tokenCounts = 0, current, providerFailure, providerOutput;
  const provider = new AnthropicProvider({ anthropicApiKey: live ? apiKey : 'synthetic-test-key', anthropicModel: MODEL,
    fetchImpl: async (url, request) => {
      const count = url === 'https://api.anthropic.com/v1/messages/count_tokens';
      if (!count && url !== 'https://api.anthropic.com/v1/messages') throw Error('Unexpected qualification endpoint');
      const body = JSON.parse(request.body), input = JSON.parse(body.messages[0].content);
      if (input.question !== current.question || body.tools?.length) throw Error('Only the current fixed synthetic question may be sent');
      if (count) tokenCounts++; else if (++generations > selectedCases.length) throw Error('Qualification call bound exceeded');
      if (live) return fetch(url, request);
      if (count) return { ok: true, json: async () => ({ input_tokens: 700 }) };
      const wanted = current.empty ? [] : input.facts.filter(f => current.packet.facts.some(p => p.id === f.id && current.required?.includes(p.kind))).map(f => f.id);
      return { ok: true, json: async () => ({ content: [{ type: 'text', text: JSON.stringify({ evidenceIds: wanted, answerable: wanted.length > 0 }) }],
        stop_reason: 'end_turn', usage: { input_tokens: 700, output_tokens: 60 } }) };
    } });
  const complete = provider.complete.bind(provider);
  provider.complete = async value => {
    try {
      const result = await complete(value);
      // Diagnostic text is allowed only here: all model input is fixed synthetic
      // evidence. The production service still stores selections/usage only.
      providerOutput = { stopReason: result.stopReason, text: result.content.filter(p => p.type === 'text').map(p => p.text).join('').slice(0, 1500) };
      return result;
    }
    catch (error) { providerFailure = { code: error.code || error.name, httpStatus: error.httpStatus || null }; throw error; }
  };
  const results = [];
  const report = { startedAt: new Date(clock).toISOString(), synthetic: true, liveProvider: live, model: MODEL,
    reservedCeilingUsd: 0.1, planningMurPerUsd: 50, caseCount: selectedCases.length, results };
  const write = () => {
    const attempts = [...db.rows].filter(([key]) => key.startsWith('aiAttempts/')).map(([, row]) => row);
    report.generations = generations; report.tokenCounts = tokenCounts;
    report.chargedMicroUsd = attempts.reduce((sum, row) => sum + row.charged, 0);
    report.planningMur = report.chargedMicroUsd / 1e6 * 50;
    report.usage = { inputTokens: attempts.reduce((sum, row) => sum + (row.usage?.input_tokens || 0), 0),
      outputTokens: attempts.reduce((sum, row) => sum + (row.usage?.output_tokens || 0), 0),
      unconfirmedAttempts: attempts.filter(row => row.state === 'unconfirmed' || row.state === 'reserved').length };
    report.passed = results.filter(row => row.passed).length; report.failed = results.length - report.passed;
    fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
    save();
  };
  fs.writeFileSync(path.join(outDir, 'run-consumed.json'), JSON.stringify({ live, model: MODEL, startedAt: report.startedAt }));
  for (const [index, scenario] of selectedCases.entries()) {
    current = scenario; providerFailure = null; providerOutput = null;
    const fixture = seedCase(db, scenario, index, clock);
    const service = createIntelligenceService({ db, provider, now: () => clock,
      collect: async (store, access, options) => {
        current.packet = await collectEvidence(store, access, { ...options, gallery: fixture.gallery });
        return current.packet;
      } });
    const before = generations, started = Date.now(); let result, error;
    try { result = await service.answer({ ...fixture, question: scenario.question }); }
    catch (failure) { error = failure.code || failure.name; }
    const issues = grade(scenario, result, error);
    if (providerFailure) issues.push(`Provider path: ${providerFailure.code}${providerFailure.httpStatus ? ' HTTP ' + providerFailure.httpStatus : ''}`);
    // A repeat with identical evidence must not create another paid generation.
    let repeatCalls = 0;
    if (result && !providerFailure) {
      const previous = generations; await service.answer({ ...fixture, question: scenario.question });
      repeatCalls = generations - previous;
      if (repeatCalls) issues.push('Repeated question generated another provider request.');
    }
    results.push({ id: scenario.id, question: scenario.question || '(Open overview)', passed: issues.length === 0, issues,
      expected: scenario.error ? `Denied: ${scenario.error}` : scenario.empty ? 'Insufficient recorded information' : scenario.required.join(', '),
      mode: result?.mode || null, reason: result?.reason || error || null, message: result?.message || null, answerable: result?.answerable ?? false,
      evidence: (result?.facts || []).map(f => ({ kind: f.kind, text: f.text })),
      ...(providerOutput ? { providerOutput } : {}),
      generations: generations - before, repeatGenerations: repeatCalls, latencyMs: Date.now() - started });
    write();
    // Do not keep charging after a provider/configuration or budget failure.
    if (providerFailure) { report.stopped = providerFailure; break; }
  }
  report.finishedAt = new Date().toISOString(); report.complete = results.length === selectedCases.length; write();
  return report;
}
if (require.main === module) {
  let options;
  try { options = parseArgs(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
  if (options) qualify(options).then(report => {
    console.log(JSON.stringify({ liveProvider: report.liveProvider, complete: report.complete, passed: report.passed, failed: report.failed,
      generations: report.generations, planningMur: report.planningMur, stopped: report.stopped || null, outDir: options.outDir }));
    if (!report.complete || report.failed) process.exitCode = 1;
  }).catch(error => { console.error(JSON.stringify({ qualificationFailed: true, code: error.code || error.name })); process.exitCode = 1; });
}
module.exports = { qualify, parseArgs };
