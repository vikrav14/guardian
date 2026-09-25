# Take a photo from the Guardian app

25 September 2026 MUT / 24 September UTC. PR #113 now connects an authenticated
app request to the exact observed `3G` / `rcapture` command, private TCP `img`
reception, full JPEG decoding, private Firebase Storage and authenticated image
viewing/deletion. A direct Guardian hardware trial is the remaining acceptance
step; AnyTracking already produced two verified hands-off photos on Jesh.

## Prepare the current checkout

Keep the watch routed to Guardian. No recorder, FTP settings or AnyTracking
session is needed. Stop the existing gateway and Flutter processes with Ctrl+C
in their own windows before starting the updated processes. Leave ngrok running.

From a clean `C:\Users\MSI\repos\guardian` working tree:

```powershell
Set-Location C:\Users\MSI\repos\guardian
git fetch origin feat/v52-remote-photo
if ($LASTEXITCODE -ne 0) { throw 'Fetch failed.' }
git switch feat/v52-remote-photo
if ($LASTEXITCODE -ne 0) { throw 'Switch failed; preserve local changes before proceeding.' }
git merge --ff-only origin/feat/v52-remote-photo
if ($LASTEXITCODE -ne 0) { throw 'Local branch needs reconciliation; do not reset it.' }
npm ci --prefix gateway
if ($LASTEXITCODE -ne 0) { throw 'Dependency install failed.' }
firebase deploy --only "firestore:indexes,storage" --project guardian-fbadd
if ($LASTEXITCODE -ne 0) { throw 'Firebase deployment failed.' }
```

Answer **No** if the CLI asks to delete existing indexes or field overrides.
This trial uses authenticated gateway HTTP calls, not client Firestore reads or
writes to snapshot collections. Preserve the deployed Firestore rules: this
branch predates the separate calling/phonebook/emergency rule changes. Before a
production merge, reconcile those rules and indexes with the current app.

Wait for the new `safetySnapshotAuthorizations` indexes to finish building.
The gateway serves image bytes after verifying the Firebase ID token and current
family access. Bucket CORS, download tokens and a public image URL are not used.
The Storage rules deny all direct client access to `privateSafetySnapshots`.
Keep the existing credentials and other gateway configuration.

## Start the gateway

In the gateway window, set these process-local values and start normally:

```powershell
Set-Location C:\Users\MSI\repos\guardian\gateway
$env:SAFETY_SNAPSHOT_REQUESTS_ENABLED = 'true'
$env:SAFETY_SNAPSHOT_CUSTOMER_ENABLED = 'true'
$env:SAFETY_SNAPSHOT_MEDIA_INGRESS_ENABLED = 'true'
$env:SAFETY_SNAPSHOT_DEVICE_MODE = 'accepted'
$env:SAFETY_SNAPSHOT_ACCEPTED_IMEIS = '861397052547492'
$env:FIREBASE_STORAGE_BUCKET = 'guardian-fbadd.firebasestorage.app'
npm start
```

Only the explicitly listed IMEI can receive a request. No request is sent on
startup, reconnect, app opening or retry. The generic device-command dispatcher
has no photo entry. Duplicate live watch connections temporarily block capture.

## Start the app

Read the **current** ngrok HTTPS endpoint that forwards to port 9001. It is the
same HTTP service used for WhatsApp; do not use either public TCP endpoint as
an app URL. This PowerShell block resolves the current endpoint without saved
variables from another shell:

```powershell
& {
    $ErrorActionPreference = 'Stop'
    $endpoints = (Invoke-RestMethod http://127.0.0.1:4040/api/endpoints).endpoints
    $http = @($endpoints | Where-Object {
        $_.url -like 'https://*' -and
        $_.upstream.url -match '^https?://(?:localhost|127\.0\.0\.1):9001/?$'
    })
    if ($http.Count -ne 1) { throw 'Expected one current HTTPS endpoint forwarding to port 9001.' }
    Set-Location C:\Users\MSI\repos\guardian\apps\mobile
    flutter pub get
    if ($LASTEXITCODE -ne 0) { throw 'Flutter dependency restore failed.' }
    flutter run -d chrome "--dart-define=GUARDIAN_GATEWAY_URL=$($http[0].url)"
}
```

