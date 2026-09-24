# V52 photo reference capture

24 September 2026. PR #113 remains draft. This is the QA handoff; the GitHub
Wiki cannot be updated through the available repository connector.

## Latest result — two TCP uploads and gallery success, 25 September MUT / 24 September UTC

Source: operator attachment `Pasted text(6).txt` and the accompanying report:
two photos appeared promptly in AnyTracking; the operator deleted the first
there before requesting/taking the second, which also appeared. The normal
log verifies two request/reply/upload sequences on reference session 1:

| Request UTC, 24 Sep (MUT, 25 Sep) | Reply UTC | Upload UTC | Request-to-upload | TCP payload |
| --- | --- | --- | --- | --- |
| 20:26:47.718 (00:26:47.718) | 20:26:50.162 | 20:26:55.373 | 7.655 s | 6930 bytes, `1B12` |
| 20:30:08.554 (00:30:08.554) | 20:30:09.058 | 20:30:14.275 | 5.721 s | 6590 bytes, `19BE` |

Both requests are the observed exact bare lowercase
`[3G*9705254749*0008*rcapture]`. Reply delays are 2.444 and 0.504 seconds.
Both `img` frame lengths match. The private recorder reports successful
writes for image frames 1 and 2; after the second upload it has six records,
two image frames and 13,678 total raw framed bytes. These payload sizes are
not JPEG sizes. The measured intervals end at recorder receipt, not at gallery
display. The operator's “pretty instantly” describes perceived app timing.

**Established:** two TCP image uploads following reference-service commands,
with both pictures reportedly visible in AnyTracking and an intervening
operator-reported gallery deletion. The normal log begins with a partial line,
contains 37 complete JSON rows, and continues with heartbeat exchange through
20:37:39.974 UTC. It has no recorder-stop or return-to-Guardian evidence.
No server-to-watch `img` ACK is visible in this excerpt.

**Still to confirm:** that both photos were requested only from AnyTracking
with no watch-camera/shutter interaction, plus the actual screen state and any
wearer indication. The preceding instructions asked for an awake clock face
but the result does not explicitly confirm those conditions. Do not classify
this as proven hands-off capture, claim that waking fixed the earlier issue,
or overwrite the earlier manually triggered sample's classification. The
operator also restarted the watch during connection troubleshooting, so this
is not a controlled awake-versus-asleep causal comparison.

Deleting from the reference app establishes an operator-observed UI action,
not hard deletion from its servers or deletion of the separate local private
capture. The new binary capture has not been attached/decoded in this
checkpoint; dimensions, JPEG byte sizes and image content remain unverified
offline for these two uploads. The previous 240x240 decode belongs to a
different, manually triggered sample.

### Connection recovery preceding this result

The original ngrok agent remained reconnecting even though a separate diagnose
connection passed. The operator restarted it and restored the three forwards
from a local endpoint backup: Guardian TCP 10595 to 9000, recorder TCP 17200 to
9002, and the existing WhatsApp HTTPS domain to 9001. The former recorder port
29315 was no longer the current route.

The operator then reported AnyTracking offline despite routing SMS/restart.
A listener check showed 9000 only. The previous recorder's log explicitly ended
at 20:14:36.083 UTC (00:14:36.083 MUT) with `capture_window_ended`.
Thus the missing local recorder explained why the new recorder tunnel could
not forward watch traffic at that point. A fresh recorder was started before
the two uploaded images above. This does not retrospectively diagnose the
earlier connected-but-no-image camera attempts or establish an SMS failure.

### Next work

1. Restore the **current printed** Guardian return route and verify fresh
   telemetry; expiry never restores routing.
2. Confirm the no-watch-camera-interaction condition and actual screen behavior.
3. Retain/inspect the private capture from this successful session. The public
   log alone cannot decode the two images. Do not repeat successful captures
   merely to recover data already saved.
4. Prefer the now-observed `rcapture`/TCP `img` route for the next isolated
   Guardian integration trial. A supplier reply or a new FTP configuration is
   not a prerequisite for developing this path. Exact live parsing, bounded
   private image validation/storage, authorization and honest completion/
   timeout handling still need implementation and testing before the app flow
   can be enabled.

