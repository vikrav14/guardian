# Android incident gallery access — 2 October 2026

## Reproduction and cause

The Samsung SM-S918B native app showed “SOS incident” and “Could not load
incident photos” for a fall whose photo and AI were visible on the hosted web
app. The existing Android build used `http://127.0.0.1:9001`; there was no ADB
reverse mapping. On the phone, that address refers to the phone itself.

The same 16:21:46 Mauritius fall failed without forwarding and loaded as a
fall with one photo and AI after temporarily adding `tcp:9001` reverse
forwarding. No incident, permission, server setting or watch command was
changed to make it load. The misleading SOS heading was the null-feed fallback.

## Correction

- Use the existing public HTTPS gateway as an explicit Android build override.
  Preserve the existing `android-config.json`, Firebase/Maps configuration and
  movement-reminder pilot define. Loopback remains useful only for deliberate
  local development with forwarding.
- Show “Incident photos” until the feed establishes SOS, fall or supervised
  trial. Unknown types also remain neutral.
- Convert HTTP transport failures into a connection message for reads. A lost
  camera-request response remains `request_status_unknown` and is never retried
  automatically; exception details and URLs are not displayed.

## Validation

- 19 focused tests passed across `incident_photo_page_test.dart` and
  `safety_snapshot_service_test.dart`, including failure/recovery, neutral
  heading, access/privacy handling and no replay after a lost camera response.
- Targeted Flutter analysis: no issues. Debug APK built successfully.
- Installed with `adb install -r` over wireless ADB, preserving app data.
- Removed the temporary reverse mapping before testing the new build.
- At about 16:50 Mauritius time, the native app displayed the 16:21:46 fall,
  one saved photo received at 16:21:59, and its AI summary over HTTPS. The
  actual image rendered. ADB reverse list was empty.
- Both Android config files, Android local properties, original gateway
  environment and private combined-runtime environment matched their
  pre-change hashes. The completed Wi-Fi/Journey work was preserved.
- Gateway PID 24396 and ngrok PID 10500 were left running without restart.

The existing laptop gateway and tunnel must still be running for private
photos to load. A future Android build must retain the HTTPS override if it
should work without ADB forwarding. This client fix does not explain or fix
the watch acknowledging a capture without uploading its image.