Retain any other launch defines used for unrelated features. For Android, use
the same HTTPS URL and the normal Android run target. This session is not a
production deployment. `GUARDIAN_SAFETY_SNAPSHOTS_ENABLED=false` hides the card;
with the URL configured, the default is visible to active Family/Care users.

## App flow and one direct-device check

1. Open Jesh's dashboard, then **Safety snapshot** and **Take photo**.
2. Confirm permission and the reason for the safety check.
3. Leave the watch controls untouched. A bare reply never completes the request.
4. The screen shows **Taking photo…** until a complete JPEG is validated and saved.
   It shows **No photo received** if the two-minute window ends without one.
5. Check that the picture is new and viewable, then use **Delete photo**. Confirm
   it disappears and cannot be reopened. Record the app result and any screen or
   sound indication on the watch; that indication is still unverified.

There is a **15-minute per-watch cooldown**, shared by all guardians and retained
across gateway restart. The page displays when another request is available.
There are no automatic camera retries. The app refreshes an active request every
three seconds and otherwise every 30 seconds while this page is foregrounded.
On a connection error, automatic polling pauses and **Retry connection** reloads
the status without requesting a photo. Firebase sign-in verification has a
10-second deadline; the HTTP response has a 20-second deadline. The page also
bounds its overall status load to 35 seconds. A late sign-in token cannot send a
camera request after that sign-in check has timed out. A timed-out POST is shown
as an uncertain request, never automatically retried.

If the page cannot connect, record the exact message and check the Flutter
terminal as well as the gateway terminal. Losing browser focus clears private
image widgets/bytes and pauses polling, while retaining request status cards.
Returning refreshes access before images or capture controls are enabled. A
status response from before the focus change cannot restore image access. The
initial loading message describes connection to the photo service, not watch
connectivity; foreground refresh says **Updating photo status** without clearing
the request history. Failed/pending cards show their request time so repeated
attempts can be distinguished.

The 25 September trial reached the service but reported a connected watch as
offline. The photo connection filter used the wrong IMEI substring, expecting
`3970525474` instead of Jesh's observed `9705254749`. It now uses Guardian's
canonical `protocolIdFromFullImei` helper. Regression coverage passes a decoded
V52 identity through the actual session registry, verifies the literal observed
`rcapture` frame, and keeps mismatched identities and duplicate sessions blocked.
Restart the gateway after pulling this fix; the Flutter app and Firebase
deployment do not need to be restarted or redeployed for this gateway change.

## Command acknowledged, image timed out (25 September)

The first direct Guardian request was created at 12:34:35.792 UTC (16:34 MUT).
Its stored command handoff is 12:34:36.132 UTC, and the gateway recorded the
watch's bare `rcapture` reply. The authorization expired at 12:36:35.792 UTC;
the cleanup sweep saved `state=failed`, `reason=image_timeout` at 12:37:02.773.
`receivedAt`, `sizeBytes` and `validation` are absent. This proves command
delivery and no completed Guardian photo, not that the camera took a photo or
that no partial bytes arrived. Both earlier hands-off capture files still pass
the current production framer and full JPEG decoder offline.

The gateway now collects fixed-size, per-request receive diagnostics in memory
and saves `receiveDiagnostics` with the terminal receive state. It prints
`[safety-snapshot]` JSON summaries at command handoff and terminal receive outcome. No raw
frames, image data, purpose, identity or tokens are included. Packet observation
does not add Firestore writes, send commands, acknowledge images or change the
two-minute deadline or 15-minute cooldown. The selected protocol identity is
frozen for the request, and a changed session identity remains rejected.

