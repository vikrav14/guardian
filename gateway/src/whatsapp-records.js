'use strict';
const { collectEvidence } = require('./intelligence-core/evidence');
const { can, PERMISSIONS } = require('./family-policy');
const menu = require('./whatsapp-menu');

// Read existing records only. No model, capture, refresh command or watch write.
async function recordedReply(db, service, uid, action, now) {
  const permissions = PERMISSIONS.filter(permission => can(service, uid, permission, now));
  const packet = await collectEvidence(db, { uid, imei: service.imei, permissions, scopeKey: `menu:${uid}` }, { now, gallery: null });
  const kinds = action === 'today' ? ['connection', 'battery', 'location', 'alert', 'alerts']
    : action === 'alerts' ? ['alert', 'alerts'] : action === 'home' ? ['location'] : [action];
  const facts = packet.facts.filter(f => kinds.includes(f.kind) &&
    (!['connection', 'battery', 'location'].includes(f.kind) || permissions.includes('location')));
  let body = `${menu.ACTIONS[action][0]} — ${menu.name(service)}\nAll times are Mauritius time.\n`;
  if (action === 'home') body += '\nHome detection uses enrolled Wi-Fi evidence. The recorded location below does not by itself confirm current presence at Home.\n';
  const link = menu.appLink(service, action);
  const footer = '\n\nRecorded information may not reflect the wearer’s current situation. Open Guardian for full details.' + (link ? `\n${link}` : '');
  let added = 0;
  for (const fact of facts) {
    // Keep complete facts and their uncertainty, never clip a disclosure.
    if ((body + '\n' + fact.text + footer).length > 1024) break;
    body += '\n' + fact.text; added++;
  }
  if (!added) body += '\nNo usable recorded information is available for this option.';
  return body + footer;
}
module.exports = { recordedReply };
