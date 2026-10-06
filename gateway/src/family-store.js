'use strict';
const crypto = require('node:crypto');
const admin = require('firebase-admin');
const { fail, emailKey, activeMember, activePeople, can, policy, checkOwner,
  checkCapacity, memberPatch, serviceEntitlements, monthKey } = require('./family-policy');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const validImei = value => /^\d{15}$/.test(value || '');
const publicMember = (uid, row) => ({ uid, name: row.name, role: row.role, status: row.status,
  permissions: row.permissions, untilMs: row.untilMs ?? null, whatsapp: row.whatsapp === true,
  whatsappConsent: row.whatsappConsent === true });

function createFamilyStore(db, { now = Date.now, random = () => crypto.randomBytes(18).toString('base64url') } = {}) {
  const serviceRef = imei => {
    if (!validImei(imei)) fail('invalid_watch', 400);
    return db.collection('familyServices').doc(imei);
  };
  async function readService(tx, imei, uid, owner = false, allowInactive = false) {
    const ref = serviceRef(imei), service = (await tx.get(ref)).data();
    if (!service || !activeMember(service, uid, now())) fail('access_not_shared', 403);
    if (owner) checkOwner(service, uid, now());
    if (!allowInactive && !serviceEntitlements(service, now()).serviceActive) fail('active_service_required', 403);
    return { ref, service };
  }
  async function list(uid) {
    const index = await db.collection('users').doc(uid).get();
    const imeis = [...new Set(index.data()?.familyServiceImeis || [])].filter(validImei).slice(0, 30);
    const rows = [];
    for (const imei of imeis) {
      const service = (await serviceRef(imei).get()).data();
      if (!activeMember(service, uid, now())) continue;
      const usage = (await serviceRef(imei).collection('usage').doc(monthKey(now())).get()).data() || {};
      const pending = service.ownerUid === uid
        ? Object.entries(service.invites || {}).filter(([, v]) => v.status === 'pending' && v.expiresAtMs > now())
          .map(([id, v]) => ({ id, email: v.email, role: v.role, expiresAtMs: v.expiresAtMs })) : [];
      rows.push({ imei, wearerName: service.wearerName, ownerUid: service.ownerUid,
        subscription: service.subscription, limits: policy(service),
        members: Object.entries(service.members).map(([id, row]) => publicMember(id, row)),
        pending, usage: { month: monthKey(now()), used: usage.used || 0, reserved: usage.reserved || 0 },
        overLimit: activePeople(service, now()).length > policy(service).people });
    }
    const channel = (await db.collection('familyChannels').doc(uid).get()).data();
    return { services: rows, channel: { verified: !!channel?.verifiedAtMs,
      number: channel?.verifiedAtMs ? channel.phone : null } };
  }
  async function invite(uid, imei, input) {
    const email = emailKey(input.email), grant = memberPatch(input, now());
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) fail('invalid_email', 400);
    const code = random(), id = hash(code), expiresAtMs = now() + 7 * 86400000;
    await db.runTransaction(async tx => {
      const { ref, service } = await readService(tx, imei, uid, true);
      checkCapacity(service, now());
      const invites = Object.fromEntries(Object.entries(service.invites || {})
        .filter(([, row]) => row.status === 'pending' && row.expiresAtMs > now()));
      if (Object.values(invites).some(row => row.email === email)) fail('invitation_already_pending');
      if (activePeople(service, now()).some(id => service.members[id].email === email)) fail('already_a_member');
      // Bound stored pending invites; acceptance is checked again in the same service transaction.
      if (Object.keys(invites).length >= policy(service).people - activePeople(service, now()).length)
        fail('pending_invitations_fill_circle');
      const row = { email, ...grant, status: 'pending', expiresAtMs, createdAtMs: now() };
      invites[id] = row;
      tx.update(ref, { invites });
      tx.create(db.collection('familyInvites').doc(id), { ...row, imei, ownerUid: uid });
    });
    return { code, expiresAtMs }; // Never send an email or WhatsApp invitation on the owner's behalf.
  }
  async function accept(identity, code) {
    if (!identity.email_verified || !identity.email) fail('verified_email_required', 403);
    if (!/^[A-Za-z0-9_-]{24}$/.test(code || '')) fail('invalid_invitation', 400);
    const id = hash(code), inviteRef = db.collection('familyInvites').doc(id);
    return db.runTransaction(async tx => {
      const invitation = (await tx.get(inviteRef)).data();
      if (!invitation || invitation.email !== emailKey(identity.email)) fail('invitation_not_available', 403);
      const ref = serviceRef(invitation.imei), service = (await tx.get(ref)).data();
      if (!service || !serviceEntitlements(service, now()).serviceActive) fail('active_service_required', 403);
      const current = service.invites?.[id];
      if (!current || current.status !== 'pending' || current.expiresAtMs <= now() ||
          (current.untilMs != null && current.untilMs <= now())) fail('invitation_expired_or_cancelled');
      if (identity.uid === service.ownerUid) fail('cannot_join_own_family');
      if (activeMember(service, identity.uid, now())) fail('already_a_member');
      checkCapacity(service, now());
      const member = { ...memberPatch(current, now()), name: String(identity.name || identity.email).slice(0, 100),
        email: emailKey(identity.email), status: 'active', whatsapp: false, whatsappConsent: false, joinedAtMs: now() };
      // Acceptance does not give access to any other watch or opt the recipient into messages.
      service.members = Object.fromEntries(Object.entries(service.members).filter(([id]) => activeMember(service, id, now())));
      service.members[identity.uid] = member;
      delete service.invites[id];
      tx.set(ref, service);
      tx.update(inviteRef, { status: 'accepted', acceptedBy: identity.uid, acceptedAtMs: now() });
      tx.set(db.collection('users').doc(identity.uid), {
        familyServiceImeis: admin.firestore.FieldValue.arrayUnion(invitation.imei),
        linkedImeis: admin.firestore.FieldValue.arrayUnion(invitation.imei),
        familyAccess: { [invitation.imei]: { owner: false, permissions: member.permissions, untilMs: member.untilMs } },
      }, { merge: true });
      return { imei: invitation.imei };
    });
  }
  async function update(uid, imei, input) {
    await db.runTransaction(async tx => {
      const { ref, service } = await readService(tx, imei, uid, true, true);
      if (input.action === 'cancelInvite') {
        if (!service.invites?.[input.id]) fail('invitation_not_available');
        const invites = { ...service.invites }; delete invites[input.id];
        tx.update(ref, { invites });
        tx.update(db.collection('familyInvites').doc(input.id), { status: 'cancelled' });
        return;
      }
      const member = service.members?.[input.uid];
      if (!member) fail('member_not_found', 404);
      if (input.uid === service.ownerUid) fail('owner_access_cannot_change');
      if (input.action === 'revoke') {
        service.members[input.uid] = { ...member, status: 'revoked', whatsapp: false, revokedAtMs: now() };
      } else if (input.action === 'permissions') {
        if (!activeMember(service, input.uid, now())) fail('member_not_active');
        const patch = memberPatch(input, now());
        service.members[input.uid] = { ...member, ...patch,
          whatsapp: member.whatsapp === true && patch.permissions.alerts };
      } else fail('invalid_action', 400);
      tx.set(ref, service);
      tx.create(db.collection('familyAccessAudit').doc(), { imei, ownerUid: uid, targetUid: input.uid,
        action: input.action, at: new Date(now()), before: member, after: service.members[input.uid] });
      tx.update(db.collection('users').doc(input.uid), {
        [`familyAccess.${imei}`]: { owner: false, permissions: input.action === 'revoke' ? {} : service.members[input.uid].permissions, untilMs: service.members[input.uid].untilMs },
      });
    });
  }
  async function whatsapp(uid, imei, input) {
    await db.runTransaction(async tx => {
      const { ref, service } = await readService(tx, imei, uid, false, true);
      if (input.action === 'consent') {
        if (typeof input.enabled !== 'boolean') fail('invalid_request', 400);
        service.members[uid].whatsappConsent = input.enabled;
        service.members[uid].consentAtMs = now();
        if (!input.enabled) service.members[uid].whatsapp = false;
      } else if (input.action === 'select') {
        checkOwner(service, uid, now());
        if (typeof input.enabled !== 'boolean') fail('invalid_request', 400);
        const member = activeMember(service, input.uid, now());
        if (!member) fail('member_not_active');
        const channel = (await tx.get(db.collection('familyChannels').doc(input.uid))).data();
        if (input.enabled) {
          if (!channel?.verifiedAtMs || !member.whatsappConsent || !can(service, input.uid, 'alerts', now()))
            fail('recipient_must_link_and_consent');
          const selected = activePeople(service, now()).filter(id => id !== input.uid && service.members[id].whatsapp);
          if (selected.length >= policy(service).whatsappRecipients) fail('whatsapp_recipient_limit');
        }
        member.whatsapp = input.enabled;
      } else fail('invalid_action', 400);
      tx.set(ref, service);
    });
  }
  async function link(uid) {
    const code = random();
    await db.collection('familyLinkCodes').doc(uid).set({ hash: hash(code), expiresAtMs: now() + 10 * 60000 });
    // The sender must prove possession by sending this code from their WhatsApp.
    return { code: `LINK ${uid}:${code}`, expiresAtMs: now() + 10 * 60000 };
  }
  async function settings(uid, imei) {
    // Settings access does not grant raw telemetry, current position or the SIM number.
    return db.runTransaction(async tx => {
      const { service } = await readService(tx, imei, uid);
      if (!can(service, uid, 'settings', now())) fail('access_not_shared', 403);
      const data = (await tx.get(db.collection('devices').doc(imei))).data();
      if (!data) fail('watch_not_found', 404);
      return { settings: require('./family-device-view').deviceSettings(data) };
    });
  }
  async function profile(uid, imei, input) {
    const allowed = ['name', 'nickname', 'relationship', 'avatarUrl'];
    if (!input || !Object.keys(input).length || Object.keys(input).some(key => !allowed.includes(key))) fail('invalid_profile', 400);
    const patch = {};
    for (const [key, value] of Object.entries(input)) {
      if (value !== null && (typeof value !== 'string' || value.length > (key === 'avatarUrl' ? 4096 : 100))) fail('invalid_profile', 400);
      patch[key] = value?.trim() || null;
      if (key === 'avatarUrl' && patch[key] && !/^https?:\/\//.test(patch[key])) fail('invalid_profile', 400);
    }
    return db.runTransaction(async tx => {
      const { ref, service } = await readService(tx, imei, uid, true);
      const watchRef = db.collection('devices').doc(imei), watch = (await tx.get(watchRef)).data();
      if (!watch) fail('watch_not_found', 404);
      const merged = { ...watch, ...patch };
      const fields = Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, value ?? admin.firestore.FieldValue.delete()]));
      tx.update(watchRef, { ...fields, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      tx.set(db.collection('familyDeviceProfiles').doc(imei), fields, { merge: true });
      tx.set(db.collection('familyDeviceViews').doc(imei), fields, { merge: true });
      tx.update(ref, { wearerName: merged.nickname || merged.name || 'Family member' });
      return { ok: true };
    });
  }
  return { list, invite, accept, update, whatsapp, link, settings, profile };
}
module.exports = { createFamilyStore, hash, validImei };
