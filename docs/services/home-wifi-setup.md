# Guardian Home Wi-Fi setup

Implementation checkpoint: 1 October 2026. Own-app enrollment is implemented;
initial Android discovery, matching and save were physically observed on
1 October (see the field result below). Remaining acceptance is pending.
Existing private Home detection
results remain valid within their recorded limits. This does not accept native
Wi-Fi fence provisioning, continuous Home detection, departure alerts or a new
reporting interval. The photo coordination investigation remains separate.

## User flow

Safe Zones → select the active zone named Home → Set up Home Wi-Fi. The service
owner with a linked watch and an active Family/Care plan can see recent networks
reported by that watch. On native Android, tap **Find Wi-Fi names** to add names
from a phone scan; phone-only networks appear disabled until the watch reports
the same access point. Names are labels; same-name radios appear separately with
a short radio suffix. An unnamed radio is labelled explicitly. No network is
selected automatically. Confirm the selected network and saved Home map pin,
then press Save Home Wi-Fi. No Wi-Fi password is requested.

Saving stores a router fingerprint and clears previous Home evidence. It is not
proof the watch is currently at Home. The existing observer must qualify new
reports before Home appears in the map or ordinary WhatsApp location response.
Replace by selecting a new fresh report; Remove saved network clears enrollment
and current/remembered Home evidence but preserves the geographic safe zone.
Only the service owner can manage network data; a family member sees an explicit
owner-only message. Removal remains possible after subscription expiry.

The free-text Wi-Fi-name field was removed from Add safe zone because it did not
identify a router or enroll actual watch detection. Existing geographic zones
and their source-aware alert evaluation are unchanged.

## Runtime and security

- Server flag `WIFI_HOME_SETUP_ENABLED=true` enables the authenticated endpoint
  and enrollment runtime. No additional Flutter pilot flag. The app uses its
  existing `GUARDIAN_GATEWAY_URL`. Disabled/unavailable runtime is explained in
  the screen; requests do not fall back to unauthenticated endpoints.
- GET/POST/DELETE `/app/home-wifi?imei=...`; GET also takes `geofenceId`.
  Firebase tokens are verified with revocation checking. Owner linkage and Home
  ownership are checked server-side; Family/Care entitlement gates enrollment.
- Only reports received while an authorized setup screen is open enter the
  discovery cache. Up to 64 discovery contexts, at most five recent radio choices
  per context. Choices expire after 120 seconds, using source and receipt times.
  Empty or partial scans retain unreported choices only until their original
  expiry; only a new sighting of that radio renews its timestamp. When full,
  newest sightings take priority, then stronger signals. This list is for setup
  and is not current Home presence evidence.
  Sessions expire ten minutes after the last authorized read and are swept at
  least every 30 seconds. Names/raw radio addresses stay in that bounded memory.
  The default packet parser and diagnostic path still omit names.
- The UI checks received reports every ten seconds while visible, for up to ten
  minutes; explicit Refresh opens another window. It does not trigger scans or
  CR. Opening the page just after a report may require waiting for the next
  normal report. With ten-minute reporting, this can take ten minutes or longer
  if a report lacks Wi-Fi data or connectivity is interrupted.
- Selection tokens are scoped to owner, watch, zone and pin. The server accepts
  only opaque candidate IDs to enroll. Android name matching uses the separate
  authenticated phone-scan endpoint described below; phone input never creates
  or renews a watch candidate. Pin/owner/plan/scan freshness and the
  expected revision are rechecked inside the enrollment transaction. No blind
  automatic save retries; refresh resolves an uncertain result.
- `homeWifiEnrollments/{imei}` is backend-only, denied to all Firestore clients.
  It contains an HMAC fingerprint, private random key, chosen display label,
  owner, zone/pin binding, enabled flag, version and timestamp. It contains no
  raw MAC, Wi-Fi password, scan history or location history. Removing replaces
  it with a disabled revision tombstone and removes the key/hash/label.
- Enrollment changes and clearing device Home fields are atomic. Publishers
  recheck enrollment revision and current Home authorization transactionally
  before writing. A delayed old publisher cannot restore removed settings.
- A listener loads enrollments on restart. Observation remains synchronous and
  separate from alarm processing. Publishers activate on location/alarm packets
  and stop after 15 minutes without those packets. Enrollment-listener failure
  suspends enrollment observation/publication and retries after 30 seconds;
  published evidence can only last to its original expiry.
- Existing `.env` pilot enrollment is retained as fallback until an app
  enrollment/tombstone exists for that watch. The app setup runtime uses the
  established observer/display policy; the optional walk-recovery experiment
  is not enabled by this flag.

## What is deliberately unchanged

No `UPLOAD`, `CR`, `WIFIFENCE`, camera or other watch commands are sent by opening,
refreshing, saving or removing Home Wi-Fi. No reporting defaults, command priority,
SOS/fall timing, raw coordinates or alert thresholds are changed. Native Wi-Fi
fence behavior remains unverified. A missing router, expired report or router
outage never independently becomes a departure alert.

