#!/usr/bin/env node
'use strict';

// Read-only Meta schema check. Does not edit templates, send messages or
// enable gateway flags. Never prints access tokens or template examples.
const config = require('../src/config');
const { checkCallTemplates } = require('../src/watch-call-template-contract');

async function main() {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--type' || !['sos', 'fall', 'both'].includes(args[1]))) {
    throw new Error('Usage: node scripts/check-watch-call-templates.js [--type sos|fall|both]');
  }
  const type = args[1] || 'both';
  if (!config.metaWhatsAppAccessToken || !/^\d+$/.test(config.metaWhatsAppWabaId)) {
    throw new Error('Configure META_WHATSAPP_ACCESS_TOKEN and META_WHATSAPP_WABA_ID privately.');
  }
  const templates = [];
  let after = null;
  for (let page = 0; page < 20; page++) {
    const url = new URL(`https://graph.facebook.com/${config.metaGraphVersion}/${config.metaWhatsAppWabaId}/message_templates`);
    url.searchParams.set('fields', 'name,status,language,category,components');
    url.searchParams.set('limit', '100');
    if (after) url.searchParams.set('after', after);
    let response;
    try {
      response = await fetch(url, { headers: { Authorization: `Bearer ${config.metaWhatsAppAccessToken}` }, signal: AbortSignal.timeout(15000) });
    } catch { throw new Error('Meta template lookup unavailable. Check network and credentials.'); }
    if (!response.ok) throw new Error(`Meta template lookup failed (HTTP ${response.status}).`);
    let data;
    try { data = await response.json(); }
    catch { throw new Error('Meta returned an unreadable template response.'); }
    if (!Array.isArray(data.data)) throw new Error('Meta returned an incomplete template response.');
    templates.push(...data.data);
    if (!data.paging?.next) break;
    after = data.paging?.cursors?.after;
    if (!after || page === 19) throw new Error('Template listing incomplete; no approval decision made.');
  }
  const checks = (type === 'both' ? ['sos', 'fall'] : [type]).flatMap(type => checkCallTemplates(templates, { type, settings: config }));
  const ready = checks.every(check => check.ready);
  console.log(JSON.stringify({ ready, checks, changesMade: false }, null, 2));
  if (!ready) process.exitCode = 1;
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
