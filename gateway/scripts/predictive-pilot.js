#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const observer = require('../src/predictive-pilot/observer');

function atomicJson(file, value) {
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(temporary, file);
}
function lock(directory) {
  const file = path.join(directory, 'observer.lock');
  if (fs.existsSync(file)) {
    const previous = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Number.isInteger(previous.pid) || previous.pid <= 0) throw new Error('invalid_observer_lock');
    try { process.kill(previous.pid, 0); throw new Error('observer_already_running'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
    fs.unlinkSync(file);
  }
  fs.writeFileSync(file, JSON.stringify({ pid: process.pid }), { flag: 'wx', mode: 0o600 });
  return () => fs.unlinkSync(file);
}
function reportText(r) {
  const when = value => value == null ? 'none yet' : new Date(value).toLocaleString('en-GB', { timeZone: 'Indian/Mauritius', hour12: false }) + ' MUT';
  const lines = ['GUARDIAN PREDICTIVE PILOT — PRIVATE', '', `Status: ${r.status}`, `Report: ${when(r.generatedAt)}`,
    `Last successful observation: ${when(r.lastSuccessfulPollAt)}`, `Automatic end: ${when(r.endsAt)}`,
    '', 'Evaluation only. No app alerts or changes to recorded journeys.',
    `History: ${r.history?.journeysExamined ?? 0} journeys examined; ${r.history?.eligibleReturnDays ?? 0} eligible GPS-confirmed return days.`,
    `Recent battery observations: ${r.batteryObservations}. Observation gaps over 45 minutes: ${r.observationGaps}.`, ''];
  for (const [kind, s] of Object.entries(r.summary)) {
    lines.push(`${kind.toUpperCase()}: ${s.issued} issued; ${s.scored} scored; ${s.pending} pending; ${s.inconclusive} inconclusive.`,
      `Window hit rate: ${s.windowHitRate == null ? 'not available yet' : Math.round(s.windowHitRate * 100) + '% (' + s.withinWindow + '/' + s.scored + ')'}.`,
      `Current decision: ${s.currentDecision?.reason || s.currentDecision?.status || 'no current decision'}.`, '');
  }
  for (const p of r.forecasts) lines.push(`${p.kind}: issued ${when(p.issuedAt)}; predicted window ${when(p.lowerAt)} to ${when(p.upperAt)}; ${p.outcome.status}${p.outcome.reason ? ' (' + p.outcome.reason + ')' : ''}.`);
  lines.push('', 'Paid AI calls: 0. Paid AI cost: USD 0.', `Document-read reservations: ${JSON.stringify(r.costs.reservedDocumentReadsByDay)}. Cap: 800 per Mauritius day.`,
    r.costs.note, '', ...r.limitations.map(s => '- ' + s));
  return lines.join('\n') + '\n';
}
async function main(args = process.argv.slice(2)) {
  if (args.length !== 3 || args[0] !== '--config' || !['--once', '--watch'].includes(args[2])) throw new Error('usage: --config <private-config.json> --once|--watch');
  const config = observer.validateConfig(JSON.parse(fs.readFileSync(path.resolve(args[1]), 'utf8')));
  // Only explicitly supplied service credentials. No .env loading and no
  // imports of the gateway initializer (which can register command watchers).
  const credentialFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credentialFile || !path.isAbsolute(credentialFile)) throw new Error('explicit_credentials_required');
  const credential = JSON.parse(fs.readFileSync(credentialFile, 'utf8'));
  if (credential.project_id !== config.projectId) throw new Error('credential_project_mismatch');
  fs.mkdirSync(config.outputDirectory, { recursive: true });
  const unlock = lock(config.outputDirectory);
  let app, stopped = false;
  const stateFile = path.join(config.outputDirectory, 'state.json');
  let timer, wake;
  const stop = () => { stopped = true; clearTimeout(timer); wake?.(); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  try {
    let state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : observer.initialState(config);
    observer.checkState(state, config);
    const admin = require('firebase-admin');
    app = admin.initializeApp({ credential: admin.credential.cert(credential), projectId: config.projectId }, 'predictive-pilot');
    const db = admin.firestore(app);
    do {
      state = await observer.poll({ db, config, state, save: value => atomicJson(stateFile, value), accessNow: Date.now });
      const result = observer.report(state, config);
      atomicJson(path.join(config.outputDirectory, 'report.json'), result);
      fs.writeFileSync(path.join(config.outputDirectory, 'report.txt'), reportText(result), { mode: 0o600 });
      console.log(JSON.stringify({ at: result.generatedAt, status: result.status, issued: state.forecasts.length }));
      if (args[2] === '--once' || state.status === 'complete' || stopped) break;
      await new Promise(resolve => { wake = resolve; timer = setTimeout(resolve, Math.min(config.pollMs, Math.max(1, config.endsAt - Date.now()))); });
      wake = null;
    } while (!stopped);
  } finally {
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    try { if (app) await app.delete(); } finally { unlock(); }
  }
}
if (require.main === module) main().catch(() => { console.error('Predictive pilot stopped: check private configuration, credentials, output state/lock and connectivity. No gateway changes were made.'); process.exitCode = 1; });
module.exports = { main, atomicJson, lock, reportText };