After pulling this update, restart only the gateway in its existing configured
PowerShell window. Keep the current app, ngrok and Firebase deployment. Once
the displayed cooldown ends, request **one** photo through the app. Keep the
gateway running through the terminal result (the sweep can take up to another
30 seconds after the two-minute window) and share the `[safety-snapshot]` rows.

| Diagnostic | What it can establish |
| --- | --- |
| `rcaptureReplies` | Exact bare replies on the requested connection; not images. |
| `chunks`, `bytes`, `firstDataAfterMs`, `lastDataAfterMs` | Traffic received during the request window, including ordinary telemetry. |
| `photoHeaderSeen`, `photoFrames` | A recognizable image header or complete framed image candidate reached this connection. Classification does not accept an unverified format. |
| `incompletePhotoBuffered`, `bufferedBytes`, `maxBufferedBytes` | An incomplete image or other bytes remained in the framer. Zero recognized headers alone cannot exclude an unknown transport/format. |
| `acceptedPhotoFrames` | An image entered validation for this request; it is not proof of successful validation/storage. |
| `differentSessionPhotoFrames`, `identityMismatchPhotoFrames`, `expiredPhotoFrames`, `duplicatePhotoFrames` | Images seen but not adopted for the specified reason. A replacement connection is never substituted. |
| `failureStage` | `decode`, `authorize`, `storage` or `publish` if receive processing failed. Null on a timeout does not indicate a storage fault. |

These diagnostics are absent on older requests and after a gateway restart
loses its in-memory observer; absence must not be interpreted as zero traffic.
The original timed-out request cannot be diagnosed retroactively from these
counters. Direct Guardian photo display/deletion is still unverified.

The next instrumented trial (around 16:55 MUT) also timed out. Its summary
records exactly two chunks / 63 bytes / two complete frames, one bare
`rcapture` reply after 1.005 seconds, and the last traffic after 65.110 seconds.
All image-header/frame/acceptance/rejection counters and buffered-byte counts
are zero; no identity change is observed. Therefore no recognizable image or
partial buffered upload reached this request's TCP connection. No decode or
storage failure is implicated by this attempt. This does not prove whether the
watch's camera fired or whether firmware attempted another transport.

The successful reference session used the same exact capture command. Its
connection setup additionally included `CR` (then frequent location reports),
`PEDO,1`, and `WALKTIME`, and replied to `LK` with prefix `3G`; Guardian currently
replies to `LK` with `SG`. These are observed differences, not proven capture
prerequisites. Do not change heartbeat framing or replay configuration commands
speculatively.

At 17:10 MUT the operator confirmed that the watch was asleep and untouched.
Remote capture from that state is the intended requirement; manually waking it
or using its camera is not an acceptance solution. The earlier successful
reference session's screen state remains unknown, so sleep dependence is not
proven. The next isolated trial can use the existing strict-admin `CR` endpoint
once (the same temporary GPS-reporting command observed before the reference
photos), then one explicitly confirmed app capture within the reporting burst.
Leave the watch untouched, retain the normal cooldown and record the resulting
receive diagnostics. This tests one known preparation difference; `CR` is not
claimed to wake or enable the camera. An uncertain CR handoff must not be retried.

## Sleeping-watch upload after the CR comparison (17:15 MUT)

The operator sent one protected `CR`; the gateway logged its exact `SG` frame,
a bare reply and fresh location/radio reports. The subsequent app request
`38e8cae9-0c62-446b-97a2-92b8bbfbf5a1` received one image frame on the authorized
session: first recognized image header at +6.762 seconds, last data at +6.962
seconds, 6 chunks / 4562 total bytes / 4 complete frames. The total byte count
includes telemetry and is **not** the image size. `acceptedPhotoFrames=1` and
`failureStage=decode`; no image reached storage. No session/identity/expiry
rejection is recorded. This establishes image-frame arrival during an untouched
remote trial following `CR`, not successful JPEG decoding/display or proof that
CR is always required. The app's next-capture time is 17:30 MUT.

