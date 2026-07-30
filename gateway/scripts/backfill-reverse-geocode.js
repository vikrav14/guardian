#!/usr/bin/env node
/**
 * One-time backfill: reverse-geocode all device locations in Firestore and add placeLabel.
 * This ensures existing locations have place names immediately.
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const config = require('../src/config');
const { reverseGeocodeToPlaceName } = require('../src/geolocate/google');

const serviceAccount = JSON.parse(
  fs.readFileSync(config.googleApplicationCredentials, 'utf8')
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: config.firebaseProjectId,
});

const db = admin.firestore();

async function backfillPlaceLabels() {
  console.log('[backfill] Starting reverse-geocode backfill...');

  const devicesSnap = await db.collection('devices').get();
  let updated = 0;
  let skipped = 0;

  for (const doc of devicesSnap.docs) {
    const device = doc.data() || {};
    const imei = device.imei || doc.id;
    const loc = device.location || {};

    if (!loc.lat || !loc.lng) {
      console.log(`[backfill] ⊘ ${imei} - no location data`);
      skipped++;
      continue;
    }

    if (loc.placeLabel) {
      console.log(`[backfill] ✓ ${imei} - already has placeLabel: "${loc.placeLabel}"`);
      skipped++;
      continue;
    }

    const placeLabel = await reverseGeocodeToPlaceName(loc.lat, loc.lng);
    if (placeLabel) {
      await db.collection('devices').doc(doc.id).update({
        location: { ...loc, placeLabel },
      });
      console.log(`[backfill] ✓ ${imei} → "${placeLabel}"`);
      updated++;
    } else {
      console.log(`[backfill] ✗ ${imei} - geocoding failed, skipping`);
      skipped++;
    }
  }

  console.log(`[backfill] Done. Updated: ${updated}, Skipped: ${skipped}`);
  process.exit(0);
}

backfillPlaceLabels().catch((err) => {
  console.error('[backfill] Error:', err);
  process.exit(1);
});
