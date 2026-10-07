'use strict';
const { createHash } = require('node:crypto');
const { can, activeMember, serviceEntitlements } = require('./family-policy');
const hash = value => createHash('sha256').update(value).digest('hex');
const PREFIX = 'guardian_menu:v2:';
const key = service => hash(service.imei).slice(0, 20);
const id = (action, target) => `${PREFIX}${action}:${target}`;
const name = service => String(service.wearerName || 'Your family member').replace(/[\r\n\t]/g, ' ').slice(0, 80);
const GROUPS = {
  overview: ['Today’s overview', 'Recorded status and recent alerts', ['today', 'updates']],
  tracking: ['Location & journeys', 'Last position, Home and journey history', ['location', 'home', 'journey']],
  safety: ['Alerts & photos', 'Incidents, responses and eligible photos', ['alerts', 'incidents', 'photos']],
  watch: ['Watch status', 'Check-in, battery and watch settings', ['connection', 'battery', 'settings']],
  medicine: ['Medicine reminders', 'Schedules and recorded reminders', ['reminders']],
  wellbeing: ['Wellness', 'Readings, history and scheduled checks', ['wellness', 'routine', 'movement']],
  communication: ['Call & voice messages', 'Open calling or your voice conversation', ['call', 'voice']],
  places: ['Home & safe zones', 'Home detection and saved places', ['home', 'zones']],
  family: ['Family & settings', 'Sharing, WhatsApp preferences and help', ['family_access', 'account', 'help']],
};
const ACTIONS = {
  today: ['Today’s overview', null, 'today'],
  updates: ['Local updates & weather', 'location', 'updates'],
  location: ['Last known location', 'location', 'location'],
  home: ['Home detection', 'location', 'location'],
  journey: ['Journey history', 'history', 'journey'],
  alerts: ['Recent alerts', 'alerts', 'alerts'],
  incidents: ['Incidents & responses', 'alerts', 'alerts'],
  photos: ['Photos & AI details', 'photos', 'photos'],
  connection: ['Last watch check-in', 'location', 'watch'],
  battery: ['Watch battery', 'location', 'watch'],
  settings: ['Watch settings', 'settings', 'settings'],
  reminders: ['Medicine schedule', 'reminders', 'reminders'],
  wellness: ['Readings & history', 'wellbeing', 'wellness'],
  routine: ['Wellness routine', 'wellbeing', 'routine'],
  movement: ['Movement reminders', 'reminders', 'movement'],
  call: ['Call watch in app', 'location', 'call'],
  voice: ['Voice messages', 'voice', 'voice'],
  zones: ['Manage Home & zones', 'zones', 'zones'],
  family_access: ['Family & WhatsApp', null, 'family'],
  account: ['Account & preferences', null, 'account'],
  help: ['Using Guardian', null, 'help'],
};
const READS = new Set(['today', 'location', 'home', 'alerts', 'connection', 'battery']);
function allowed(service, uid, action, now = Date.now()) {
  if (!ACTIONS[action] || !activeMember(service, uid, now) || !serviceEntitlements(service, now).serviceActive) return false;
  if (action === 'today') return can(service, uid, 'location', now) || can(service, uid, 'alerts', now);
  if (action === 'photos' && !can(service, uid, 'alerts', now)) return false;
  return !ACTIONS[action][1] || can(service, uid, ACTIONS[action][1], now);
}
const appDestinations = (service, uid, now) => [...new Set(Object.keys(ACTIONS)
  .filter(action => allowed(service, uid, action, now)).map(action => ACTIONS[action][2]))];
