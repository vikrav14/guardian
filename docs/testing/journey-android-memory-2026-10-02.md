# Journey Android memory and gesture regression

Physical test: 2 October 2026, Samsung SM-S918B, Android 16/API 36,
Flutter 3.44.6, debug APK. Starting implementation: `de84c09` on
`feat/guardian-home-wifi-setup` (draft PR #141).

## Diagnosis

The reported Java heap failure has a 268,435,456-byte growth limit and ends
in `DartMessenger`/SIGABRT. That allocation stack does not identify the owner
of the retained memory.

Reproduced with the 25 September second journey (103 recorded points,
1,017 provider-derived display points). The map pulse rebuilt `GoogleMap`
on every animation frame even when replay was paused. In the locked Maps
plugin, every widget update sends eight asynchronous object-update messages,
including empty diffs. This overwhelmed the native message queue. Every
display point also had its own transparent, tappable native circle.

A Java heap dump, converted with Android SDK `hprof-conv` and inspected for
class counts and messenger channel fields, contained:

| Object / queued work | Before | After repeated map transitions |
| --- | ---: | ---: |
| Queued `DartMessenger` map-update callbacks | 4,384 | 0 |
| Native plugin `CircleController` objects | 1,021 | 2 |
| Native plugin `PolylineController` objects | 213 | 213 |

The old callbacks were on `MapsApi.updateMarkers`, `updatePolygons`,
`updatePolylines`, `updateCircles`, `updateHeatmaps`, `updateTileOverlays`,
`updateGroundOverlays`, and `updateClusterManagers`: 547–549 each. This is
evidence of a map-update backlog, not evidence that Firestore or avatar
downloads caused this failure. No intentional second OOM was needed; the
old process was stopped after collecting evidence.

## Change

- Replay avatar movement and pulse animate inside a Flutter repaint boundary.
  Native map updates occur when map data/settings change, not on pulse frames.
- Screen-coordinate projections have at most one request in flight, coalesce
  newer camera/position requests, reject stale results, and convert Android
  physical pixels to logical pixels.
- Route taps use nearest-point distance lookup with the previous 22 metre
  radius. There is no native hit circle for each display point. Route geometry,
  evidence layers and replay indexes are retained.
- The embedded map uses Flutter's `EagerGestureRecognizer`, so map gestures
  are delivered to the map inside the surrounding scroll view. The avatar
  overlay ignores touches.
- Expansion releases the preview map. Returning creates one fresh preview.
  A live route refresh waits until the expanded snapshot is closed before
  replacing its shared replay controller.
- `GoogleMap` alone disposes its controller; camera-fit/projection completions
  after navigation are guarded. Duplicate delayed initial camera fits were removed.

Supported API references:
[GoogleMap gestures](https://pub.dev/documentation/google_maps_flutter/latest/google_maps_flutter/GoogleMap/gestureRecognizers.html),
[EagerGestureRecognizer](https://api.flutter.dev/flutter/gestures/EagerGestureRecognizer-class.html),
[screen coordinates](https://pub.dev/documentation/google_maps_flutter/latest/google_maps_flutter/ScreenCoordinate-class.html).
No package upgrade, renderer override, or increased Android heap limit is used.

## Validation

- `flutter analyze --no-pub`: no issues.
- `flutter test --no-pub`: 705 tests passed. New regression coverage checks
  idle/movement channel traffic with 1,200 points, map disposal, projection
  backpressure and late completion, pixel scaling, touch pass-through, nearest
  point selection, and preview removal/restoration during expansion.
- `flutter build web --release --no-pub`: passed, including the Wasm dry run.
- Android debug APK build/install: passed. The existing `android-config.json`
  and the operator-supplied `GUARDIAN_MOVEMENT_REMINDER_PILOT_IMEI` define were
  used unchanged. The actual command is recorded in the local test report.
- On the phone: selected both 25 September trips; replay advanced the avatar
  and time label; expanded and returned repeatedly (five consecutive cycles
  plus other navigation); panned the embedded and expanded maps; double-tap
  zoomed; fitted the route; toggled recorded GPS evidence; returned to Home
  and reopened the same Journey. Flutter remained attached to the same process.
- Sixty `dumpsys meminfo` samples from 01:22:10 to 01:27:22 MUT covered replay,
  navigation and idle time. Dalvik **Heap Alloc** ranged from 18,715 to 37,250
  KiB, ending at 21,307 KiB. A separate immediate sample during rapid
  transitions reached 40,362 KiB and subsequently fell to 23,991 KiB; view count
  returned from 109 to 59. These are Java allocation measurements, not total
  process memory. Debug Dart/graphics memory is separate.
- No OOM, fatal signal, unhandled Flutter exception, or lost-device connection
  appeared in the updated process's collected logs.

The standalone Chrome coordinate-regression invocation stalled while loading
the suite on this laptop; it is not a passing browser-runtime result. Android
hardware testing and the Web release compile are independent of that runner.
Pinch zoom was not injected through ADB; pan and double-tap zoom were tested.
This bounded debug-device run is not a long-term or release-profile soak test.

Firebase/Maps credentials, Android identity, gateway/ngrok processes and
configuration, and the pre-existing untracked work were not changed.

## Person and time design follow-up

The guardian selected the Person and time proposal on 2 October 2026.

- Replaced default green/red Journey endpoint pins with two static, neutral text-and-shape bitmap markers. Bitmap creation happens only when endpoint labels/theme/density change, not during replay frames; native raster resources are disposed after encoding.
- The Flutter replay overlay now shows the wearer photo (or initials), name and selected historical time. It has no continuous pulse. The name yields space to the time, and the label switches sides near the map edge without moving the avatar away from its coordinate.
- Consolidated full-screen controls into one lower replay panel, moved raw GPS points to Details, added an explicit history/date heading and map camera padding, and hid unrelated POIs/transit icons.
- Preserved the difference between recorded GPS, approximate network locations and estimated route positions. An unanchored first point says First recorded; a trip without a confirmed return says Last recorded.

Validation of this follow-up:

- Flutter analyze: no issues.
- Full Flutter suite: 705 passed. After the final spacing/caption refinements, all 24 focused Journey runtime/map/UI tests passed again.
- Final Android debug APK and Web release build succeeded. Android used the existing android-config.json and the unchanged GUARDIAN_MOVEMENT_REMINDER_PILOT_IMEI=861397052547492 define.
- Installed on SM-S918B. Tested 25 September 2026, trip 2 (18:07–19:29): photo and time moved to 18:21, paused without pulsing; pan and double-tap zoom, automatic label-side change, Fit route, Details, GPS evidence on/off, and four close/reopen map cycles worked.
- During 18 memory samples across approximately three minutes, the final installed app kept PID 24941. Java/Dalvik heap allocation ranged from 24,363 to 31,866 KiB and ended at 25,662 KiB. Final process log contained no OutOfMemory, FATAL EXCEPTION, SIGABRT, unhandled Dart exception or RenderFlex overflow match.
- Pinch gestures were not exercised by the ADB test. A browser release build passed; browser runtime interaction was not retested in this follow-up.
- Final phone state: Journey full-screen, 25 September 2026, paused at 18:21. Changes remain uncommitted; no push, Firebase/Maps configuration change or gateway/ngrok change.
