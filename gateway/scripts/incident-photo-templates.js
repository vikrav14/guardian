'use strict';
const { templateDefinitions, checkPhotoTemplates } = require('../src/incident-photo-templates');

function parseArgs(args) {
  const options = { mode: 'preview' };
  let modeSet = false;
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (['--preview', '--check', '--submit'].includes(flag)) {
      if (modeSet) throw Error('Choose one of --preview, --check or --submit.');
      options.mode = flag.slice(2); modeSet = true;
    } else if (flag === '--guardian-window') {
      options.guardianWindow = true;
    } else if (['--app-url', '--call-origin'].includes(flag)) {
      const key = flag === '--app-url' ? 'appUrl' : 'callOrigin';
      if (options[key] || !args[i + 1] || args[i + 1].startsWith('--')) throw Error(`Provide one value for ${flag}.`);
      options[key] = args[++i];
    } else throw Error('Supported options: --preview | --check | --submit, --app-url, --call-origin.');
  }
  return options;
}

async function manageTemplates({ options, settings, env = process.env, fetchImpl = fetch, report = () => {} }) {
  if (!['preview', 'check', 'submit'].includes(options.mode)) throw Error('Invalid template operation.');
  if (!settings.metaWhatsAppAccessToken || !/^\d+$/.test(settings.metaWhatsAppWabaId) ||
      !/^v\d+\.\d+$/.test(settings.metaGraphVersion)) {
    throw Error('Configure the Meta access token, numeric WABA ID and Graph version privately.');
  }
  const endpoint = `https://graph.facebook.com/${settings.metaGraphVersion}/${settings.metaWhatsAppWabaId}/message_templates`;
  const headers = { Authorization: `Bearer ${settings.metaWhatsAppAccessToken}`, 'Content-Type': 'application/json' };
  const templates = [];
  let after = null;
  const cursors = new Set();
  for (let page = 0; page < 20; page++) {
    const url = new URL(endpoint);
    url.searchParams.set('fields', 'name,status,language,category,parameter_format,components');
    url.searchParams.set('limit', '100');
    if (after) url.searchParams.set('after', after);
    let response, data;
    try {
      response = await fetchImpl(url, { headers, redirect: 'error', signal: AbortSignal.timeout(15000) });
    } catch { throw Error('Meta template lookup unavailable. No templates changed.'); }
    if (!response.ok) throw Error(`Meta template lookup failed (HTTP ${response.status}). No templates changed.`);
    try { data = await response.json(); } catch { throw Error('Meta template response unreadable. No templates changed.'); }
    if (!Array.isArray(data.data)) throw Error('Meta template listing incomplete. No templates changed.');
    templates.push(...data.data);
    if (!data.paging?.next) break;
    after = data.paging?.cursors?.after;
    if (!after || cursors.has(after) || page === 19) throw Error('Template listing incomplete; no approval decision or changes made.');
    cursors.add(after);
  }
  const definitions = templateDefinitions({
    appUrl: options.appUrl || env.INCIDENT_PHOTOS_APP_URL,
    callOrigin: options.callOrigin || settings.watchCallPublicOrigin,
    baseTemplates: templates,
    guardianWindow: options.guardianWindow === true,
  });
  const checks = checkPhotoTemplates(templates, definitions);
  // Inspect every target before the first write. A later conflicting template
  // must not leave an otherwise avoidable partial submission behind.
  const conflicts = checks.filter(check => check.problems.some(problem =>
    !['not_approved', 'missing_english_template'].includes(problem)));
  if (conflicts.length) throw Error(`Existing target contract differs: ${conflicts.map(item => item.name).join(', ')}. Nothing was overwritten or submitted.`);
  if (options.mode === 'preview') return { outcome: 'preview', definitions, checks, changesMade: false };
  if (options.mode === 'check') return { outcome: 'check', ready: checks.every(check => check.ready), checks, changesMade: false };
  const results = [];
  for (const definition of definitions) {
    const existing = templates.find(row => row.name === definition.name && row.language === 'en');
    if (existing) {
      const result = { name: definition.name, outcome: 'existing_unchanged', status: existing.status };
      results.push(result); report(result); continue;
    }
    let response;
    try {
      response = await fetchImpl(endpoint, { method: 'POST', headers, body: JSON.stringify(definition),
        redirect: 'error', signal: AbortSignal.timeout(15000) });
    } catch {
      throw Error(`Submission outcome unknown for ${definition.name}. Run --check and inspect Meta before repeating. No automatic retry was made.`);
    }
    if (!response.ok) throw Error(`Submission failed for ${definition.name} (HTTP ${response.status}). Inspect Meta before repeating; existing templates were not edited.`);
    const result = { name: definition.name, outcome: 'submitted_for_review' };
    results.push(result); report(result);
  }
  return { outcome: 'submission_complete', results, changesMade: results.some(row => row.outcome === 'submitted_for_review'), gatewayFlagsChanged: false };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await manageTemplates({ options, settings: require('../src/config'),
    report: result => console.log(JSON.stringify(result)) });
  console.log(JSON.stringify(result, null, 2));
  if (options.mode === 'check' && !result.ready) process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { parseArgs, manageTemplates };
