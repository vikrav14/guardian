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

## Next: collect one exact image frame locally

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

25 focused Node tests pass: existing transparent relay/answer capture and new
private-photo tests, including binary delimiters, fragmented frames, identity
filtering, redaction, file/byte limits, short writes and disk failure. Synthetic
image test bytes do not establish the V52 image encoding. No physical photo
payload has yet been collected by this new option.

Next use that exact payload to define a validated `img` parser and any fragment
assembly/ACK behavior from evidence. Then connect single authorized requests
to private storage/view/delete and the Flutter UI. Keep customer flags and
Guardian dispatch disabled until that path works. Wearer indication, real
image format/dimensions, fresh-image correlation, reconnect/reboot handling,
retention/deletion and a second production watch remain acceptance items.
