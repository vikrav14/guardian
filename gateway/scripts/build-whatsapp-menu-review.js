'use strict';
// Offline preview uses real navigation builders, synthetic wearers, no senders.
const fs = require('node:fs'), path = require('node:path');
const menu = require('../src/whatsapp-menu');
const uid = 'review', now = Date.now();
const service = { imei: '861000000000001', wearerName: 'Sample wearer', ownerUid: uid,
  subscription: { version: 1, managedBy: 'guardian_admin', plan: 'family', status: 'active' },
  members: { [uid]: { status: 'active' } } };
const menus = { root: menu.optionsMenu(service, uid, now) };
for (const group of Object.keys(menu.GROUPS)) menus[group] = menu.subMenu(service, uid, group, now);
for (const action of Object.keys(menu.ACTIONS)) {
  menus[action] = menu.resultMenu(service, menu.READS.has(action)
    ? `${menu.ACTIONS[action][0]} — Sample wearer\n\nThis preview contains no live records. In WhatsApp this option returns recorded information with timestamps and limitations.\n\nOpen Guardian for full details.`
    : `${menu.ACTIONS[action][0]} — Sample wearer\n\nOpens ${menu.ACTIONS[action][2]} in the authenticated Guardian app. Your current access is checked again.\n\nNo call, recording, photo or setting change starts when you open a menu option.`);
}
const template = fs.readFileSync(path.join(__dirname, '../review/whatsapp-menu.html'), 'utf8');
const html = template.replace('/*MENU_DATA*/{}', JSON.stringify(menus).replace(/</g, '\\u003c'));
const output = process.argv[2];
if (!output || path.extname(output) !== '.html') throw Error('Supply an output .html file');
fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
fs.writeFileSync(output, html);
console.log('Synthetic menu preview built; no external calls made.');
