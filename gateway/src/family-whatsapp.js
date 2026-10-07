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

function locationAnswer(service, device) {
  const location = device.lastSatelliteLocation || device.location;
  const at = location?.recordedAt?.toDate?.() || (location?.recordedAt ? new Date(location.recordedAt) : null);
  if (!location || !Number.isFinite(location.lat) || !Number.isFinite(location.lng) ||
      Math.abs(location.lat) > 90 || Math.abs(location.lng) > 180 || !at || !Number.isFinite(+at)) return null;
  return `${service.wearerName || 'Your family member'}: last recorded location at ${at.toISOString()}.\n` +
    `https://www.google.com/maps?q=${location.lat},${location.lng}\nThis is a recorded position, not a confirmation of their current presence.`;
}

async function handleFamilyWhatsApp({ db, message, send, sendMenu = require('./whatsapp-meta').sendMetaList, now = Date.now() }) {
  if (!db) return false;
  if (await linkNumber(db, message.text || '', message.from, now)) return true;
  const phone = `+${digits(message.from)}`;
  const number = (await db.collection('familyNumbers').doc(hash(phone)).get()).data();
  if (!number) return false;
  const uid = number.uid, channel = (await db.collection('familyChannels').doc(uid).get()).data();
  if (!channel?.verifiedAtMs || channel.phone !== phone) return true;
  const allowance = createAllowanceStore(db, { now: () => now });
  const notice = async (reason, text) => { if (await allowance.claimNotice(uid, reason)) await send(message.from, text); };
  const user = (await db.collection('users').doc(uid).get()).data();
  const services = [];
  for (const imei of [...new Set(user?.familyServiceImeis || [])].slice(0, 30)) {
    const service = (await db.collection('familyServices').doc(imei).get()).data();
    if (activeMember(service, uid, now) && serviceEntitlements(service, now).serviceActive) services.push({ ...service, imei });
  }
  const ack = /^ACK ([A-Za-z0-9_-]{1,128})$/i.exec(message.text.trim());
  if (ack) {
    const alert = (await db.collection('alerts').doc(ack[1]).get()).data();
    const service = services.find(s => s.imei === alert?.imei);
    if (service && ['sos', 'fall'].includes(alert.type) && can(service, uid, 'alerts', now)) {
      try { await require('./family-response').acknowledge(db, { uid, imei: service.imei, alertId: ack[1], phone, source: 'whatsapp', now }); }
      catch (error) { if (!error.code) throw error; }
    }
    return true; // No allowance use and no automatic resolution, even on provider retries.
  }
  let text = message.text.trim().toLowerCase(), service;
  const chosen = menu.selection(message.menuSelection);
  const navigation = menu.isMenuRequest(text) || !!message.menuSelection;
  if (navigation && !menu.recentInbound(message, now)) return true;
  if (chosen && chosen.action !== 'page') service = services.find(s => menu.key(s) === chosen.target);
  if (navigation) {
    // IDs identify a choice, never grant access. Rebuild from current membership
    // on every tap; do not route a stale row to a different remaining wearer.
    if (chosen && chosen.action !== 'page' && !service) {
      await notice('menu_access', 'This wearer is no longer available here. Send menu to see your current shared access.');
      return true;
    }
    if (!services.length) { await notice('menu_access', 'No active wearer is shared with this number. Open Guardian to check your access.'); return true; }
    if (!chosen || chosen.action === 'wearer' || chosen.action === 'page') {
      const selected = service || (services.length === 1 ? services[0] : null);
      await menu.sendNavigation({ db, uid, message, now, send, sendMenu,
        menu: selected && chosen?.action !== 'page' ? menu.optionsMenu(selected, uid, now, services.length > 1)
          : menu.wearerMenu(services, chosen?.action === 'page' ? Number(chosen.target) : 0) });
      return true;
    }
    if (chosen.action === 'app') {
      await menu.sendNavigation({ db, uid, message, now, send, sendMenu }); return true;
    }
    text = chosen.action; // Canonical read-only intent; ignore the client-supplied title.
  }
  const matched = services.filter(s => text.startsWith(`${s.imei.slice(-6)} `));
  if (!service && matched.length === 1) { service = matched[0]; text = text.slice(7); }
  else if (!service && services.length === 1) service = services[0];
  if (!service) {
    await notice('choose_wearer', 'Open Guardian to choose a wearer. For a shared watch, prefix your WhatsApp question with the last six digits of its watch ID.');
    return true;
  }
  const intent = /^(where|location|position|ou\b|où\b)/.test(text) ? 'location'
    : /^(battery|batterie|watch status|status)/.test(text) ? 'battery' : null;
  // Bounded deterministic replies are the first managed-circle release. No model calls.
  if (!intent || !can(service, uid, 'location', now)) {
    await notice('use_app', 'Use the Guardian app for the information and controls shared with you. WhatsApp currently answers location and battery questions.');
    return true;
  }
  const device = (await db.collection('devices').doc(service.imei).get()).data() || {};
  const reply = intent === 'location' ? locationAnswer(service, device)
    : Number.isFinite(device.batteryPercent) ? `${service.wearerName || 'Your family member'}: last reported watch battery ${device.batteryPercent}%. Open Guardian to check the reading time and connection.` : null;
  if (!reply) { await notice('no_reading', 'No confirmed reading is available yet. Check the wearer in Guardian.'); return true; }
  const claim = await allowance.reserve({ uid, imei: service.imei, messageId: message.id });
  if (!claim.allowed) {
    if (claim.reason === 'allowance_reached') await notice('allowance', 'This wearer’s shared monthly WhatsApp answer allowance is used. Continue in the Guardian app. SOS and fall alerts are unaffected.');
    return true;
  }
  const fresh = (await db.collection('familyServices').doc(service.imei).get()).data();
  const currentChannel = (await db.collection('familyChannels').doc(uid).get()).data();
  if (currentChannel?.phone !== phone || !currentChannel?.verifiedAtMs ||
      !can(fresh, uid, 'location', Date.now()) || !serviceEntitlements(fresh).serviceActive) {
    await allowance.transition(message.id, 'failed'); return true;
  }
  if (!await allowance.transition(message.id, 'sending')) return true;
  try {
    const result = await send(message.from, reply);
    // A transport timeout may have delivered. Keep that reservation for review.
    if (result.ok) await allowance.transition(message.id, 'sent');
    else if (result.skipped || result.status >= 400) await allowance.transition(message.id, 'failed');
  } catch { /* Handoff uncertain: no automatic paid retry. */ }
  return true;
}
module.exports = { handleFamilyWhatsApp, linkNumber, locationAnswer };
