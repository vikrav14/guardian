'use strict';

const crypto = require('crypto');
const admin = require('firebase-admin');
const config = require('./config');
const sosVoiceConfig = require('./sos-voice-config');
const { findContactsForImei } = require('./notify');
const { FEATURE, hasEntitlement } = require('./entitlements');
const {
  normalizeMetaRecipient,
  buildSosVoiceReadyTemplateComponents,
  sendMetaTemplate,
  uploadMetaMedia,
  sendMetaAudio,
  deleteMetaMedia,
} = require('./whatsapp-meta');
const {
  SOS_VOICE_WINDOW_MS,
  SOS_VOICE_RETENTION_MS,
  SOS_VOICE_BUTTON_PREFIX,
  validateSosVoiceClip,
  buildVoiceClipId,
  parseSosVoiceButtonPayload,
} = require('./service-backbones/voice-messages');

function asDate(value) {
  if (!value) return null;
  const candidate = value?.toDate?.() || value;
  const date = candidate instanceof Date ? candidate : new Date(candidate);
  return Number.isFinite(date.getTime()) ? date : null;
}

function deliveryIdFor(token, phone, secret = config.metaAppSecret) {
  const key = String(secret || '').trim();
  const recipient = normalizeMetaRecipient(phone);
  if (!key || !token || !recipient) return null;
  return crypto
    .createHmac('sha256', key)
    .update(String(token))
    .update('\0')
    .update(recipient)
    .digest('hex');
}

function newPlaybackToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function voiceStorageBucket() {
  if (!sosVoiceConfig.firebaseStorageBucket) return null;
  try {
    return admin.storage().bucket(sosVoiceConfig.firebaseStorageBucket);
  } catch {
    return null;
  }
}

async function findActiveSosAlert(
  db,
  imei,
  { now = new Date(), windowMs = SOS_VOICE_WINDOW_MS } = {}
) {
  if (!db || !imei) return null;
  let snap;
  try {
    snap = await db
      .collection('alerts')
      .where('imei', '==', String(imei))
      .orderBy('createdAt', 'desc')
      .limit(20)
      .get();
  } catch {
    snap = await db
      .collection('alerts')
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get();
  }

  const cutoff = now.getTime() - windowMs;
  for (const doc of snap.docs || []) {
    const data = doc.data() || {};
    if (String(data.imei || '') !== String(imei)) continue;
    if (String(data.type || '').toLowerCase() !== 'sos') continue;
    if (data.resolved === true) continue;
    const eventAt = asDate(data.eventAt) || asDate(data.createdAt);
    if (!eventAt || eventAt.getTime() < cutoff || eventAt > now) continue;
    return { id: doc.id, data, ref: doc.ref || db.collection('alerts').doc(doc.id), eventAt };
  }
  return null;
}

function eligibleVoiceRecipients(contacts) {
  const seen = new Set();
  const recipients = [];
  for (const contact of contacts || []) {
    const target = normalizeMetaRecipient(contact?.whatsapp || contact?.phone);
    if (!target || seen.has(target)) continue;
    if (!hasEntitlement(contact.entitlements, FEATURE.SOS_VOICE_MESSAGES)) continue;
    if (!hasEntitlement(contact.entitlements, FEATURE.WHATSAPP_SAFETY_ALERTS)) continue;
    seen.add(target);
    recipients.push({
      target,
      name: String(contact.name || 'Guardian').slice(0, 80),
    });
  }
  return recipients;
}

function formatEventTime(date) {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Indian/Mauritius',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  } catch {
    return date.toISOString().slice(11, 16);
  }
}