The existing observer requires three strong reports spanning at least 20 seconds,
no more than 60 seconds apart, and expires evidence after 120 seconds. These
rules do not support continuous Home detection from a ten-minute-only stream.
Do not lengthen freshness merely to keep Home green. A separate reporting-policy
change needs measured arrival/departure and router-loss tests.

## Acceptance

Before testing, restore the watch to the current Guardian tunnel and verify fresh
packets. The earlier AnyTracking recorder has a bounded lifetime; stopping it or
sending a routing SMS alone is not restoration evidence.

1. Run this branch's gateway with the existing private configuration directory,
   adding `WIFI_HOME_SETUP_ENABLED=true` to that process. Run this branch's app
   against that gateway. Do not copy or commit private `.env` files.
2. Open Home Wi-Fi at home and wait for a normal watch report. Verify the list is
   from the watch, includes observation times, and distinguishes same-name radios.
3. Select the known home radio, confirm the pin and save once. Verify the selected
   setting persists after reopening. Only later qualified sightings may show Home.
4. Restart the gateway. Verify saved enrollment returns without resetting source
   timestamps or manufacturing fresh Home. Verify app/WhatsApp provenance.
5. Remove once. Verify current and remembered Home clear, map pin remains and a
   delayed publisher/restart does not restore the old pilot enrollment.
6. Test wrong account/family member, expired scan, Home pin edit, subscription
   expiry, concurrent replacement and uncertain HTTP result. No unauthorized
   discovery or stale overwrite should succeed.
7. Separately test real departure/return and router loss; document observations
   without marking untested timing/battery guarantees as accepted.

## 1 October field follow-up: intermittent scans and missing names

At 11:27–11:34 UTC the watch remained connected. Before one operator-requested
CR at 11:33:19 UTC, the capture contained heartbeats but no location reports.
Fresh UD_LTE reports at 11:33:23 and 11:33:33 contained the previously configured
private Home router at -54 and -39 dBm. A report at 11:33:44 declared zero radios.
No UPLOAD or WIFIFENCE handoffs were recorded. The 10/11-second gaps were during
the requested burst, not a normal reporting-baseline measurement.

The setup list previously replaced all choices on each scan, so a zero-radio
report erased still-fresh choices. Regression coverage now preserves choices
through empty/partial scans, keeps their real timestamps and rejects enrollment
at the existing expiry. The Home-presence observer and qualification are unchanged.

A subsequent app screenshot showed an Unnamed network. A `named` scan layout
means name/MAC/signal triplets; the name may still be empty. Diagnostic capture
version 2 adds `radioNameDiagnostics` counts: `available`, `empty`, `not_reported`,
`too_long` (over 32 UTF-8 bytes), and `filtered` (no displayable text after
sanitizing). It records no SSIDs or full radio identifiers. Use the existing
`wifi-home:fence -- --start` and `--report` commands after restarting the updated
gateway. Do not invent a name or assume an unnamed nearby radio is Home.

A follow-up capture at 11:49:38 and 11:49:46 UTC confirms two fresh UD_LTE
reports, each containing two radios with `available: 0, empty: 2, not_reported: 0,
too_long: 0, filtered: 0`. The Home router was seen at -39/-38 dBm. These
samples contain empty SSID fields; they do not prove all firmware modes omit
names. Corrected app selection/save/reopen and physical Home/departure/router-loss
acceptance remain pending. Requesting CR is a separate
operator action; opening or refreshing setup remains passive.


## Android phone-assisted names — 1 October 2026

