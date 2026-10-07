'use strict';
const { hash } = require('./family-store');
const { createAllowanceStore } = require('./family-allowance');
const { activeMember, can, serviceEntitlements } = require('./family-policy');
const menu = require('./whatsapp-menu');
const digits = value => String(value || '').replace(/\D/g, '');

async function linkNumber(db, text, from, now) {
  const match = /^LINK ([^\s/:]{1,128}):([A-Za-z0-9_-]{24})$/.exec(text.trim());
  if (!match) return false;
  const [, uid, code] = match, phone = `+${digits(from)}`;
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) return true;
  await db.runTransaction(async tx => {
    const ref = db.collection('familyLinkCodes').doc(uid), pending = (await tx.get(ref)).data();
    const channelRef = db.collection('familyChannels').doc(uid), channel = (await tx.get(channelRef)).data();
    const numberRef = db.collection('familyNumbers').doc(hash(phone));
    const number = (await tx.get(numberRef)).data();
    if (!pending || pending.hash !== hash(code) || pending.expiresAtMs <= now || pending.usedAtMs ||
        (number && number.uid !== uid)) return;
    if (channel?.phone && channel.phone !== phone) tx.delete(db.collection('familyNumbers').doc(hash(channel.phone)));
    tx.set(channelRef, { phone, verifiedAtMs: now });
    tx.set(numberRef, { uid, verifiedAtMs: now });
    tx.update(ref, { usedAtMs: now });
  });
  return true; // Confirmation is shown in the authenticated app, without a paid outbound message.
}

async function handleFamilyWhatsApp({ db, message, send, sendMenu = require('./whatsapp-meta').sendMetaList,
  now = Date.now(), enabled = true }) {
  // This handler owns every inbound text. Unknown callers never fall through to AI.
  if (!db || !menu.recentInbound(message, now)) return true;
  const startedAt = Date.now();
  const handoffNow = () => now + Math.max(0, Date.now() - startedAt);
  const phone = `+${digits(message.from)}`;
  if (enabled && await linkNumber(db, message.text || '', message.from, now)) return true;
  const number = (await db.collection('familyNumbers').doc(hash(phone)).get()).data();
  if (!enabled || !number) {
    await menu.sendNavigation({ db, uid: `unlinked:${hash(phone)}`, message, now, send,
      text: enabled ? 'Open Guardian → Family → WhatsApp → Link my WhatsApp to use the menu. Safety alerts keep their existing settings.'
        : 'The WhatsApp menu is unavailable. Please open Guardian. Safety alerts keep their existing settings.' });
    return true;
  }
  const uid = number.uid;
  const channelValid = async () => {
    const channel = (await db.collection('familyChannels').doc(uid).get()).data();
    const linked = (await db.collection('familyNumbers').doc(hash(phone)).get()).data();
    return channel?.phone === phone && !!channel?.verifiedAtMs && linked?.uid === uid;
  };
  if (!await channelValid()) return true;
  const allowance = createAllowanceStore(db, { now: () => now });
  const notice = async text => menu.sendNavigation({ db, uid, message, now, send, text, authorize: channelValid });
  const user = (await db.collection('users').doc(uid).get()).data();
  const services = [];
  for (const imei of [...new Set(user?.familyServiceImeis || [])].filter(v => /^\d{15}$/.test(v)).slice(0, 30)) {
    const service = (await db.collection('familyServices').doc(imei).get()).data();
    if (activeMember(service, uid, now) && serviceEntitlements(service, now).serviceActive) services.push({ ...service, imei });
  }
  const ack = /^ACK ([A-Za-z0-9_-]{1,128})$/i.exec((message.text || '').trim());
  if (ack) {
    const alert = (await db.collection('alerts').doc(ack[1]).get()).data();
    const service = services.find(s => s.imei === alert?.imei);
    if (service && ['sos', 'fall'].includes(alert.type) && can(service, uid, 'alerts', now)) {
      try { await require('./family-response').acknowledge(db, { uid, imei: service.imei, alertId: ack[1], phone, source: 'whatsapp', now }); }
      catch (error) { if (!error.code) throw error; }
    }
    return true;
  }
  const chosen = menu.selection(message.menuSelection);
  const service = chosen && chosen.action !== 'page' ? services.find(s => menu.key(s) === chosen.target) : null;
  if (chosen && chosen.action !== 'page' && !service) {
    await notice('This wearer is no longer available here. Send menu to see your current shared access.'); return true;
  }
  if (!services.length) { await notice('No active wearer is shared with this number. Open Guardian to check your access.'); return true; }
  const authorize = async (selected, action) => {
    if (!await channelValid()) return false;
    const fresh = (await db.collection('familyServices').doc(selected.imei).get()).data();
    const current = handoffNow();
    if (!activeMember(fresh, uid, current) || !serviceEntitlements(fresh, current).serviceActive) return false;
    // Both menus and answers can contain several permission scopes (Today
    // includes alerts and location). Recheck the complete scope before handoff.
    if (JSON.stringify(menu.appDestinations(fresh, uid, current)) !== JSON.stringify(menu.appDestinations(selected, uid, now))) return false;
    return !action || !menu.ACTIONS[action] || menu.allowed(fresh, uid, action, current);
  };
  const navigate = async (selected, payload, action) => menu.sendNavigation({ db, uid, message, now, send, sendMenu, menu: payload,
    authorize: async () => selected ? authorize(selected, action) : (await Promise.all(services.map(s => authorize(s)))).every(Boolean) });
  // Every ordinary typed message, including old questions, returns navigation.
  if (!chosen || chosen.action === 'wearer' || chosen.action === 'page') {
    const selected = service || (services.length === 1 && chosen?.action !== 'page' ? services[0] : null);
    await navigate(selected, selected ? menu.optionsMenu(selected, uid, now, services.length > 1)
      : menu.wearerMenu(services, chosen?.action === 'page' ? Number(chosen.target) : 0));
    return true;
  }
  if (menu.GROUPS[chosen.action]) {
    await navigate(service, menu.subMenu(service, uid, chosen.action, now, services.length > 1)); return true;
  }
  if (!menu.allowed(service, uid, chosen.action, now)) {
    await notice('This option is not shared with you. Send menu to see your current access.'); return true;
  }
  if (!menu.READS.has(chosen.action)) {
    await navigate(service, menu.resultMenu(service, menu.appReply(service, chosen.action), services.length > 1), chosen.action); return true;
  }
  let reply;
  try { reply = await require('./whatsapp-records').recordedReply(db, service, uid, chosen.action, now); }
  catch { await notice('Recorded information is unavailable. Open Guardian to check the wearer.'); return true; }
  const claim = await allowance.reserve({ uid, imei: service.imei, messageId: message.id });
  if (!claim.allowed) {
    if (claim.reason === 'allowance_reached') await notice('This wearer’s shared monthly WhatsApp answer allowance is used. Continue in Guardian. Menu navigation, SOS and fall alerts are unaffected.');
    return true;
  }
  if (!await authorize(service, chosen.action)) { await allowance.transition(message.id, 'failed'); return true; }
  if (!await allowance.transition(message.id, 'sending')) return true;
  try {
    const result = await sendMenu(message.from, menu.resultMenu(service, reply, services.length > 1));
    if (result.ok) await allowance.transition(message.id, 'sent');
    else if (result.skipped || result.status >= 400) await allowance.transition(message.id, 'failed');
  } catch { /* Ambiguous handoff: no automatic resend. */ }
  return true;
}
module.exports = { handleFamilyWhatsApp, linkNumber };
