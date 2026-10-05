'use strict';
const { createIncidentPhotos } = require('./incident-photos');
const { createPhotoAnalyzer } = require('./incident-photo-analysis');
const { createOrientedPhotoAnalyzer } = require('./incident-photo-orientation');
const { asBool } = require('./safety-snapshot-runtime');
const { buildFollowupPlan, galleryBase } = require('./incident-photo-templates');
const { isGuardianWindow } = require('./incident-photo-policy');

let live = null;
function getIncidentPhotos() { return live; }
function getIncidentPhotoRuntimeStatus() {
  return live?.getStatus() || { version: 1, workerStarted: false };
}
function configuredPhotoAnalyzer({ env, config, fetchImpl }) {
  if (!asBool(env.INCIDENT_PHOTO_AI_ENABLED)) return null;
  const factory = asBool(env.INCIDENT_PHOTO_AI_ORIENTATION_ENABLED) ? createOrientedPhotoAnalyzer : createPhotoAnalyzer;
  return factory({ apiKey: config.anthropicApiKey,
    model: env.INCIDENT_PHOTO_AI_MODEL || config.anthropicModel, fetchImpl });
}
function startIncidentPhotos({ db, snapshots, env = process.env }) {
  if (!db || !snapshots) return null;
  const config = require('./config');
  const analyze = configuredPhotoAnalyzer({ env, config });
  live = createIncidentPhotos({ db, snapshots, enabled: asBool(env.INCIDENT_PHOTOS_ENABLED),
    // Atomic product/notification rollout: an ordinary restart with the old
    // environment keeps the currently approved notification/capture contract.
    guardianWindowEnabled: asBool(env.INCIDENT_PHOTO_GUARDIAN_WINDOW_APPROVED),
    trialOnly: asBool(env.INCIDENT_PHOTOS_TRIAL_ONLY, true), analyze, log: console.warn,
    onComplete: async incident => {
      if (!asBool(env.INCIDENT_PHOTO_FOLLOWUP_APPROVED) || !galleryBase(env.INCIDENT_PHOTOS_APP_URL) || !config.notifyWhatsApp) return { ok: false };
      const { findContactsForImei } = require('./notify');
      const { selectWhatsAppContacts } = require('./notification-whatsapp-policy');
      const { sendMetaTemplate } = require('./whatsapp-meta');
      const contacts = await findContactsForImei(db, incident.imei);
      // Scene descriptions are sent only to the enrolled household's existing
      // emergency contacts, never every household that links an IMEI.
      const authorized = [];
      for (const contact of contacts) {
        try {
          const access = await snapshots.access(contact.guardianUid, incident.imei);
          if (access.ownerUid === incident.ownerUid) authorized.push(contact);
        } catch { /* No longer a member/subscriber. */ }
      }
      const selected = selectWhatsAppContacts(authorized, { type: incident.type });
      if (!selected.length) return { ok: false };
      const gallery = await live.gallery(incident.ownerUid, incident.id);
      if (gallery.state === 'expired') return { ok: false };
      if (isGuardianWindow(incident)) {
        gallery.photos = gallery.photos.filter(photo => photo.captureSource === 'automatic');
        const sequences = new Set(gallery.photos.map(photo => photo.sequence));
        gallery.summary = gallery.summary.filter(item => sequences.has(item.photo));
      }
      const device = isGuardianWindow(incident)
        ? (await db.collection('devices').doc(incident.imei).get()).data() || {} : {};
      const plan = buildFollowupPlan(incident.id, gallery, { incident, device });
      const results = [];
      for (const contact of selected) {
        const result = await sendMetaTemplate(contact.whatsapp || contact.phone, plan.templateName, { languageCode: 'en', components: plan.components });
        results.push({ ok: result?.ok === true, messageId: result?.messageId || null });
      }
      // No photo bytes, descriptions, bearer tokens or media URL in delivery logs.
      await db.collection('incidentPhotoDelivery').doc(incident.id).set({ at: new Date(), results, template: plan.templateName });
      return { ok: results.some(result => result.ok) };
    },
  });
  const run = () => live.sweep().catch(() => console.warn('[incident-photos] work deferred'));
  console.info(`[incident-photos] runtime ${JSON.stringify(live.getStatus())}`);
  const timer = setInterval(run, 3000); timer.unref(); run();
  return live;
}
module.exports = { getIncidentPhotos, getIncidentPhotoRuntimeStatus, startIncidentPhotos, configuredPhotoAnalyzer };
