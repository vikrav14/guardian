'use strict';
const { templateDefinitions } = require('../src/incident-photo-templates');
const flag = name => process.argv.includes(`--${name}`);
const value = name => flag(name) ? process.argv[process.argv.indexOf(`--${name}`) + 1] : null;
async function main() {
  const definitions = templateDefinitions({ appUrl: value('app-url'), callNumber: value('call-number') });
  if (!flag('submit') && !flag('check')) { console.log(JSON.stringify(definitions, null, 2)); return; }
  if (flag('submit') && flag('check')) throw Error('Choose --submit or --check.');
  const config = require('../src/config');
  if (!config.metaWhatsAppWabaId || !config.metaWhatsAppAccessToken) throw Error('Meta WABA ID and access token are required in the local environment.');
  const endpoint = `https://graph.facebook.com/${config.metaGraphVersion}/${config.metaWhatsAppWabaId}/message_templates`;
  const headers = { Authorization: `Bearer ${config.metaWhatsAppAccessToken}`, 'Content-Type': 'application/json' };
  for (const definition of definitions) {
    const url = new URL(endpoint); url.searchParams.set('name', definition.name);
    url.searchParams.set('fields', 'id,name,status,language,components');
    const response = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw Error(`Meta template lookup failed (${response.status}). No further changes made.`);
    const rows = (await response.json()).data || [];
    const existing = rows.find(row => row.name === definition.name && row.language === definition.language);
    if (existing) {
      console.log(`${definition.name}: ${existing.status}`);
      const comparable = components => components.map(component => {
        const { type, format, text, buttons } = component;
        return { type, ...(format ? { format } : {}), ...(text ? { text } : {}),
          ...(buttons ? { buttons: buttons.map(({ type, text, url, phone_number }) => ({ type, text,
            ...(url ? { url } : {}), ...(phone_number ? { phone_number } : {}) })) } : {}) };
      });
      if (JSON.stringify(comparable(existing.components)) !== JSON.stringify(comparable(definition.components))) {
        throw Error('Existing version differs from the reviewed contract. Review it before switching; it was not overwritten.');
      }
      if (flag('check') && existing.status !== 'APPROVED') process.exitCode = 1;
      continue;
    }
    if (flag('check')) { console.log(`${definition.name}: MISSING`); process.exitCode = 1; continue; }
    const created = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(definition),
      redirect: 'error', signal: AbortSignal.timeout(15_000) });
    if (!created.ok) throw Error(`Meta template submission failed (${created.status}). Check Meta before repeating; existing templates were not edited.`);
    console.log(`${definition.name}: submitted for Meta review`);
  }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