The old handler omitted the specific decoder exception and did not retain the
rejected frame. It cannot be recovered from the supplied counters. The next
gateway build adds a fixed `decodeError` code and `decodeDetails` containing only
frame sizes and, for a trailer rejection, JPEG size/dimensions and trailer
length/all-zero status. Third-party exception text and image bytes never enter
these logs. The existing strict decoder is unchanged: metadata alone does not
justify accepting an unobserved format.

For one diagnostic trial, explicitly set an absolute new local path before
starting the gateway in its already-configured PowerShell window:

```powershell
$env:SAFETY_SNAPSHOT_REJECTED_FRAME_FILE = Join-Path $env:TEMP ("guardian-rejected-photo-{0}.jsonl" -f (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
Write-Host "PRIVATE DIAGNOSTIC FILE: $env:SAFETY_SNAPSHOT_REJECTED_FRAME_FILE"
npm start
```

This creates no file until a requested image fails decoding. Current family
access, request state and deadline are rechecked first. At most one rejected
frame (maximum 65,556 bytes before hex encoding) is saved per process, using
exclusive creation and restrictive file mode where supported. Existing files
are never overwritten, even after restart. `rejectedFrameCapture=saved` confirms
the write. Unsolicited, cancelled, revoked or expired requests do not qualify.
The file contains the actual private image frame: share it only for this
diagnosis, keep it outside Git and delete it after investigation. This explicit
local diagnostic file has no automatic expiry; the app's 24-hour private-media
cleanup does not manage it. Remove `SAFETY_SNAPSHOT_REJECTED_FRAME_FILE` and
restart the gateway to disable this diagnostic mode. It sends no command and
does not retry or publish a rejected photo.

After the normal cooldown, repeat the one-CR/one-app-request sequence while
leaving the watch untouched. Supply the diagnostic summary and, if saved, the
private file for offline format inspection. Do not change padding acceptance,
JPEG tolerance, camera commands or cooldown until the new evidence supports it.

## Five-NUL trailer rejection (17:47 MUT)

The operator first confirmed a rendered Guardian photo with receipt time
17:30:24 MUT on 25 September. The repeat request
`78935bfa-ef4c-47c6-a681-1af9f86e9364`, following one CR handoff around 17:47,
reached the same authorized session and returned an image header at +8.914
seconds, with last data at +9.285 seconds. No session/identity/expiry rejection
was recorded. The new diagnostics identify `unsupported_image_trailer`:

| Observed field | Value |
| --- | --- |
| Complete frame / declared payload | 4487 / 4466 bytes |
| Structurally parsed JPEG | 4358 bytes, 240x240 |
| Trailer after parsed JPEG EOI | Five bytes, all zero |
| Diagnostic file | `rejectedFrameCapture=saved` |

This is a decoder compatibility rejection, not an image timeout. At `b233553`
the code accepted this observed five-NUL variant alongside one, two and six, while still
rejecting nonzero/unobserved trailers and requiring full pixel decoding before
private storage. Synthetic regressions reproduce the former rejection and
cover fragmented ingress, exact stored JPEG bytes, authenticated retrieval,
offline extraction and corrupt pixel data. No private frame or image is committed.

### Exact saved-frame replay confirmed (21:38 MUT)

The operator supplied the private file for the same request, with receive time
`2026-09-25T13:48:00.678Z`. Replay confirmed one complete 4487-byte image frame,
no leftover framing bytes, a 4358-byte 240x240 JPEG and exactly five zero bytes
after EOI. The previous decoder reproduced `unsupported_image_trailer`; the
updated production `extractFrames`, `isPhotoFrame` and `decodePhoto` path passed,
including strict full pixel decoding. The extracted image was also visually
verified as a normally rendered room/ceiling view. No network connection,
camera command, cloud import or request-state mutation was performed.