async function loadWearerName(db, imei) {
  const snap = await db.collection('devices').doc(String(imei)).get();
  const device = snap.exists ? (snap.data() || {}) : {};
  return String(device.nickname || device.name || device.relationship || 'the wearer')
    .replace(/(?:'s)?\s+(?:watch|device|pendant)$/i, '')
    .trim()
    .slice(0, 80) || 'the wearer';
}

async function sendVoiceReadyTemplates({
  db,
  clip,
  recipients,
  now = new Date(),
  templateName = sosVoiceConfig.templateName,
  tokenSecret = config.metaAppSecret,
  sendTemplate = sendMetaTemplate,
} = {}) {
  if (!templateName || !tokenSecret || config.notifyWhatsApp !== true) {
    return { status: 'not_configured', results: [] };
  }

  const results = [];
  for (const recipient of recipients) {
    const token = newPlaybackToken();
    const deliveryId = deliveryIdFor(token, recipient.target, tokenSecret);
    const payload = `${SOS_VOICE_BUTTON_PREFIX}${token}`;
    const deliveryRef = db.collection('sosVoiceDeliveries').doc(deliveryId);
    const delivery = {
      version: 1,
      clipId: clip.id,
      imei: clip.imei,
      alertId: clip.alertId,
      status: 'ready',
      createdAt: now,
      expiresAt: clip.expiresAt,
    };
    await deliveryRef.set(delivery);

    let outcome;
    try {
      outcome = await sendTemplate(recipient.target, templateName, {
        languageCode: 'en',
        components: buildSosVoiceReadyTemplateComponents({
          wearerName: clip.wearerName,
          eventTime: formatEventTime(clip.eventAt),
          buttonPayload: payload,
        }),
      });
    } catch (err) {
      outcome = { ok: false, provider: 'meta', error: err.message };
    }

    await deliveryRef.set(
      {
        status: outcome?.ok ? 'template_accepted' : 'template_failed',
        templateName,
        templateMessageId: outcome?.messageId || null,
        templateError: outcome?.ok
          ? null
          : String(outcome?.error || outcome?.reason || 'template_send_failed').slice(0, 240),
        templateUpdatedAt: now,
      },
      { merge: true }
    );
    results.push({
      deliveryId,
      ok: outcome?.ok === true,
      messageId: outcome?.messageId || null,
    });
  }

  return {
    status: results.some((item) => item.ok) ? 'accepted' : 'failed',
    results,
  };
}

async function persistClip({
  db,
  bucket,
  imei,
  alert,
  audio,
  inspection,
  now,
  retentionMs,
  wearerName,
}) {
  const clipId = buildVoiceClipId({ imei, alertId: alert.id, audio });
  const clipRef = db.collection('sosVoiceMessages').doc(clipId);
  const existing = await clipRef.get();
  if (existing.exists) {
    return { duplicate: true, clip: { id: clipId, ...(existing.data() || {}) } };
  }

  const expiresAt = new Date(now.getTime() + retentionMs);
  const storagePath = `sosVoiceMessages/${clipId}/${imei}.amr`;
  await bucket.file(storagePath).save(audio, {
    resumable: false,
    validation: 'crc32c',
    metadata: {
      contentType: inspection.contentType,
      cacheControl: 'private, max-age=0, no-store',
      contentDisposition: 'attachment; filename="guardian-sos-voice.amr"',
      metadata: {
        guardianClipId: clipId,
        guardianAlertId: alert.id,
        expiresAt: expiresAt.toISOString(),
      },
    },
  });

  const clip = {
    id: clipId,
    version: 1,
    imei: String(imei),
    alertId: alert.id,
    source: 'v52_tk',
    wearerName,
    eventAt: alert.eventAt,
    storagePath,
    status: 'available',
    codec: inspection.codec,
    contentType: inspection.contentType,
    byteLength: inspection.byteLength,
    durationMs: inspection.durationMs,
    createdAt: now,
    expiresAt,
    metaMediaId: null,
    readyTemplateStatus: 'pending',
  };
  await clipRef.set(clip);
  await alert.ref.set(
    {
      voiceMessage: {
        clipId,
        status: 'available',
        durationMs: inspection.durationMs,
        expiresAt,
      },
    },
    { merge: true }
  );
  return { duplicate: false, clip };
}

async function ingestSosVoiceMessage({
  db,
  bucket = voiceStorageBucket(),
  imei,
  audio,
  now = new Date(),
  enabled = sosVoiceConfig.enabled,
  retentionMs = Math.min(
    SOS_VOICE_RETENTION_MS,
    Math.max(1, Number(sosVoiceConfig.retentionHours || 24)) * 60 * 60 * 1000
  ),
  findContacts = findContactsForImei,
  sendTemplate = sendMetaTemplate,
  tokenSecret = config.metaAppSecret,
} = {}) {
  if (!enabled) return { ok: false, reason: 'feature_disabled' };
  if (!db) return { ok: false, reason: 'firestore_unavailable' };
  if (!bucket) return { ok: false, reason: 'storage_unavailable' };

  const inspection = validateSosVoiceClip(audio);
  if (!inspection.ok) return { ok: false, reason: inspection.reason };

  const alert = await findActiveSosAlert(db, imei, { now });
  if (!alert) return { ok: false, reason: 'no_active_sos' };

  const contacts = await findContacts(db, String(imei));
  const recipients = eligibleVoiceRecipients(contacts);
  if (recipients.length === 0) {
    return { ok: false, reason: 'no_entitled_recipient' };
  }
  if (!String(tokenSecret || '').trim()) {
    return { ok: false, reason: 'meta_app_secret_missing' };
  }

  const wearerName = await loadWearerName(db, imei);
  const persisted = await persistClip({
    db,
    bucket,
    imei,
    alert,
    audio,
    inspection,
    now,
    retentionMs,
    wearerName,
  });
  if (persisted.duplicate) {
    return { ok: true, duplicate: true, clipId: persisted.clip.id };
  }

  const ready = await sendVoiceReadyTemplates({
    db,
    clip: persisted.clip,
    recipients,
    now,
    sendTemplate,
    tokenSecret,
  });
  await db.collection('sosVoiceMessages').doc(persisted.clip.id).set(
    {
      readyTemplateStatus: ready.status,
      readyTemplateAcceptedCount: ready.results.filter((item) => item.ok).length,
      readyTemplateUpdatedAt: now,
    },
    { merge: true }
  );

  return {
    ok: true,
    duplicate: false,
    clipId: persisted.clip.id,
    durationMs: inspection.durationMs,
    readyTemplateStatus: ready.status,
  };
}

async function ensureMetaMedia({ db, bucket, clip, uploadMedia = uploadMetaMedia, now }) {
  if (clip.metaMediaId) return { ok: true, mediaId: clip.metaMediaId, reused: true };
  const [audio] = await bucket.file(clip.storagePath).download();
  const uploaded = await uploadMedia(audio, {
    contentType: clip.contentType,
    filename: `${clip.id}.amr`,
  });
  if (!uploaded?.ok) return uploaded;
  await db.collection('sosVoiceMessages').doc(clip.id).set(
    { metaMediaId: uploaded.mediaId, metaUploadedAt: now },
    { merge: true }
  );
  return uploaded;
}

async function deliverSosVoiceButton({
  db,
  bucket = voiceStorageBucket(),
  from,
  buttonPayload,
  now = new Date(),
  enabled = sosVoiceConfig.enabled,
  uploadMedia = uploadMetaMedia,
  sendAudio = sendMetaAudio,
  tokenSecret = config.metaAppSecret,
} = {}) {
  if (!enabled) return { ok: false, reason: 'feature_disabled' };
  if (!db || !bucket) return { ok: false, reason: 'voice_service_unavailable' };
  const token = parseSosVoiceButtonPayload(buttonPayload);
  if (!token) return { ok: false, reason: 'invalid_playback_request' };

  const deliveryId = deliveryIdFor(token, from, tokenSecret);
  if (!deliveryId) return { ok: false, reason: 'voice_service_unavailable' };
  const deliveryRef = db.collection('sosVoiceDeliveries').doc(deliveryId);
  const deliverySnap = await deliveryRef.get();
  if (!deliverySnap.exists) return { ok: false, reason: 'playback_request_not_found' };
  const delivery = deliverySnap.data() || {};
  const deliveryExpiry = asDate(delivery.expiresAt);
  if (!deliveryExpiry || deliveryExpiry <= now) {
    return { ok: false, reason: 'voice_message_expired' };
  }

  const clipRef = db.collection('sosVoiceMessages').doc(String(delivery.clipId || ''));
  const clipSnap = await clipRef.get();
  if (!clipSnap.exists) return { ok: false, reason: 'voice_message_not_found' };
  const clip = { id: clipSnap.id, ...(clipSnap.data() || {}) };
  const clipExpiry = asDate(clip.expiresAt);
  if (clip.status !== 'available' || !clipExpiry || clipExpiry <= now) {
    return { ok: false, reason: 'voice_message_expired' };
  }

  const media = await ensureMetaMedia({ db, bucket, clip, uploadMedia, now });
  if (!media?.ok) return { ok: false, reason: 'media_upload_failed', detail: media };
  const sent = await sendAudio(from, media.mediaId);
  await deliveryRef.set(
    {
      status: sent?.ok ? 'audio_accepted' : 'audio_failed',
      audioMessageId: sent?.messageId || null,
      lastPlayedAt: now,
      playCount: admin.firestore.FieldValue.increment(1),
      lastError: sent?.ok
        ? null
        : String(sent?.error || sent?.reason || 'audio_send_failed').slice(0, 240),
    },
    { merge: true }
  );
  return sent?.ok
    ? { ok: true, clipId: clip.id, messageId: sent.messageId || null }
    : { ok: false, reason: 'audio_send_failed', detail: sent };
}

async function purgeExpiredSosVoiceMessages({
  db,
  bucket = voiceStorageBucket(),
  now = new Date(),
  deleteMedia = deleteMetaMedia,
} = {}) {
  if (!db || !bucket) return { clips: 0, deliveries: 0 };
  const clipSnap = await db
    .collection('sosVoiceMessages')
    .where('expiresAt', '<=', now)
    .limit(100)
    .get();
  let clips = 0;
  for (const doc of clipSnap.docs || []) {
    const clip = doc.data() || {};
    if (clip.storagePath) {
      await bucket.file(clip.storagePath).delete({ ignoreNotFound: true });
    }
    if (clip.metaMediaId) await deleteMedia(clip.metaMediaId);
    await doc.ref.set(
      {
        status: 'expired',
        storagePath: null,
        metaMediaId: null,
        expiredAt: now,
      },
      { merge: true }
    );
    clips += 1;
  }

  const deliverySnap = await db
    .collection('sosVoiceDeliveries')
    .where('expiresAt', '<=', now)
    .limit(250)
    .get();
  for (const doc of deliverySnap.docs || []) await doc.ref.delete();
  return { clips, deliveries: deliverySnap.docs?.length || 0 };
}

function startSosVoiceMessageCleanup(
  db,
  {
    intervalMs = Math.max(5, sosVoiceConfig.cleanupMinutes || 15) * 60 * 1000,
  } = {}
) {
  if (!db || !sosVoiceConfig.enabled) return null;
  const run = () => purgeExpiredSosVoiceMessages({ db }).catch((err) => {
    console.error('[sos-voice] cleanup failed', err.message);
  });
  run();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return timer;
}

module.exports = {
  asDate,
  deliveryIdFor,
  newPlaybackToken,
  voiceStorageBucket,
  findActiveSosAlert,
  eligibleVoiceRecipients,
  formatEventTime,
  sendVoiceReadyTemplates,
  ingestSosVoiceMessage,
  deliverSosVoiceButton,
  purgeExpiredSosVoiceMessages,
  startSosVoiceMessageCleanup,
};