function selection(value) {
  const match = /^guardian_menu:v([12]):([a-z_]+):([a-f0-9]{20}|[0-3])$/.exec(value || '');
  if (!match) return null;
  let [, version, action, target] = match;
  if (version === '1' && !['wearer', 'location', 'battery', 'app', 'page'].includes(action)) return null;
  if (action === 'app') action = 'account';
  if (action === 'page') return /^[0-3]$/.test(target) ? { action, target } : null;
  if (!/^[a-f0-9]{20}$/.test(target) || !['wearer', ...Object.keys(GROUPS), ...Object.keys(ACTIONS)].includes(action)) return null;
  return { action, target };
}
function recentInbound(message, now) {
  const at = Number(message.timestamp) * 1000;
  return Number.isFinite(at) && at > 0 && now - at >= -300000 && now - at < 24 * 3600000;
}
function wearerMenu(services, page = 0) {
  page = Math.min(Math.max(0, page), Math.max(0, Math.ceil(services.length / 8) - 1));
  const rows = services.slice(page * 8, page * 8 + 8).map(service => ({
    id: id('wearer', key(service)), title: name(service).slice(0, 24), description: 'Choose this wearer',
  }));
  if (page > 0) rows.push({ id: id('page', page - 1), title: 'Previous wearers' });
  if ((page + 1) * 8 < services.length) rows.push({ id: id('page', page + 1), title: 'More wearers' });
  return { body: 'Hi, I’m Guardian. Who would you like to check on?', button: 'Choose a wearer', rows };
}
function optionsMenu(service, uid, now, multiple = false) {
  const rows = Object.entries(GROUPS).filter(([, group]) => group[2].some(action => allowed(service, uid, action, now)))
    .map(([action, group]) => ({ id: id(action, key(service)), title: group[0], description: group[1] }));
  if (multiple) rows.push({ id: id('page', 0), title: 'Switch wearer' });
  return { body: `Guardian menu for ${name(service)}.\n\nChoose an option below. Send menu at any time to return here.`, button: 'Choose an option', rows };
}
function backRows(service, multiple) {
  return [{ id: id('wearer', key(service)), title: 'Back to main menu' },
    ...(multiple ? [{ id: id('page', 0), title: 'Switch wearer' }] : [])];
}
function subMenu(service, uid, action, now, multiple = false) {
  const group = GROUPS[action];
  const rows = group[2].filter(leaf => allowed(service, uid, leaf, now)).map(leaf => ({
    id: id(leaf, key(service)), title: ACTIONS[leaf][0],
    description: READS.has(leaf) ? 'Read recorded information here' : 'Open this feature securely in Guardian',
  }));
  return { body: `${group[0]} for ${name(service)}. Only features shared with you appear.`, button: 'Choose an option', rows: [...rows, ...backRows(service, multiple)] };
}
function resultMenu(service, body, multiple = false) {
  return { body, button: 'More options', rows: backRows(service, multiple) };
}
function appLink(service, action) {
  try {
    const url = new URL(process.env.INCIDENT_PHOTOS_APP_URL);
    if (url.protocol !== 'https:' || url.username || url.password || !ACTIONS[action]) return null;
    return `${url.origin}/?guardianScreen=${ACTIONS[action][2]}&guardianWearer=${key(service)}`;
  } catch { return null; }
}
function appReply(service, action) {
  const link = appLink(service, action);
  const note = action === 'photos' ? 'Photos are private. A new photo needs an eligible SOS or fall incident within its one-hour access window.'
    : action === 'call' ? 'Opening this link does not place a call. Use Call watch in the app when ready.'
      : action === 'reminders' ? 'View or manage standard and recorded-voice reminders. A scheduled reminder does not confirm medicine was taken.'
        : action === 'help' ? 'Use this menu to check records or open shared features. For urgent help, contact the wearer or emergency services directly.'
          : 'Sign in to open this feature. Guardian checks your current shared access.';
  return `${ACTIONS[action][0]} — ${name(service)}\n\n${note}\n\n${link || 'Open the Guardian app to continue.'}`;
}
// Claim before handoff: provider retries and ambiguous sends must not fan out.
async function sendNavigation({ db, uid, message, now, send, menu, text, sendMenu, authorize = async () => true }) {
  if (!recentInbound(message, now) || !message.id || message.id.length > 256) return;
  const ref = db.collection('familyNotices').doc(hash(`menu:${uid}:${message.id}`));
  const claimed = await db.runTransaction(async tx => {
    if ((await tx.get(ref)).exists) return false;
    tx.create(ref, { uid, reason: 'menu', createdAtMs: now, expiresAt: new Date(now + 48 * 3600000), state: 'sending' });
    return true;
  });
  if (!claimed) return;
  let result;
  try { result = !await authorize() ? { skipped: true } : menu ? await sendMenu(message.from, menu) : await send(message.from, text); }
  catch { result = { ok: false }; }
  await ref.update({ state: result?.ok ? 'accepted' : result?.status >= 400 || result?.skipped ? 'failed' : 'unknown',
    finishedAtMs: now, ...(result?.messageId ? { messageId: result.messageId } : {}),
    ...(Number.isInteger(result?.errorCode) ? { errorCode: result.errorCode } : {}) });
}
module.exports = { PREFIX, key, id, name, GROUPS, ACTIONS, READS, allowed, appDestinations, selection,
  recentInbound, wearerMenu, optionsMenu, subMenu, resultMenu, appLink, appReply, sendNavigation };
