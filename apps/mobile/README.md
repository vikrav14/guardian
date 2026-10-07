# guardian

A new Flutter project.

## Getting Started

This project is a starting point for a Flutter application.

A few resources to get you started if this is your first Flutter project:

- [Learn Flutter](https://docs.flutter.dev/get-started/learn-flutter)
- [Write your first Flutter app](https://docs.flutter.dev/get-started/codelab)
- [Flutter learning resources](https://docs.flutter.dev/reference/learning-resources)

For help getting started with Flutter development, view the
[online documentation](https://docs.flutter.dev/), which offers tutorials,
samples, guidance on mobile development, and a full API reference.

## Guardian app icon and startup animation

The Android launcher and in-app headers use the full-colour family design in
`GuardianPinMark`: a location pin above two adults, a child and a green heart,
inside an open Mauritius-colour ring. The vector artwork follows the supplied
family-logo reference, including the sloping colour joins and mint pin centre.
The native launch screen shows its grey version on white while Flutter starts.
Flutter then fills the ring, mint dot and heart continuously from top to bottom.
The same animation remains visible across Firebase initialization, sign-in restoration
and profile loading. Every launch lasts at least 15 seconds: a steady 14-second
downward reveal followed by one second displaying the completed Mauritius flag.
Longer loads repeat it after a brief fade. Reduced-motion settings show the
completed logo without animation or the minimum presentation time. Startup
errors offer a retry.

Returning from the background replays the full sequence above the navigator,
then restores the current screen and its state. Services initialize only once.
Temporary focus loss, such as a notification shade or system dialog, does not
trigger another sequence.

Native PNGs are rendered from the Flutter mark, including density variants and
the adaptive icon's safe padding. Regenerate them after changing the logo:

```sh
flutter test --no-pub --dart-define=GENERATE_BRAND_ASSETS=true tool/generate_brand_assets_test.dart
flutter test --no-pub test/guardian_startup_test.dart
```

From the repository root, install using `./scripts/install-guardian-android.ps1`
(or pass `-BuildOnly` to prepare the APK). This fetches current main and refuses a
checkout missing its fixes, preserves private `android-config.json`, and records
the source commit, APK hash and an increasing Android version code. Old
version-code-1 APKs cannot silently replace it with a normal `adb install -r`.
Do not use `-d` to bypass Android's downgrade check when testing a new feature.
The regression this prevents occurred when the logo-only build based on #151
overwrote the installed map-gesture and form fixes from #152.

Icon changes require reinstalling the APK; hot reload does not update the
Android launcher. Rendered previews are saved in `build/brand-preview/`.
The Android configuration follows the [Flutter splash-screen guidance](https://docs.flutter.dev/platform-integration/android/splash-screen)
and [Android icon sizing requirements](https://developer.android.com/develop/ui/views/launch/splash-screen#elements).
