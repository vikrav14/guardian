# Firebase setup (Guardian)

Create a Firebase project so the gateway can write live device data (and the Flutter app can read it later).

## 1. Create the project

1. Open [Firebase Console](https://console.firebase.google.com/)
2. **Add project** → name it e.g. `guardian-mu`
3. Google Analytics is optional

## 2. Enable services

1. **Authentication** → Sign-in method → enable **Email/Password**
2. **Firestore Database** → Create database  
   - Start in **test mode** for local bring-up  
   - Deploy the real rules before any non-solo use — see step 6

## 3. Service account for the gateway

1. Project settings → **Service accounts**
2. **Generate new private key** → download the JSON
3. Store it **outside** the repo, e.g. `C:\Users\MSI\secrets\guardian-firebase.json`
4. Never commit this file

## 4. Configure the gateway

In `gateway/.env`:

```env
PORT=9000
HOST=0.0.0.0
FIRESTORE_DISABLED=false
FIREBASE_PROJECT_ID=guardian-mu
GOOGLE_APPLICATION_CREDENTIALS=C:\Users\MSI\secrets\guardian-firebase.json
# Set true in production so route history appears in the app (safe to leave false locally).
WRITE_LOCATION_HISTORY=false
```

```bash
cd gateway
npm start
```

## 5. Verify without hardware

Terminal A — gateway:

```bash
cd gateway
npm start
```

Terminal B — fake pendant (Quatre Bornes coordinates by default):

```bash
cd gateway
npm run simulate
```

Optional SOS packet:

```bash
npm run simulate -- --sos
```

With Firestore enabled, check the `devices` collection for IMEI `359633100123456`.

## 6. Deploy Firestore rules + indexes

The rules in [`firestore/rules.example`](../firestore/rules.example) scope every read to `linkedTo(imei)`
(i.e. the caller's `users/{uid}.linkedImeis` must contain the device's IMEI), so the app's alert list
also needs a composite index. Both are already wired up in [`firebase.json`](../firebase.json):

```bash
npm install -g firebase-tools   # once
firebase login
firebase deploy --only firestore:rules,firestore:indexes --project guardian-mu
```

Without this, Firestore falls back to whatever rules you set in test mode — do this before letting
more than one family use the app.

## 7. Firebase Storage CORS (web app)

The Flutter web app fetches avatar bytes and map marker images via XHR. The Storage bucket needs
CORS rules or those requests fail in the browser.

**Automated (Linux/macOS/WSL with gcloud CLI):**

```bash
./scripts/configure-storage-cors.sh
# or explicitly:
gcloud storage buckets update gs://guardian-fbadd.firebasestorage.app \
  --cors-file=firebase/storage.cors.json
```

**Manual (Firebase Console or any machine with gcloud):**

1. Install [Google Cloud SDK](https://cloud.google.com/sdk/docs/install) and run `gcloud auth login`.
2. Select the project: `gcloud config set project guardian-fbadd`
3. Apply CORS from the repo file [`firebase/storage.cors.json`](../firebase/storage.cors.json):

   ```bash
   gcloud storage buckets update gs://guardian-fbadd.firebasestorage.app \
     --cors-file=firebase/storage.cors.json
   ```

4. Reload the web app — avatar/map marker byte fetches should succeed.

## 8. Flutter

The mobile app uses its own Firebase app config (`lib/firebase_options.dart`, generated via
`flutterfire configure`) — separate from the gateway's service account.