PR #113 remains draft/unmerged. No production camera dispatcher, ingress,
customer flag, FTP setting or Firebase data changed in this checkpoint.
Documentation-only update; no new test run. Earlier software test results
remain separate from this hardware evidence.

---

## Earlier investigation plan — 24 September 2026

The operator reports that Jett and colleagues are on holiday and asks to
continue independently. Supplier availability is **not a prerequisite for the
TCP investigation**. No new hardware result is recorded by this update.

The existing pass-through recorder and offline decoder are sufficient for the
next experiment. Their 33 focused tests passed again; no runtime code, watch
command sender, FTP setting, Firebase record or customer flag changed.

### What the independent source check adds

Another manufacturer's published
[Beesure/SeTracker protocol](https://www.4p-touch.com/beesure-gps-setracker-server-protocol.html),
section “Remote Snapshot Command”, describes the same lowercase bare
`rcapture` request and `img,x,y,z` upload; it labels x=5 as remote snapshot.
This is supporting protocol-family evidence, **not Jesh firmware acceptance**.
The exact request was already observed from AnyTracking.

Jesh's manually triggered sample also used x=5. The external definition must
not override the operator's observation, prove a remote trigger, or resolve
whether an earlier request was pending. Keep this field opaque for acceptance.
No newly verified wake command, extra parameter, missing ACK or FTP prerequisite
was found. The local supplied sections 37–39 describe the separate PIC/FTP
candidate, not an established requirement for rcapture.

### Trial A — ordinary clock face, awake

This controls a missing observation in the 22:23 test. It does not assume an
awake screen is required or promise that it will fix the camera.

1. Use the Windows setup and recorder command below. Keep the ordinary gateway
   and ngrok running. Read the **current** tunnel addresses; do not reuse a
   historical port. Stop an old recorder in its own window if 9002 is occupied.
2. After `relay_listening`, send the printed recorder-routing SMS. Wait for
   `reference_connected`, fresh watch traffic and AnyTracking online.
   Guardian telemetry is temporarily diverted during this comparison.
3. With no active call, return the watch to its ordinary clock face, with the
   camera/gallery closed. Wake the screen and aim the camera at a distinct
   stationary object. Note local time, displayed battery, charger connection
   and screen state. Do not change other settings.
4. Tap **Photo → OK once** in AnyTracking while the clock screen is awake.
   Leave watch controls untouched for two minutes. Record any camera view,
   confirmation prompt, shutter sound or screen change. Do not respond to a
   prompt during this hands-off observation; describe it first. If the screen
   times out naturally, record that rather than repeatedly waking it.
5. Preserve the request, reply, image and heartbeat rows. The observation window
   starts at the logged server-to-watch `rcapture`, not the app's Success toast.
   A missing request means this was not an executed camera-command trial.
6. If an image arrives, stop further requests. Decode it with the existing
   offline tool and check that it shows the intended new scene. A saved frame,
   bare reply or app Success alone does not establish complete remote capture.
7. Restore the printed Guardian route and verify newly received telemetry.
   Recorder exit/expiry does not restore routing. Keep the capture and normal
   log separate; the private file contains the actual image.

### Decision after Trial A

| Observation | Next conclusion/action |
| --- | --- |
| One request, no manual interaction, complete new image | Candidate remote-only success; validate the scene, image and timing before integrating Guardian |
| Valid new image in capture, Pictures empty | Investigate reference gallery/indexing separately; empty gallery alone is not a capture failure |
| Reply, no image, but camera/prompt appears | Preserve exact visible behavior; this may require wearer interaction, which must be tested and described separately |
| Reply and continuing traffic, no image or prompt | Trial B can test transient watch state |
| No request, reconnect, observer error, limit, or incomplete evidence | Fix/resolve that observation gap before attributing failure to the camera |

An image timestamp near a request is not an authenticated request identifier.
Late uploads remain potentially ambiguous. Keep the previous manual sample
classified as manually triggered.

### Trial B — normal watch restart, only after Trial A fails

Use the watch's ordinary local power-off/on controls; **not factory reset** and
not an invented remote reset command. This is a separate tabletop trial while
the recorder is running. Wait for a new reference session, fresh telemetry and
AnyTracking online. Keep the scene, charging state and clock-awake procedure the
same, then make exactly one new app request and observe hands-off for two
minutes. Record the reboot and new request times.

A success only after restarting suggests a transient device-state dependency;
it does not identify the root cause or prove reliability. Do not repeat requests
indefinitely. If two clean trials still show only acknowledgements, preserve
their logs and screen observations for the next analysis.

A later local-camera control must be labelled separately and aimed at a
different scene. A photo manually taken after a failed remote request might
still satisfy pending firmware state; it cannot retroactively validate the
remote request or establish type-5 semantics.

### FTP remains a separate investigation

Continue inspecting available documentation and owned-device evidence for FTP
readback/restoration; no supplier reply is inherently required if those facts
can be established independently. The laptop/public probe is already complete.
Changing saved FTP settings with an unknown baseline is unnecessary for these
TCP trials. Do not run PIC against an unknown saved destination, guess a
readback/reset command, or infer that restoring ordinary IP routing restores
FTP settings.

---

## Observed on Jesh

Device IMEI `861397052547492`, protocol ID `9705254749`. The operator requested
photos in AnyTracking and initially saw Success but an empty Pictures page.
Three earlier requests (16:51:41, 16:53:33 and 16:53:51 UTC) had bare replies
without an image frame in the supplied excerpt. Do not diagnose those as
camera failure or prove an upload failure from an incomplete redacted log.

After a reconnect, the following was captured through the existing recorder:

| UTC on 24 September | Direction | Observation |
| --- | --- | --- |
| 17:00:33.295 | relay | Reference session 2 connected |
| 17:00:35.133 | server to watch | `3G`, `0008`, lowercase `rcapture`, no arguments |
| 17:00:35.456 | watch to server | Bare `rcapture` reply, 323 ms after request |
| 17:00:40.197 | watch to server | `img`, `0BFA`, 3066 payload bytes, length matches |
| 17:01:23.240 | server to watch | Second lowercase `rcapture` request |
| 17:01:24.322 | watch to server | Bare `rcapture` reply, 1082 ms after request |
| 17:01:29.297 | watch to server | `img`, `1763`, 5987 payload bytes, length matches |

The operator then reported: photos appeared in AnyTracking and the watch was
switched back using `ip,0.tcp.in.ngrok.io,10595#`. Fresh Guardian telemetry
after that SMS was not supplied. The successful exchanges occurred through
the recorder; they do not establish a direct-only routing requirement.

The exact request reconstructed from the complete logged header/body metadata is
`[3G*9705254749*0008*rcapture]`. Both upload frames use prefix `3G` and lowercase
`img`. Request-to-upload delays were 5.064 and 6.057 seconds. The payload sizes
include protocol content; do not call them JPEG sizes or estimate resolution.
The recorder's `argumentCount: 3` is a comma count across the entire payload,
not proof of three header fields when the image encoding is not known.

This is a successful reference-service pilot, not a working Guardian photo UI.
The supplied document's `PIC,1` / FTP example describes a different path; no
FTP setup or new credentials are required to explain these observed TCP uploads.

## Private sample decoded — 24 September follow-up

The supplied `guardian-photo-private-20260924-213300-938.jsonl` contains seven
records: three `rcapture` requests with bare replies, and one `img` upload at
17:39:27.835Z (21:39:27 MUT). It was saved with `failed:false` and `limited:false`.
The operator reported Success but an empty AnyTracking Pictures page in this
attempt. Do not replace that report with a gallery-success claim.

| Field | Observed value |
| --- | --- |
| Frame/payload sizes | 5088 / 5067 bytes |
| ASCII envelope | `img,5,260924213927,` (19 bytes) |
| Escaped media length | 5048 bytes, including trailing bytes |
| Escape pairs | 77 total, all from the documented five mappings |
| Decoded JPEG | 4969 bytes, baseline JPEG, 240x240, three components |
| Bytes after JPEG EOI | Two NUL bytes (`0000`); meaning unknown |
| Decoder validation | Pillow verify + full load + visual inspection succeeded |

The supplier protocol's PHBX picture and AMR sections document these escapes:
`7D 01 -> 7D`, `7D 02 -> 5B`, `7D 03 -> 5D`, `7D 04 -> 2C`,
`7D 05 -> 2A`. Applying that existing mapping to this `img` body restores the
photo. Directly treating the escaped bytes as JPEG can produce a partially
decoded/corrupt-looking preview even if the image library accepts it; SOI/EOI
markers and dimensions alone were not enough to establish correct decoding.

Preserve `5` as an opaque field, not a photo count, fragment index, mode or
remote/manual indicator. The timestamp text matches local wall time under a
YYMMDDhhmmss interpretation in this sample, but timezone semantics are not
established. Keep the original string. The packet has no proven request ID.
The preceding request was at 17:36:02.378Z, 205.457 seconds earlier; the first
request was at 17:33:36.147Z. The third request at 17:44:22.890Z has no later
image in the capture.

**Operator correction, 24 September:** the recovered image came from accidentally
pressing the camera button on the watch. Classify this sample as a locally
triggered photo upload. The 205.457-second interval is not remote-capture latency
and must not be attributed to an AnyTracking request. It validates the upload
format and offline decoder, not remote-only capture. This correction applies to
the 17:39:27 sample; it does not determine how the earlier 17:00/17:01 photos
were triggered.

Next controlled test: with the recorder connected, aim the watch at a distinct
stationary object and leave its controls untouched. Press Photo in AnyTracking
once and note the time. Wait up to 60 seconds for an `img` upload and check the
new scene in Pictures. This is a bounded observation window, not a promised
device timeout. Record any later upload separately; if none arrives, preserve
the request/reply evidence without using the watch camera or repeating Photo
within the same trial. Local-camera and remote-only tests must stay separate.

This proves a decodable image traveled through the relay to the reference
server. It does not explain an empty AnyTracking gallery, prove indexing or
display, or demonstrate a production Guardian receiver. No `img` ACK appears
in the supplied ordinary excerpt; do not manufacture one. The original private
file and real photo stay outside Git; tests use a generated gradient image.

## Controlled app request — 22:23 MUT, 24 September

The operator ran the app-only follow-up, reported waiting two minutes, and
reported no picture in AnyTracking. The supplied excerpt contains:

| Time UTC (MUT is UTC+4) | Evidence |
| --- | --- |
| 18:23:11.840 | Reference TCP connection established, session 1 |
| 18:23:22.676 | Server sent exact `[3G*9705254749*0008*rcapture]` |
| 18:23:23.352 | Watch returned bare `rcapture`, 676 ms after the request |
| 18:25:15.107 / .560 | Watch heartbeat and server reply continued |

No `img`, observation failure or disconnection appears in this excerpt. The
private recorder reported two records, zero image frames and 58 raw bytes at
the command/reply exchange. The excerpt ends 112.884 seconds after the request;
it cannot establish what happened after its last row or on another transport.
Result: command/reply exchange observed, remote photo/upload not observed.
There is no image in these supplied rows for the offline decoder to recover.

The successful local-camera upload remains separate evidence. The remote
request matches the reference service's captured syntax, including case,
prefix and length. The relay forwards buffers unchanged; no formatting change,
FTP provisioning or invented ACK is justified by this result. The provided
vendor document describes `PIC,1`/FTP but supplies no proven missing step for
this observed `rcapture` exchange. The watch's screen/camera state at the
request was not recorded; firmware support, camera state and upload behavior
remain possible causes, not established diagnoses.

Next single-variable check: wake the watch to the ordinary clock face and
close any camera/gallery screen, without taking a local photo. While the
recorder is connected, request Photo once in AnyTracking and leave the watch
controls untouched. Note whether its screen opens the camera, shows a prompt,
makes a shutter sound, or stays unchanged; record its screen state when the
request arrives. Observe for up to two minutes without another request and
check for `img`. Screen-awake dependence is a hypothesis, not a documented
requirement. Restore the printed Guardian route when finished and verify fresh
telemetry; do not restart tunnels merely because this photo attempt failed.

## Documented alternative: PIC with FTP

The operator highlighted supplier protocol sections 37–39 again after the
22:23 app-only attempt. They specify a separate server-requested photo route:
configure `FTPIP,<address>,<port>` and `FTPPWD,<user>,<password>`, then send
`PIC,1`. The documented reply includes the picture name and the image is
transferred to FTP. The stated filename is `ID_yyyyMMddHHmmss.JPG` using GMT.
This remains a useful documented test candidate on the V52; it has not been
physically accepted on Jesh. It does not establish an FTP prerequisite for
`rcapture`, or explain that command's missing upload.

A meaningful comparison needs a controlled FTP receiver, its own credentials,
reachable FTP control/data connections, and an upload log before requesting
the picture. The TCP relay does not capture a separate FTP transfer. Capture
the configuration replies and `PIC` response separately from the actual file;
only a received, decoded new scene demonstrates completion. The supplied
`FTPPWD` example names its reply `FTPSWD`; retain this discrepancy until the
device's actual response is observed. Do not silently normalize it or conclude
a timeout from the request name alone. The example host/account/password are
not Guardian configuration and must not be used as a destination or login.

No FTP endpoint, credentials or watch setting has been changed. Saved FTP
settings and their restoration need to be established before a live trial;
the provided excerpt contains no read-back/reset command for them. This
alternative does not change the validity of the decoded local-camera TCP img.

## Offline decoder

`gateway/scripts/decode-photo-capture.js` uses the new bounded parser in
`gateway/src/protocol/v52-photo.js`. It validates selected identity, exact frame
length, the observed envelope, escapes, baseline JPEG marker structure and
the observed two-NUL trailer. It fails on unsupported/malformed forms, rather
than guessing fragment assembly or truncating arbitrary data. It does not
validate entropy-coded pixels; full decoding remains required before a live
receiver accepts a photo. No production runtime imports this module yet.

From the isolated photo checkout, inspect without creating image files:

```powershell
node scripts/decode-photo-capture.js `
    --protocol-id 9705254749 `
    --capture-file "$env:TEMP\guardian-photo-private-20260924-213300-938.jsonl"
```

To extract into a new private local directory, add:

```powershell
--output-dir "$env:TEMP\guardian-photo-decoded-20260924"
```

The output directory must not already exist. The script writes `photo-01.jpg`
and prints metadata only. It generates no network calls, captures or ACKs.
Retain/delete the local photo using the same handling as the private capture.

## Optional further private captures

Normal logs intentionally redact `img`, so they cannot reconstruct or decode
the photo. The opt-in `--private-photo-file` records only bare `rcapture` in
either direction and `img` from the selected watch. CONFIG, phonebook, ICCID,
coordinates and FTP credentials are excluded. It stores exact bytes as hex in
a new local JSONL file, refuses overwrite/symlinks, and requests mode 0600 on
POSIX. Windows folder ACLs still apply: use your own private temporary folder.
Limits are 16 recorded frames, 8 image frames, 512 KiB of raw framed bytes and
the existing maximum 20-minute relay window. Limits or write failures stop file
capture, while relay forwarding continues. A file may hold partial evidence;
check the saved-frame statuses before interpreting it.

The script does not send `rcapture`, invent an `img` ACK, decode image data,
change routing, load gateway credentials, or write to Firestore/Storage. The
operator requests one tabletop/object photo through their own AnyTracking app.
Keep the private file out of Git and ordinary shared logs. It contains the
actual image; attach it for analysis only for the intended test subject, then
delete the local copy after the format investigation. Local capture has no
automatic retention process.

## Windows setup without switching the running app's branch

Keep the existing gateway and ngrok running. In a separate PowerShell window:

```powershell
cd C:\Users\MSI\repos\guardian
git fetch origin feat/v52-remote-photo
if ($LASTEXITCODE -ne 0) { throw 'Fetch failed.' }
$guardianPhotoTools = Join-Path $env:TEMP ("guardian-photo-tools-{0}" -f (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
git worktree add --detach $guardianPhotoTools origin/feat/v52-remote-photo
if ($LASTEXITCODE -ne 0) { throw 'Worktree creation failed.' }
Set-Location (Join-Path $guardianPhotoTools 'gateway')
```

The standalone scripts need Node only, with no npm install or gateway restart.
Stop an old recorder in its own window before starting another. Confirm ngrok
says online and read the current endpoint table; historical ports 12198, 18440,
29315, 26925 and 10595 are not stable configuration.

```powershell
& {
    $ErrorActionPreference = 'Stop'
    $guardianEndpoints = (Invoke-RestMethod http://127.0.0.1:4040/api/endpoints).endpoints
    $guardianReturn = @($guardianEndpoints | Where-Object { $_.name -eq 'command_line' })
    $guardianCapture = @($guardianEndpoints | Where-Object { $_.name -eq 'guardian-answer-capture' })
    if ($guardianReturn.Count -ne 1 -or $guardianCapture.Count -ne 1) { throw 'Both existing TCP tunnels are required.' }
    if ($guardianReturn[0].upstream.url -notmatch '^(?:localhost|127\.0\.0\.1):9000$' -or
        $guardianCapture[0].upstream.url -notmatch '^(?:localhost|127\.0\.0\.1):9002$') { throw 'Unexpected tunnel forwarding.' }
    $guardianReturnUri = [uri]$guardianReturn[0].url
    $guardianCaptureUri = [uri]$guardianCapture[0].url
    if ($guardianReturnUri.Scheme -ne 'tcp' -or $guardianCaptureUri.Scheme -ne 'tcp') { throw 'Both routes must be TCP.' }
    if (Get-NetTCPConnection -State Listen -LocalPort 9002 -ErrorAction SilentlyContinue) { throw 'Stop the old recorder in its window first.' }
    $guardianStamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $guardianPrivate = Join-Path $env:TEMP "guardian-photo-private-$guardianStamp.jsonl"
    $guardianLog = Join-Path $env:TEMP "guardian-photo-$guardianStamp.log"
    Write-Host "TO RECORDER SMS: ip,$($guardianCaptureUri.Host),$($guardianCaptureUri.Port)#"
    Write-Host "RETURN SMS: ip,$($guardianReturnUri.Host),$($guardianReturnUri.Port)#"
    Write-Host "PRIVATE PHOTO FILE: $guardianPrivate"
    Write-Host "NORMAL LOG: $guardianLog"
    node scripts/capture-reference-answer-mode.js `
        --protocol-id 9705254749 --listen-port 9002 `
        --guardian-return-host $guardianReturnUri.Host `
        --guardian-return-port $guardianReturnUri.Port `
        --private-photo-file $guardianPrivate `
        --minutes 15 --run | Tee-Object -FilePath $guardianLog
}
```

After `relay_listening`, send the printed recorder SMS to the watch SIM. Wait
for reference traffic and AnyTracking online. Request one photo of a tabletop
object. Expect a `private_photo_capture` saved row for `img`, and check that
AnyTracking displays that new scene. Record screen/sound indication and time.
Return with the printed Guardian SMS before expiry, then confirm fresh gateway
traffic. Stopping the recorder never restores routing automatically. Attach the
private JSONL file for format analysis, rather than pasting a long hex dump.

## Verification and remaining implementation

For the separately documented `PIC,1`/FTP candidate, PR #113 now includes
a standalone FTP receiver, real local transfer self-test and explicit private
Firebase import/delete pilot. Start with the read-only readiness workflow in
[photo-ftp-trial.md](photo-ftp-trial.md). It needs no routing SMS, does not
replace this recorder, and does not make remote capture proven. That runbook
records the current combined 43-test result and the remaining live checks.

33 focused Node tests pass: existing transparent relay/answer capture,
private-photo capture, and the offline decoder. Coverage includes all five
escapes, embedded delimiter/EOI bytes, frame identity/length, malformed JPEG
segments, bounded dimensions/trailers, file limits, redaction and no overwrite.
Tests use a generated 32x24 gradient with synthetic metadata. Separately, the
real supplied sample was decoded and visually verified as described above.

The 22:23 MUT app-only follow-up produced a reply but no image in the supplied
window. Next compare with the watch awake on its normal clock screen, then
obtain and decode an actual app-only upload; the decoded private sample above
was locally triggered. Confirm remote-only request correlation and further samples before any
fragment assembly/ACK behavior is inferred. Then connect single authorized requests
to private storage/view/delete and the Flutter UI. Keep customer flags and
Guardian dispatch disabled until that path works. Wearer indication, real
image format/dimensions, fresh-image correlation, reconnect/reboot handling,
retention/deletion and a second production watch remain acceptance items.
