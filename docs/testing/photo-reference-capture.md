# V52 photo reference capture

24 September 2026. PR #113 remains draft. This is the QA handoff; the GitHub
Wiki cannot be updated through the available repository connector.

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
FTP setup or new credentials are justified by these observed uploads.

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

### Offline decoder

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

33 focused Node tests pass: existing transparent relay/answer capture,
private-photo capture, and the offline decoder. Coverage includes all five
escapes, embedded delimiter/EOI bytes, frame identity/length, malformed JPEG
segments, bounded dimensions/trailers, file limits, redaction and no overwrite.
Tests use a generated 32x24 gradient with synthetic metadata. Separately, the
real supplied sample was decoded and visually verified as described above.

Next obtain and decode a controlled app-only sample; the decoded private sample
above was locally triggered. Confirm remote-only request correlation and further samples before any
fragment assembly/ACK behavior is inferred. Then connect single authorized requests
to private storage/view/delete and the Flutter UI. Keep customer flags and
Guardian dispatch disabled until that path works. Wearer indication, real
image format/dimensions, fresh-image correlation, reconnect/reboot handling,
retention/deletion and a second production watch remain acceptance items.
