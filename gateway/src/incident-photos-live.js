'use strict';
const { createIncidentPhotos } = require('./incident-photos');
const { createPhotoAnalyzer } = require('./incident-photo-analysis');
const { asBool } = require('./safety-snapshot-runtime');
const { buildFollowupPlan, galleryBase } = require('./incident-photo-templates');

let live = null;
function getIncidentPhotos() { return live; }
function startIncidentPhotos({ db, snapshots, env = process.env }) {
  if (!db || !snapshots) return null;
  const config = require('./config');
  const analyze = asBool(env.INCIDENT_PHOTO_AI_ENABLED) ? createPhotoAnalyzer({
    apiKey: config.anthropicApiKey, model: env.INCIDENT_PHOTO_AI_MODEL || config.anthropicModel,
  }) : null;
  live = createIncidentPhotos({ db, snapshots, enabled: asBool(env.INCIDENT_PHOTOS_ENABLED),
    trialOnly: asBool(env.INCIDENT_PHOTOS_TRIAL_ONLY, true), analyze, log: console.warn,
    onComplete: async incident => {
      if (!asBool(env.INCIDENT_PHOTO_TEMPLATES_APPROVED) || !galleryBase(env.INCIDENT_PHOTOS_APP_URL) || !config.notifyWhatsApp) return { ok: false };
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
      const plan = buildFollowupPlan(incident.id, gallery);
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
  const timer = setInterval(run, 3000); timer.unref(); run();
  return live;
}
module.exports = { getIncidentPhotos, startIncidentPhotos };
