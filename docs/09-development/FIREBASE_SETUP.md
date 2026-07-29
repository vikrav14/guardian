# Firebase Setup Guide

**Last updated:** 2026-07-29

How to create and configure a Firebase project for Guardian development.

## Step 1: Create a Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click "Add project" (or "Create project")
3. Enter project name: `guardian` (or any name)
4. Accept terms, click "Continue"
5. Disable Google Analytics (not needed for development)
6. Click "Create project"

Wait ~1 minute for project creation to complete.

## Step 2: Enable Firestore

1. Left sidebar → "Firestore Database"
2. Click "Create database"
3. **Security rules:** Select "Start in test mode" (allows all reads/writes for development)
4. **Location:** Choose `asia-southeast1` (Singapore; closest to Mauritius)
5. Click "Create"

Wait for database to initialize (~1 min).

## Step 3: Enable Authentication

1. Left sidebar → "Authentication"
2. Click "Get started"
3. Under "Sign-in method" tab:
   - Click "Email/Password"
   - Enable "Email/Password"
   - Click "Save"

## Step 4: Enable Cloud Messaging (FCM)

1. Left sidebar → "Cloud Messaging"
2. You'll see "Sender ID" displayed (note this for Android)

## Step 5: Download Service Account Key

Needed for gateway to write to Firestore.

1. Left sidebar → "Project settings" (gear icon)
2. "Service accounts" tab
3. Select "Node.js" from dropdown
4. Click "Generate new private key"
5. Save JSON file to `gateway/firebase-key.json`

**IMPORTANT:** Don't commit this file! Add to `.gitignore`.

```bash
# In gateway/.gitignore
firebase-key.json
```

## Step 6: Get Mobile App Credentials

### For Android

1. Project settings → "General" tab
2. Scroll to "Your apps" section
3. Click "Android" app (or add one if not present)
4. Follow setup wizard to download `google-services.json`
5. Save to: `apps/mobile/android/app/google-services.json`

### For Web

1. Project settings → "General" tab
2. Under "Your apps" → Click web app (or add one)
3. Copy Firebase config object:
   ```javascript
   const firebaseConfig = {
     apiKey: "AIzaSyD...",
     authDomain: "guardian-xxxxx.firebaseapp.com",
     projectId: "guardian-xxxxx",
     storageBucket: "guardian-xxxxx.appspot.com",
     messagingSenderId: "123456789",
     appId: "1:123456789:web:abc123xyz"
   };
   ```
4. Use in `apps/mobile/web/index.html` or Flutter web config

## Step 7: Configure Gateway `.env` File

```bash
cd gateway
cp .env.example .env
```

Edit `gateway/.env`:

```
# Firebase Admin SDK
FIREBASE_PROJECT_ID=guardian-xxxxx
FIREBASE_PRIVATE_KEY_PATH=./firebase-key.json
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@appspot.gserviceaccount.com

# Location history (write to Firestore)
WRITE_LOCATION_HISTORY=true

# Notifications (optional)
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_WHATSAPP_NUMBER=+1234567890

# AI Assistant (optional)
CLAUDE_API_KEY=sk-...
```

**Where to find these values:**

| Variable | Location |
|----------|----------|
| FIREBASE_PROJECT_ID | Firebase Console → Project settings → Project ID |
| FIREBASE_CLIENT_EMAIL | Service account JSON → `client_email` field |
| Twilio credentials | [Twilio Console](https://console.twilio.com) → Account Info |
| Claude API key | [Console.anthropic.com](https://console.anthropic.com) → API Keys |

## Step 8: Deploy Firestore Indexes

Guardian requires a composite index for the alerts query.

1. Run gateway: `npm start` (from gateway directory)
2. Watch for error message about missing index
3. Click link in error message → Creates index automatically
4. Or manually create in Firebase Console:
   - Collection: `alerts`
   - Fields: `imei` (Ascending), `createdAt` (Descending)

## Step 9: Create Firestore Security Rules

Guardian uses security rules to prevent users from accessing other users' data.

1. Firestore Database → "Rules" tab
2. Copy rules from `firestore/rules.example`
3. Paste into Firebase Console rules editor
4. Click "Publish"

**Important:** Test rules in "test mode" first, then replace with production rules.

## Step 10: Verify Setup

Test the full flow:

1. **Terminal 1 — Gateway:**
   ```bash
   cd gateway
   npm start
   ```
   Should show: `Listening on port 9000...`

2. **Terminal 2 — Simulator:**
   ```bash
   cd gateway
   npm run simulate
   ```
   Should show: `Sending fake location data...`

3. **Terminal 3 — Mobile:**
   ```bash
   cd apps/mobile
   flutter run
   ```
   Should show: App loads, shows map with device marker

4. **Check Firestore:**
   - Firebase Console → Firestore Database
   - Should see documents in: `locations/`, `devices/`, `users/`

If all three are working, Firebase is properly configured! ✓

## Troubleshooting

### "Error: Could not load the default credentials"

Ensure `FIREBASE_PRIVATE_KEY_PATH` in `.env` is correct:
```bash
# Download the key again:
# Firebase Console → Project Settings → Service Accounts → Generate New Private Key
```

### "Firestore query requires composite index"

When first querying alerts, Firestore will ask for an index. Click the link in the error message to create it automatically.

Or create manually:
1. Firebase Console → Firestore → Indexes
2. Create index on `alerts` collection
3. Fields: `imei` (Ascending), `createdAt` (Descending)

### "Permission denied" on Firestore reads

Your rules may be too restrictive. During development, use test mode:
```
// Allow all reads/writes for development
allow read, write: if true;
```

Once deployed, replace with production rules from `firestore/rules.example`.

### Mobile app shows blank map

1. Check Firebase project ID matches `google-services.json`
2. Check Firestore rules allow reads (test mode or rule includes your email)
3. Check gateway is running and writing to Firestore
4. Check network connection (should reach `firebaseapp.com`)

### Gateway won't connect to Firestore

1. Check `.env` variables are correct
2. Verify `firebase-key.json` exists and is readable
3. Test connection:
   ```bash
   # In gateway directory
   npm test  # Run tests; they use Firebase
   ```

---

## Next Steps

- [Gateway Setup](GATEWAY_SETUP.md) — Configure the gateway server
- [Getting Started](GETTING_STARTED.md) — Run everything locally
- [Local Development](LOCAL_DEVELOPMENT.md) — Daily workflow