Both [Guardian release gates](https://github.com/vikrav14/guardian/actions/runs/36144194300)
and [Dashboard UI review](https://github.com/vikrav14/guardian/actions/runs/36144194112)
passed at `b233553`; all 1,357 local gateway tests had passed. Update/restart the
Windows gateway to load that fix, then perform one fresh app-confirmed capture.
Repeat app receipt/display and direct Guardian deletion remain acceptance items;
the offline replay must not be counted as a new successful live request.

The following lookup is retained for locating a diagnostic file if needed:

Locate the saved diagnostic file without triggering another watch capture:

```powershell
Get-ChildItem -LiteralPath $env:TEMP -Filter 'guardian-rejected-photo-*.jsonl' |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 3 FullName, Length, LastWriteTime
```

Use the file matching this attempt for offline inspection. Do not re-import an
expired request as a fresh authorized app photo. Leave the ordinary cooldown
and watch routing unchanged. The screen's 18:02 next-request time does not need
to elapse for offline replay.

## Variable zero padding correction (22:08 MUT)

After gateway restart and one CR handoff, request
`988bdfa1-9831-49c8-9af3-aaf5d97ebecd` received an image header at +5.323 seconds
and last data at +5.516 seconds. The 3295-byte frame declared 3274 payload bytes;
structural parsing found a 3227-byte, 240x240 JPEG followed by **eight zero
bytes**. The error was again `unsupported_image_trailer`; no session, identity
or expiry rejection was recorded. Diagnostic capture was disabled, so this
exact frame is unavailable for full pixel replay. It is not an image timeout
and not a new verified app photo.

The earlier one/two/five/six length allowlist was too restrictive. The receiver
now accepts a **zero-only suffix from 0 through 64 bytes** after the EOI found
by JPEG structural parsing. Sixty-four is a local defensive policy cap, not a
vendor-confirmed alignment rule or a claim of 64-byte padding on this watch.
It avoids treating every small variation as a new image format. Bytes within
the JPEG are never trimmed; marker-like bytes inside metadata do not terminate
the image. Exact frame length, identity, escapes, size/dimension limits and
strict full pixel decoding remain required. Nonzero suffixes, concatenated
images, missing EOI, oversized suffixes and corrupt pixels remain rejected.

Regression checks cover all 65 accepted suffix lengths and nonzero bytes at
every position, the 65-byte rejected boundary, offline extraction including
the observed eight-byte form, and fragmented live ingress through full decode,
private storage and authenticated retrieval. Real-photo replay can reconfirm
the retained 17:48 frame; this is distinct from synthetic eight-byte coverage.
Update the gateway and perform one fresh request after its normal cooldown.
No automatic camera/CR sequence, retry or policy bypass is included.

## Boundaries and recovery

- `rcapture` has no verified request identifier. Association is limited to one
  active request, the same TCP connection and a two-minute window. The metadata
  retains `requestCorrelationVerified=false`; the app labels the gateway receipt
  time, not a verified capture timestamp. A manually triggered or delayed photo
  inside that window cannot be distinguished cryptographically.
- Full JPEG decoding is bounded to the observed maximum framed size and a
  1024x1024 dimension ceiling. Images never enter normal telemetry or raw logs.
- Access requires current linked-device membership, service ownership and an
  active Family/Care plan. It is rechecked at capture, receipt and viewing.
- Media has a 24-hour access deadline. Expired/deleted photos are denied
  immediately by the gateway. Physical cleanup runs every 30 seconds while the
  gateway is running and catches up after restart; an offline gateway cannot
  perform physical deletion. Configure an always-running gateway for production.
- A deletion during an upload revokes access immediately and leaves a durable
  cleanup intent. Interrupted media writes have a bounded lease; cleanup retries
  after the lease, storage failure or gateway restart. `Cancel waiting` rejects
  the eventual image; it cannot remotely cancel a command already sent.
- The app uses authenticated bytes in memory, clears them on backgrounding and
  evicts decoded images on disposal. It creates no permanent download link.
- Disabling camera flags prevents new requests. Keep the bucket setting and
  gateway running so deletion/expiry cleanup can continue.

No real photo, private capture, device credential or token is committed. No
watch, Firebase deployment or running Windows process was changed by preparing
this branch. The first live Guardian upload/delete is not claimed until the
operator supplies that result.
