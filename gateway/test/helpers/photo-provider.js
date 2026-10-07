'use strict';
// Format/vision tests inject the transport explicitly. Budget enforcement is
// exercised with the real clients in intelligence-core.test.js.
const { jsonRequest } = require('../../src/intelligence-core/provider');
async function messageClient({ apiKey, body, fetchImpl }) {
  return { payload: await jsonRequest('https://api.anthropic.com/v1/messages', body,
    { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, fetchImpl), usage: null };
}
const analysis = require('../../src/incident-photo-analysis');
const orientation = require('../../src/incident-photo-orientation');
const live = require('../../src/incident-photos-live');
module.exports = { ...analysis, ...orientation, messageClient,
  createPhotoAnalyzer: options => analysis.createPhotoAnalyzer({ ...options, messageClient }),
  createOrientedPhotoAnalyzer: options => orientation.createOrientedPhotoAnalyzer({ ...options, messageClient }),
  configuredPhotoAnalyzer: options => live.configuredPhotoAnalyzer({ ...options, messageClient }),
};
