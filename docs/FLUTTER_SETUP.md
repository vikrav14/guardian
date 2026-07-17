# Flutter app setup (Guardian)

The map dashboard lives in [`apps/mobile`](../apps/mobile).

## One-time machine setup

1. Flutter SDK is at `C:\Users\MSI\develop\flutter` (add `C:\Users\MSI\develop\flutter\bin` to your user PATH).
2. On Windows, enable **Developer Mode** (needed for plugin symlinks):  
   `start ms-settings:developers` → turn on Developer Mode.
3. Chrome is the easiest target for now (`flutter run -d chrome`).

## Enable Email/Password Auth

1. Firebase Console → **Authentication** → **Sign-in method**
2. Enable **Email/Password** → Save

The app shows a login/register screen. New accounts get a `users/{uid}` profile with the demo simulator IMEI linked.

## Register a Firebase Web app

1. Open [Firebase Console → Guardian](https://console.firebase.google.com/project/guardian-fbadd/settings/general)
2. **Your apps** → **Add app** → **Web** (`</>`)
3. Nickname: `Guardian Web` → Register
4. Copy the config values (`apiKey`, `appId`, `messagingSenderId`)
5. Paste them into [`apps/mobile/lib/firebase_options.dart`](../apps/mobile/lib/firebase_options.dart) replacing the `REPLACE_WITH_...` placeholders

Also enable **Firestore** rules that allow reads while testing (or keep temporary test mode). For production, deploy [`firestore/rules.example`](../firestore/rules.example) after Auth is wired.

## Google Maps

1. In [Google Cloud Console](https://console.cloud.google.com/) enable **Maps JavaScript API** (for Chrome/web) and **Maps SDK for Android** if you build the Android app.
2. Restrict the key (HTTP referrers for web: `http://localhost:8080/*`, Android package later).
3. Copy the local key file (gitignored — never commit the real key):

```powershell
cd C:\Users\MSI\repos\guardian\apps\mobile
Copy-Item web\maps_key.js.example web\maps_key.js
# Edit web\maps_key.js and set window.GOOGLE_MAPS_API_KEY
```

For Android, add to `android/local.properties`:

```
GOOGLE_MAPS_API_KEY=your_key_here
```

## Run the dashboard

Terminal A — gateway + simulator (so there is live data):

```powershell
cd C:\Users\MSI\repos\guardian\gateway
npm start
```

```powershell
cd C:\Users\MSI\repos\guardian\gateway
npm run simulate
```

Terminal B — Flutter:

```powershell
cd C:\Users\MSI\repos\guardian\apps\mobile
flutter run -d chrome
```

You should see the simulated device near Quatre Bornes on the map, with battery / heartbeat updating live.
