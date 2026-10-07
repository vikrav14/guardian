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

The app shows a login/register screen. New accounts get a `users/{uid}` profile with no linked watches — link the V52 from **Account → Link a watch**.

## Register a Firebase Web app

1. Open [Firebase Console → Guardian](https://console.firebase.google.com/project/guardian-fbadd/settings/general)
2. **Your apps** → **Add app** → **Web** (`</>`)
3. Nickname: `Guardian Web` → Register
4. Copy the config values (`apiKey`, `appId`, `messagingSenderId`)
5. Paste them into [`apps/mobile/lib/firebase_options.dart`](../apps/mobile/lib/firebase_options.dart) replacing the `REPLACE_WITH_...` placeholders

Also enable **Firestore** rules that allow reads while testing (or keep temporary test mode). For production, deploy [`firestore/rules.example`](../firestore/rules.example) after Auth is wired.

## Register/configure the native Android app

The previous Android options incorrectly copied the Firebase Web app ID. Native
builds now require the Android client configuration and show an unconfigured
build screen if it is missing. Web configuration remains unchanged.

1. In the existing `guardian-fbadd` Firebase project, select the Android app with
   package **mu.guardian.guardian**, or register it if none exists. Download its
   `google-services.json` client configuration (not a service-account JSON).
2. In `apps/mobile`, copy `android-config.example.json` to `android-config.json`
   (gitignored). Set `FIREBASE_ANDROID_APP_ID` from the matching client's
   `client_info.mobilesdk_app_id`, and `FIREBASE_ANDROID_API_KEY` from its
   `api_key[].current_key`. The app ID must start `1:813482800288:android:`.
3. Set `GUARDIAN_GATEWAY_URL` to your HTTPS gateway, or use the supplied localhost
   value with USB port forwarding from the Home Wi-Fi runbook.
4. Keep the Android Maps key in `android/local.properties` as described below.
   Its Android restriction must match this package and the test signing key.
5. Launch with `flutter run -d ANDROID_DEVICE_ID --dart-define-from-file=android-config.json`.
   Keep other normal app variables. Build with the same file for an APK.

The app explicitly initializes Firebase with Dart options; downloading the
client JSON alone does not replace these options. No service-account or gateway
admin credential belongs in the app. Reference: [Firebase Flutter setup](https://firebase.google.com/docs/flutter/setup).
The compile-only CI APK has no account configuration and is not a customer build.

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
