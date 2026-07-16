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
   - Later deploy rules from [`firestore/rules.example`](../firestore/rules.example)

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

## 6. Flutter (next)

The mobile app will use a normal Firebase app config (`google-services.json` / `GoogleService-Info.plist`) — separate from the gateway service account.
