'use strict';

const crypto = require('node:crypto');
const config = require('./config');
const { FEATURE, hasEntitlement, loadEntitlementsForUser } = require('./entitlements');
const { whatsappFeatureForAlert } = require('./notification-whatsapp-policy');

const LINK_LIFETIME_MS = 60 * 60 * 1000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const COLLECTION = 'watchCallLinks';
// New contracts keep existing approved alerts usable during Meta review.
const DYNAMIC_CALL_TEMPLATES = Object.freeze({
  sos: Object.freeze({ fresh: 'guardian_sos_callback_alert_v2',
    last_known: 'guardian_sos_callback_last_location_v2', unavailable: 'guardian_sos_callback_unavailable_v2' }),
  fall: Object.freeze({ fresh: 'guardian_fall_callback_alert_v2',
    last_known: 'guardian_fall_callback_last_location_v2', unavailable: 'guardian_fall_callback_unavailable_v2' }),
});

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function phone(value) {
  let number = String(value || '').trim().replace(/^whatsapp:/i, '').replace(/[ ()-]/g, '');
  if (/^5\d{7}$/.test(number)) number = `+230${number}`;
  if (number.startsWith('00')) number = `+${number.slice(2)}`;
  if (/^[1-9]\d{7,14}$/.test(number)) number = `+${number}`;
  return /^\+[1-9]\d{7,14}$/.test(number) ? number : null;
}

function time(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (Number.isFinite(value?.seconds)) return value.seconds * 1000;
  if (typeof value === 'string') return Date.parse(value);
  return NaN;
}

