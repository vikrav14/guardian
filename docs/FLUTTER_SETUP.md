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

## Android release signing

`flutter run --release` and debug builds work out of the box, signed with the debug key. To produce
a real release APK/AAB (e.g. for Google Play), generate your own upload keystore once:

```powershell
cd C:\Users\MSI\repos\guardian\apps\mobile\android
keytool -genkeypair -v -keystore guardian-upload-key.jks -keyalg RSA -keysize 2048 -validity 10000 -alias upload
```

`keytool` will ask you to choose a store password, a key password, and your name/organization —
keep the passwords somewhere safe, you'll need them for every future release build. Then:

```powershell
Copy-Item key.properties.example key.properties
# Edit key.properties: set storeFile to the full path of guardian-upload-key.jks above,
# and storePassword/keyPassword to what you chose.
```

`key.properties` and `*.jks`/`*.keystore` are already gitignored — never commit them. Once
`key.properties` exists, `flutter build appbundle`/`flutter build apk --release` will sign with it
automatically (see `android/app/build.gradle.kts`).