This branch uses the MIT-licensed [`wifi_scan` 0.5.0](https://pub.dev/packages/wifi_scan)
dependency, pinned with its published archive hash. No plugin fork, iOS target,
background scanner, Wi-Fi connection or password collection is added. The Web
build retains watch-based choices and displays the saved name after enrollment.

- Scanning is an explicit Android button, never an automatic permission prompt
  on page open or a scan on each ten-second gateway refresh. Explain Android's
  location requirement before asking. Wi-Fi and Location must be enabled; precise
  foreground location permission is needed on modern Android. No background
  location permission is requested.
- Subscribe before starting the native scan. Reject cached results unless their
  Android boot timestamps advance beyond the pre-scan cache. Bound permission
  waits to 45 seconds per request and the scan/result wait to 20 seconds. Show
  actionable denial, Location-disabled, rejected/throttled and timeout messages.
  Cancel the results subscription after completion/failure and on screen disposal.
- Keep at most 32 named, valid unicast 2.4 GHz access points in screen memory for
  two minutes, ordered by phone signal strength. Hidden/empty/overlong names,
  placeholder or invalid identifiers and other frequency bands are omitted.
  Duplicate names remain distinct by radio suffix; never match by SSID or signal.
- `POST /app/home-wifi/phone-scan?imei=...&geofenceId=...` accepts only
  `{homeKey, networks: [{bssid, ssid, frequency}]}` (8 KiB body, 32 entries).
  Authenticate and check ownership, Family/Care access and the current Home pin
  before matching. Recheck authorization after reads. Names are sanitized using
  the same 32-byte/control-character policy as watch names.
- Match exact normalized BSSIDs against existing fresh discovery choices in the
  same owner/watch/zone/pin context. Return ordinary opaque choices plus matched
  phone-array indexes. Do not return full watch identifiers. Unmatched phone
  entries are not retained by the gateway. Matching never persists enrollment,
  renews observation/expiry, or changes Home presence. A reported watch name takes
  precedence; otherwise a matched phone label remains attached while that
  candidate lives. Only explicit Save persists the chosen label and fingerprint.
- The app can resubmit its bounded phone list during ordinary setup polling for
  two minutes, allowing a later watch report to unlock a previously disabled
  phone result. It clears phone input after expiry, a binding/revision change or
  a failed authorized read. Selecting a candidate still requires Home pin
  confirmation; uncertain save outcomes still require read-only refresh.

### Android test build and physical checklist

The release-gates workflow now compiles a debug Android APK as well as the Web
release. Local Flutter bootstrap was blocked by automatic approval review after
an attempted cloud metadata request; Flutter analysis/tests/build validation is
run in GitHub Actions. A successful compile does not accept real phone scanning.

First complete the native Firebase app configuration in `docs/FLUTTER_SETUP.md`
and create the ignored `android-config.json`. The old Android options used a
Web app ID; a native Android ID/API key must come from the existing Firebase
project. For a USB-connected Android test phone (USB debugging enabled):

```powershell
Set-Location C:\Users\MSI\repos\guardian\apps\mobile
flutter devices
# Replace ANDROID_DEVICE_ID with the Android ID from the list.
# Existing Android SDK and Maps key setup: docs/FLUTTER_SETUP.md.
# With gateway HTTP port 9001 running on this PC, forward it over USB:
adb -s ANDROID_DEVICE_ID reverse tcp:9001 tcp:9001
flutter run -d ANDROID_DEVICE_ID --dart-define-from-file=android-config.json
```

Alternatively use the existing reachable **HTTPS** gateway URL in
`android-config.json`. A phone cannot reach the PC through its own localhost without USB
port forwarding. Do not embed an admin key or private Firebase credentials in
the app. Retain any other normal app launch variables.

1. Owner opens Home setup with the V52 nearby. Tap Find Wi-Fi names and grant
   precise location while using the app. Confirm no password/MAC typing.
2. Verify the actual 2.4 GHz name appears. A phone-only result stays disabled;
   it becomes selectable only after a fresh matching watch report. Check
   duplicates, hidden networks, 5 GHz-only results and intermittent empty watch
   scans. Refresh reads evidence; it sends no CR or other watch command.
3. Deny permission, switch Location off, switch Wi-Fi off, retry rapidly and
   background/close the screen during a scan. Verify messages, bounded waits and
   no automatic background rescanning. Reopen/scan after restoring permissions.
4. Confirm Home pin, save once, reopen on Android and Web, restart the gateway,
   replace and remove. Check saved names and existing evidence expiry semantics.
5. Record phone model/Android version and redacted outcomes here and in the
   real-device ledger. The initial scan/match/save result below is observed;
   the remaining physical checklist is still pending.

### Physical Android discovery and save — 1 October, 19:53 UTC / 23:53 MUT

On a Samsung SM-S918B running Android 16 (API 36), the operator installed and
opened the native debug app. Native Maps rendering was confirmed at 19:43 UTC
after configuring the standard Maps SDK for Android and its Android API key.
The Home setup screenshots independently show the saved Home map rendering.

- The initial screenshot showed one named 2.4 GHz network found by the phone,
  zero matching watch candidates, and a disabled phone-only row and Save.
- The later screenshot reports one phone network and one matching watch network.
  The watch candidate is labelled "Name from phone", at -46 dBm, with an
  observation time displayed as 1 October 23:51 MUT.
- The operator reports that the match appeared while waiting, without running
  the proposed additional manual CR request. No capture was supplied for this
  step, so it is not evidence of the gateway's complete command history or a
  measured normal reporting cadence.
- The operator selected and saved the network. The screenshot shows the saved
  name, "Home Wi-Fi saved. Waiting for fresh watch reports", and the removal
  control. This is positive physical evidence for initial discovery, match,
  selection and save on one phone/watch combination.

SSID, radio suffix, Home coordinates and client keys are omitted from this
public-facing record. The saved screen still says it is waiting for fresh watch
reports: enrollment is observed, current Home presence is not yet accepted.
Reopen on Android/Web, gateway restart, replacement/removal, adverse permission
and scan cases, and Home/departure/router-loss tests remain pending. Existing
qualification (three strong reports spanning at least 20 seconds, gaps no more
than 60 seconds, expiry after 120 seconds) is unchanged; this save does not prove
continuous Home detection with the previously reported 300-second upload setting.