function callLinkOrigin(settings = config) {
  try {
    const url = new URL(settings.watchCallPublicOrigin);
    if (url.protocol !== 'https:' || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch { return null; }
}

function dynamicCallsEnabled(type, settings = config) {
  return Boolean(DYNAMIC_CALL_TEMPLATES[type] && callLinkOrigin(settings) &&
    (type === 'sos' ? settings.metaWhatsAppSosDynamicCallEnabled : settings.metaWhatsAppFallDynamicCallEnabled));
}

// A bearer link is issued to a selected contact; it is not proof of who opens
// it or calls. No client read access to these records, and no command on open.
async function authorizeLink(db, record, now) {
  if (!db || record?.version !== 1 || record.revokedAt ||
      !DYNAMIC_CALL_TEMPLATES[record.alertType] || !record.imei ||
      !record.alertId || !record.guardianUid || !record.ownerUid ||
      !(time(record.expiresAt) > now.getTime())) return null;
  const [deviceSnap, userSnap, alertSnap] = await Promise.all([
    db.collection('devices').doc(record.imei).get(),
    db.collection('users').doc(record.guardianUid).get(),
    db.collection('alerts').doc(record.alertId).get(),
  ]);
  if (!deviceSnap.exists || !userSnap.exists || !alertSnap.exists) return null;
  const device = deviceSnap.data();
  const user = userSnap.data();
  const alert = alertSnap.data();
  const number = phone(device.simNumber);
  const created = time(alert.createdAt);
  if (!number || hash(number) !== record.simHash ||
      alert.imei !== record.imei || alert.type !== record.alertType ||
      !Number.isFinite(created) || created > now.getTime() + 60000 ||
      time(record.expiresAt) > created + LINK_LIFETIME_MS ||
      !Array.isArray(user.linkedImeis) || !user.linkedImeis.includes(record.imei)) return null;
  const contactStillListed = (Array.isArray(user.emergencyContacts) ? user.emergencyContacts : [])
    .some((contact) => {
      const contactPhone = phone(contact?.phone);
      const recipient = phone(contact?.whatsapp || contact?.phone);
      return contactPhone && recipient && hash(contactPhone) === record.contactHash &&
        hash(recipient) === record.recipientHash;
    });
  if (!contactStillListed) return null;
  const entitlements = await loadEntitlementsForUser(db, { ...user, uid: record.guardianUid }, { now });
  if (entitlements.ownerUid !== record.ownerUid ||
      !hasEntitlement(entitlements, FEATURE.SOS_ALERTS) ||
      !hasEntitlement(entitlements, whatsappFeatureForAlert(alert))) return null;
  return { number, name: String(device.nickname || device.name || 'the wearer').slice(0, 100) };
}

async function issueWatchCallLink({ db, imei, alertId, alert, device, contact, now = new Date() }) {
  const number = phone(device?.simNumber);
  const contactPhone = phone(contact?.phone);
  const recipient = phone(contact?.whatsapp || contact?.phone);
  if (!db || !number || !contactPhone || !recipient || !alertId) return null;
  // createAlert delivers immediately using its original serverTimestamp()
  // placeholder. Read the committed receipt time, never that placeholder or
  // caller-supplied time, before deriving link expiry.
  const savedAlert = await db.collection('alerts').doc(alertId).get();
  if (!savedAlert.exists) return null;
  const saved = savedAlert.data();
  const created = time(saved.createdAt);
  if (saved.imei !== imei || saved.type !== alert?.type || !Number.isFinite(created)) return null;
  const record = {
    version: 1, imei, alertId, alertType: alert.type,
    guardianUid: contact.guardianUid, ownerUid: contact.entitlements?.ownerUid,
    simHash: hash(number), contactHash: hash(contactPhone), recipientHash: hash(recipient),
    createdAt: now, expiresAt: new Date(created + LINK_LIFETIME_MS), revokedAt: null,
  };
  if (!await authorizeLink(db, record, now)) return null;
  const token = crypto.randomBytes(32).toString('base64url');
  await db.collection(COLLECTION).doc(hash(token)).create(record);
  return token;
}

async function resolveWatchCallLink(db, token, { now = new Date() } = {}) {
  if (!db || !TOKEN_PATTERN.test(token)) return null;
  const snap = await db.collection(COLLECTION).doc(hash(token)).get();
  return snap.exists ? authorizeLink(db, snap.data(), now) : null;
}

async function bounded(work, milliseconds) {
  let timer;
  try {
    return await Promise.race([work, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('call_link_timeout')), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

function withCallButton(prepared, type, token) {
  const plan = prepared.plan;
  const components = [{ type: 'body', parameters: plan.bodyParameters.map((text) => ({ type: 'text', text: String(text) })) },
    { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: token || 'unavailable' }] }];
  if (plan.buttonUrlParameter) components.push({
    type: 'button', sub_type: 'url', index: '1', parameters: [{ type: 'text', text: plan.buttonUrlParameter }],
  });
  return { ...prepared, plan: { ...plan, templateName: DYNAMIC_CALL_TEMPLATES[type][plan.locationState],
    components, dynamicCallLink: true, callButtonIncluded: true, locationButtonIndex: plan.buttonUrlParameter ? 1 : null } };
}

async function prepareRecipientCallLink(prepared, options, { settings = config, timeoutMs = 2000 } = {}) {
  const type = options.alert?.type;
  if (!prepared?.plan || !dynamicCallsEnabled(type, settings)) return prepared;
  let token = null;
  try { token = await bounded(issueWatchCallLink(options), timeoutMs); }
  catch { /* A missing link must never block or delay the safety alert indefinitely. */ }
  return withCallButton(prepared, type, token);
}

// Provider errors can reflect request parameters. Never persist a bearer token
// in notificationLogs or surface it through an error message.
function redactCallLinkResult(result, prepared) {
  if (!prepared?.plan?.dynamicCallLink) return result;
  const token = prepared.plan.components[1].parameters[0].text;
  if (!TOKEN_PATTERN.test(token)) return { ...result, callLinkStatus: 'unavailable' };
  const serialized = JSON.stringify(result || { ok: false });
  return { ...JSON.parse(serialized.split(token).join('[call-link-redacted]')), callLinkStatus: 'issued' };
}

module.exports = { LINK_LIFETIME_MS, COLLECTION, DYNAMIC_CALL_TEMPLATES,
  phone, callLinkOrigin, dynamicCallsEnabled, issueWatchCallLink, resolveWatchCallLink,
  bounded, withCallButton, prepareRecipientCallLink, redactCallLinkResult };
