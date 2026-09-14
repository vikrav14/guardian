#!/usr/bin/env node
'use strict';

// Read only: preserve source timestamps from recent device document versions.
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const admin = require('firebase-admin');
const config = require('../src/config');

function iso(value) {
  const date = value?.toDate ? value.toDate() : new Date(value);
  return Number.isFinite(+date) ? date.toISOString() : null;
}

async function capture(db, imei, from, to, output) {
  const ref = db.collection('devices').doc(imei);
  const result = { version: 1, kind: 'firestore_document_versions', projectId: config.firebaseProjectId,
    imei, from: from.toISOString(), to: to.toISOString(), capturedAt: new Date().toISOString(),
    snapshotsRead: 0, points: [], errors: [] };
  const seen = new Set();
  const save = () => {
    fs.writeFileSync(output + '.tmp', JSON.stringify(result, null, 2), { mode: 0o600 });
    fs.renameSync(output + '.tmp', output);
  };
  // Save after each small batch so already-read evidence survives a later error.
  for (let time = +from; time <= +to; time += 5000) {
    await Promise.all(Array.from({ length: 5 }, async (_, i) => {
      const at = time + i * 1000;
      if (at > +to) return;
      try {
        const snapshot = await db.runTransaction(tx => tx.get(ref), {
          readOnly: true, readTime: admin.firestore.Timestamp.fromMillis(at),
        });
        result.snapshotsRead++;
        const data = snapshot.data() || {};
        for (const field of ['lastSatelliteLocation', 'lastLocationObservation', 'location']) {
          const p = data[field];
          if (!p || p.source !== 'gps' || p.gpsValid !== true || !iso(p.recordedAt)) continue;
          if (!Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) continue;
          const key = [iso(p.recordedAt), p.latitude, p.longitude].join(':');
          if (seen.has(key)) continue;
          seen.add(key);
          result.points.push({ source: 'gps', gpsValid: true, latitude: p.latitude,
            longitude: p.longitude, recordedAt: iso(p.recordedAt),
            accuracyMeters: p.accuracyMeters ?? null,
            readTime: new Date(at).toISOString(), documentUpdateTime: iso(snapshot.updateTime), field });
        }
      } catch (error) {
        result.errors.push({ readTime: new Date(at).toISOString(), code: error.code ?? null,
          message: String(error.message).slice(0, 300) });
      }
    }));
    save();
    if (result.snapshotsRead === 0 && result.errors.length >= 5) break;
  }
  result.points.sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));
  save();
  return { outcome: 'read_only', snapshotsRead: result.snapshotsRead,
    uniqueGpsPoints: result.points.length, failedReads: result.errors.length,
    firstError: result.errors[0] || null, savedTo: output };
}

async function main(argv = process.argv.slice(2)) {
  const from = new Date(argv[0]), to = new Date(argv[1]);
  if (!Number.isFinite(+from) || !Number.isFinite(+to) || +to <= +from || +to > Date.now() ||
      +to - +from > 900000) throw new Error('Supply two past ISO timestamps covering at most 15 minutes.');
  const imei = config.wifiHomePilotImei;
  if (!/^\d{15}$/.test(imei || '') || !config.firebaseProjectId || !config.googleApplicationCredentials) {
    throw new Error('Run in the configured gateway directory using its existing credentials and pilot.');
  }
  const folder = path.resolve('data', 'journey-recovery');
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  const output = path.join(folder, `device-versions-${Date.now()}.json`);
  const app = admin.initializeApp({ projectId: config.firebaseProjectId,
    credential: admin.credential.cert(JSON.parse(fs.readFileSync(config.googleApplicationCredentials, 'utf8'))) }, 'journey-version-capture');
  try { console.log(JSON.stringify(await capture(app.firestore(), imei, from, to, output), null, 2)); }
  finally { await app.delete(); }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { capture, iso };
