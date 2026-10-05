# V52 AnyTracking Wi-Fi comparison

Status, 1 October 2026: recorder implemented; no supplier Wi-Fi behavior accepted
by this change. PR #113 remains draft. Reporting, Home, recovery, alarms, photo
capture, consent and notification behavior are unchanged. This standalone tool
is preparation for the supplier comparison requested by the operator.

## Why compare

The supplier guide recommends normal 10-minute reports and temporary one-minute
urgent locating, then returning to 10 minutes or one hour. It also describes two
2.4 GHz Wi-Fi zones. See the [original-document review](../services/wifi-home-supplier-validation.md#sources-inspected)
and the [official V52 guide, page 2](https://ireachfar.com/wp-content/uploads/2023/07/User-Guide-RF-V52-Smart-GPS-Watch-U.pdf).
These statements do not establish exact behavior on the pilot firmware.

At the original comparison checkpoint, Guardian used battery-dependent
1/5/10/15-minute normal reporting. The 5 October integration change removes the
normal battery tiers in favor of 600 seconds; see
[reporting-command-policy.md](../services/reporting-command-policy.md) for the
current bounded emergency/outing exceptions and rollout status.
Its passive Home observer requires three observations, gaps no greater than
60 seconds, and expires evidence after 120 seconds. A change to 10 minutes alone
cannot sustain current Home evidence under those rules. At the original
checkpoint, manual mode also bypassed automatic SOS interval overrides; do not
use it as a shortcut. The integration branch now preserves emergency overrides
in manual mode. Native fence provisioning/removal and
independent departure behavior remain unproven. The earlier single-router trial
did not resolve this. Recording AnyTracking is the next source of evidence.

The operator's four screenshots show Geofence > WiFi Fence > + > Add WiFi Fence,
with Name, a Wi-Fi dropdown and OK. The fence list appears empty. This is an app
observation, not watch readback. The origin/freshness of dropdown networks and
the removal controls are not yet established. The home-screen historical offline
notification and battery label are not proof of the watch's current connection.

## Recorder boundary

`gateway/scripts/capture-wifi-session.js` uses the existing transparent relay:

- `--backend anytracking` forwards only the selected protocol ID to
  `a.igps123.com:7720`; `guardian` forwards to local port 9000 for comparison.
- It generates no commands or acknowledgments. Original bytes, ordering and
  stream backpressure are preserved. Observation failure is marked; forwarding
  continues. It has no Firebase, gateway config or cloud-provider dependencies.
- Logs contain safe command names, frame lengths/case, UPLOAD seconds, observed
  WIFIFENCE argument structure, receipt/reported times, battery in location
  frames, radio signal values, and generic fence bits at V52 state index 15.
- Router names, addresses, coordinates, cell identifiers, contact details,
  health values and images are omitted. The selected watch protocol ID and
  routing endpoints remain in session metadata. Keep real captures out of git.
- Router aliases (router_1, etc.) match configuration to observations within
  this run only. They do not identify Home by themselves. No alias key is saved.
  A maximum of 512 radios is retained; exhaustion is explicit. Fence arguments
  retain only radio aliases/format, empty fields and small numeric syntax;
  unfamiliar text stays redacted. Only 24 arguments are retained, with truncation.
- Missing, malformed, explicitly empty and rejected-radio scans remain distinct.
  Valid GPS does not hide an accompanying raw Wi-Fi scan. Generic fence bits
  cannot distinguish GPS/Wi-Fi origins or prove a wearer departed.
- Capture is bounded: default 45 minutes, maximum 90, 2,000 log rows. Framing
  loss, unfinished frames, disk failure and row truncation prevent claiming a
  complete capture. Complete framing does not mean complete protocol decoding,
  settings acceptance, continuous Home, or supplier-server logic discovery.
- The existing movement recorder keeps its original 20-minute limit/default.

The PowerShell helper defaults to a **20-minute setup-only session**. It checks
the local Guardian listener, rejects an occupied recorder port, discovers current
loopback ngrok endpoints and checks public TCP reachability plus the supplier
server. Reachability is not proof of end-to-end watch routing. No address is
hardcoded and no SMS is sent automatically. Verify fresh watch frames after the
SMS. Forwarding through AnyTracking pauses this watch's Guardian telemetry and
alarm delivery; use the supervised tester watch only.

## First session: capture setup, not a walk

Use an isolated checkout of this branch. No npm install, gateway restart, app
deployment or runtime environment change is needed for the recorder. Leave the
watch on the current verified Guardian route until the recorder is ready.

```powershell
& '<isolated-checkout>\scripts\start-wifi-comparison.ps1' `
    -ProtocolId '<the pilot 10-digit protocol ID>' -Minutes 20
```

1. Wait for `wifi_observation_ready`, then send the **TO RECORDER SMS printed
   by this run** to the watch. Keep the terminal running. Wait for
   `upstream_connected`; check fresh CONFIG/LK/location frames in the capture.
   If it does not connect, do not save settings or keep changing addresses.
2. Open AnyTracking > Geofence > WiFi Fence. Note the time of opening and inspect
   any existing zones. Preserve them. Do not infer the watch is empty from an
   empty/stale app list.
3. Tap +. Use a distinctive temporary name, `Guardian WiFi Test`. Open the Wi-Fi
   dropdown and take a screenshot. Select the intended home **2.4 GHz** network
   only if identifiable. If the list is empty/ambiguous, stop there and share it.
4. Press OK **once**, note the local time and success/error text, and capture the
   resulting fence list. Do not change reporting, request location, trigger SOS,
   start photography or walk away in this first setup comparison.
5. Inspect the captured WIFIFENCE/configuration traffic and watch response before
   declaring success. Absence of a WIFIFENCE write does not establish that the
   feature is absent: the app might store server-side settings or use a command
   outside the decoded allowlist. Unknown commands are marked OTHER.
6. Record the app's removal controls and remove only the temporary test zone
   through those controls while capture is active, noting the time. Do not send
   guessed WIFIFENCE clear commands. If removal is unavailable, restore Guardian
   routing before expiry and report the retained setting as unconfirmed.
7. Send the printed/current **RETURN TO GUARDIAN SMS before recorder expiry**.
   Verify fresh Guardian packets, then stop the recorder. An SMS sent, closed
   supplier socket, or stopped recorder does not prove restoration. Switching
   servers does not undo persistent interval/fence settings.

The helper prints CAPTURE and LOG paths in a unique temporary folder. Share the
redacted JSONL and screenshots/action times. Do not re-save repeatedly while
waiting. Routine per-frame evidence goes to the file, so a quiet terminal alone
does not mean there is no traffic.

## Later behavior comparison, after reviewing setup and removal

Use a longer capture with a verified return route and enough remaining time to
restore. Record the starting supplier interval and zone settings. Change one
thing at a time through the UI, saving the normal interval as 10 minutes once.
Observe at home for several intervals with the app in the background and without
Refresh/Locate; record separate app-open/Locate trials afterwards if needed.

Mark actual departure and return times, received watch frames, and AnyTracking
notification times. Keep the recording PC online at home and let the watch screen
sleep normally. Separately test router loss while the watch remains home: radio
loss must not be treated as independent proof that the person left. Notifications,
watch events and app display changes are separate evidence. Capture cannot expose
all private server-side policy. Restore prior settings and routing afterwards.

Only then choose a normal reporting policy. Prefer a supplier-aligned 600-second
baseline with bounded faster reporting for an active need, preserving emergency
handling and an explicit low-battery safeguard. Assess departure delay, Home
freshness, liveness/recovery, battery and restoration after restart before rollout.
Do not prolong stale Home evidence simply to make the UI green or create a hidden
CR loop. Keep the separate [photo coordination investigation](../services/incident-photo-command-coordination.md)
open: there is no established causal link between reporting and the failed images.

## Software validation

All 40 focused relay/radio tests pass. They cover byte-for-byte forwarding, privacy, preview without
network/file creation, same-run alias matching, unsupported/empty scans, valid-GPS
radio data, generic fence provenance, bounded evidence and unchanged reminder
recorder behavior. PowerShell has been reviewed but cannot be executed in this
Linux workspace; the first Windows preflight is still required. No live supplier
capture or Wi-Fi fence acceptance is claimed.
