'use strict';
const { hash } = require('./family-store');
const { can } = require('./family-policy');

const PREFIX = 'guardian_menu:v1:';
const key = service => hash(service.imei).slice(0, 20);
const id = (action, target) => `${PREFIX}${action}:${target}`;
const name = service => String(service.wearerName || 'Your family member').replace(/[\r\n\t]/g, ' ').slice(0, 80);
function isMenuRequest(text) {
  return /^(hi|hello|hey|help|menu|options|start|bonjour|bonsoir|salut|good morning|good afternoon|good evening)[\s!?.]*$/i.test(String(text || '').trim());
}
function selection(value) {
  const match = /^guardian_menu:v1:(wearer|location|battery|app|page):([a-f0-9]{20}|[0-3])$/.exec(value || '');
  return match ? { action: match[1], target: match[2] } : null;
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
  const target = key(service), rows = [];
  if (can(service, uid, 'location', now)) rows.push(
    { id: id('location', target), title: 'Last known location', description: 'See the last recorded position' },
    { id: id('battery', target), title: 'Watch battery', description: 'Check the last reported battery level' },
  );
  rows.push({ id: id('app', target), title: 'Open Guardian', description: 'Photos, voice messages and other shared features in the app' });
  if (multiple) rows.push({ id: id('page', 0), title: 'Choose another wearer' });
  return { body: `Hi, I’m Guardian. What would you like to check for ${name(service)}?\n\nChoose an option below, or type your question.`, button: 'Choose an option', rows };
}
function appReply() {
  let url;
  try {
    const candidate = new URL(process.env.INCIDENT_PHOTOS_APP_URL);
    if (candidate.protocol === 'https:' && !candidate.username && !candidate.password) url = candidate.origin;
  } catch { /* The app remains accessible without publishing a guessed URL. */ }
  return `Open Guardian for photos, voice messages and the other features shared with you.${url ? `\n${url}/` : ''}\nRequesting a new photo requires an eligible SOS or fall incident. Sign in to continue.`;
}

// Menus are user-initiated navigation, not an AI question or a daily notice.
// Claim before handing off, so ambiguous sends and webhook retries never fan out.
async function sendNavigation({ db, uid, message, now, send, menu, sendMenu }) {
  if (!recentInbound(message, now) || !message.id || message.id.length > 256) return;
  const ref = db.collection('familyNotices').doc(hash(`menu:${uid}:${message.id}`));
  const claimed = await db.runTransaction(async tx => {
    if ((await tx.get(ref)).exists) return false;
    tx.create(ref, { uid, reason: 'menu', createdAtMs: now, expiresAt: new Date(now + 48 * 3600000), state: 'sending' });
    return true;
  });
  if (!claimed) return;
  let result;
  try { result = menu ? await sendMenu(message.from, menu) : await send(message.from, appReply()); }
  catch { result = { ok: false }; }
  await ref.update({ state: result?.ok ? 'accepted' : result?.status >= 400 || result?.skipped ? 'failed' : 'unknown',
    finishedAtMs: now, ...(result?.messageId ? { messageId: result.messageId } : {}),
    ...(Number.isInteger(result?.errorCode) ? { errorCode: result.errorCode } : {}) });
}
module.exports = { PREFIX, key, selection, isMenuRequest, recentInbound, wearerMenu, optionsMenu, sendNavigation };
