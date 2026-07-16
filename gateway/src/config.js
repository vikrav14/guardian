require('dotenv').config();

const config = {
  host: process.env.HOST || '0.0.0.0',
  port: Number(process.env.PORT || 9000),
  firestoreDisabled: String(process.env.FIRESTORE_DISABLED || 'false').toLowerCase() === 'true',
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID || '',
  writeLocationHistory: String(process.env.WRITE_LOCATION_HISTORY || 'false').toLowerCase() === 'true',
};

module.exports = config;
