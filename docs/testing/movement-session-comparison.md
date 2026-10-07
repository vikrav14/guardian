# Movement reminder connection comparison

## Why this is the next check

On 29 September 2026 the operator reported a sound and the watch text
"Sedentary reminder: do some exercise" after enabling Open / 20 with the
physical watch's Save. They then saved Close / 0 locally and confirmed that it
persisted after reopening. That establishes one local reminder and cleanup.
It does not establish reliable remote enable or remote timed execution.

The audited Guardian On frame already matches the AnyTracking On capture:
`[3G*9705254749*000e*SEDENTARY,1,20]`. Both have received bare replies even in
trials with no observed reminder. The next check compares the surrounding
connection exchanges, not another blind 20-minute wait or guessed command.

Source review found some Guardian startup acknowledgements use `SG`, while the
captured AnyTracking `CONFIG,1`, ICCID and LK responses use `3G`. AnyTracking also
uses `SG` for TKQ/CR in the supplied captures. These are differences to measure,
not a demonstrated cause. Do not change framing globally based on them.

## Recorder contract

`gateway/scripts/capture-movement-session.js` is standalone and imports only
Node builtins. It does not load credentials, write Firestore, change the app,
deploy, or generate watch commands. It forwards the original bytes with stream
backpressure. It adds a relay hop, so it is not a zero-latency timing experiment.

| Backend | Fixed destination | Guardian telemetry |
| --- | --- | --- |
| `guardian` | `127.0.0.1:9000` | Forwarded to the existing gateway |
| `anytracking` | `a.igps123.com:7720` | Paused while supplier routing is selected |

The same implementation handles both backends. The initial device header must
match the specified 10-digit protocol ID before any upstream connection opens.
It listens on loopback only; the usual recorder tunnel targets port 9002.
An identity change later in a session is logged as redacted and forwarding
continues unchanged. This diagnostic is not an authentication proxy.

The JSONL records frame direction, command, prefix, length and argument count.
Exact frames/hex are limited to the following safe controls: bare
acknowledgements/replies (`LK`, `TKQ`, `ICCID`, `RYIMEI`, `CR`, `SEDENTARY`,
`SEDENTARYWORKTIME`), `CONFIG,1`, and server-to-watch SEDENTARY On/Off with 20 or
26 minutes and one valid WORKTIME range followed by `,-`. Other arguments,
including uploaded configuration, contacts, location and binary photos, are
redacted. This is frame metadata plus a control subset, not a raw packet dump.
The file still includes the protocol ID and timestamps; share it privately.

Preview is the default: no file or listener opens until `--run`. Output must be
a new absolute path; existing files and symlinks are refused. Capture lasts
1-20 minutes (default 10), with bounded buffers/connections and 2,000 normal log
rows. A limit, malformed/partial frame or disk failure prevents a complete
capture claim. A disk/observer failure does not generate or modify traffic.
`captureComplete` concerns the observed frames, never applied watch state.

**Expiry/Ctrl+C closes the relay; it does not restore the watch route or turn
reminders off.** Restore the verified current Guardian route before expiry,
check fresh Guardian packets, and perform the agreed physical Off cleanup.

## Prepare without restarting the working gateway or app

Keep the original Guardian gateway, Flutter app and ngrok running. Leave the
watch locally closed while preparing. Do not switch branches, copy `.env`, use
the temporary framing preload, or run plain `npm start` in an unconfigured
worktree for this recorder.

In a spare PowerShell window, fetch and extract only this standalone script:

```powershell
$ErrorActionPreference = 'Stop'
$movementRepo = 'C:\Users\MSI\repos\guardian'
git -C $movementRepo fetch origin feat/v52-care-reminders
if ($LASTEXITCODE -ne 0) { throw 'Fetch failed. Stop here.' }
$movementSource = @(git -C $movementRepo show 'origin/feat/v52-care-reminders:gateway/scripts/capture-movement-session.js')
if ($LASTEXITCODE -ne 0) { throw 'Recorder extraction failed. Stop here.' }
$movementFolder = Join-Path ([IO.Path]::GetTempPath()) ('guardian-movement-session-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $movementFolder | Out-Null
$movementScript = Join-Path $movementFolder 'capture-movement-session.js'
[IO.File]::WriteAllLines($movementScript, $movementSource, [Text.UTF8Encoding]::new($false))
```

Discover current tunnels; never reuse an old recorder or return SMS merely
because it appears in historical logs. The old recorder endpoint previously
stopped accepting TCP despite remaining listed in the local ngrok API.

```powershell
$movementEndpoints = (Invoke-RestMethod 'http://127.0.0.1:4040/api/endpoints').endpoints
$movementGuardian = @($movementEndpoints | Where-Object {
    $_.url -like 'tcp://*' -and
    $_.upstream.url -match '^(?:(?:tcp|https?)://)?(?:localhost|127\.0\.0\.1):9000/?$'
})
$movementRecorder = @($movementEndpoints | Where-Object {
    $_.url -like 'tcp://*' -and
    $_.upstream.url -match '^(?:(?:tcp|https?)://)?(?:localhost|127\.0\.0\.1):9002/?$'
})
if ($movementGuardian.Count -ne 1 -or $movementRecorder.Count -ne 1) {
    throw 'Expected one Guardian TCP tunnel to 9000 and one recorder tunnel to 9002. Share the endpoint list.'
}
if (-not (Get-NetTCPConnection -State Listen -LocalPort 9000 -ErrorAction SilentlyContinue)) {
    throw 'Guardian is not listening on 9000. Keep the configured gateway running first.'
}
if (Get-NetTCPConnection -State Listen -LocalPort 9002 -ErrorAction SilentlyContinue) {
    throw 'Port 9002 is already occupied. Identify the recorder before starting another.'
}
$movementReturn = [uri]$movementGuardian[0].url
$movementRoute = [uri]$movementRecorder[0].url
if (-not (Test-NetConnection -ComputerName $movementReturn.Host -Port $movementReturn.Port -InformationLevel Quiet)) {
    throw 'The Guardian return tunnel is unreachable. Do not change watch routing.'
}
Write-Host "RETURN SMS: ip,$($movementReturn.Host),$($movementReturn.Port)#"
Write-Host "RECORDER SMS (only after listener and reachability checks): ip,$($movementRoute.Host),$($movementRoute.Port)#"
$movementCapture = Join-Path $movementFolder 'guardian.jsonl'
$movementArgs = @('--backend', 'guardian', '--protocol-id', '9705254749',
    '--return-url', $movementReturn.AbsoluteUri, '--output', $movementCapture,
    '--listen-port', '9002', '--minutes', '10')
node $movementScript @movementArgs
if ($LASTEXITCODE -ne 0) { throw 'Preview failed. Do not reroute.' }
```

This preview prints the verified-by-operator return destination but deliberately
retains `returnRouteVerified: false`: the recorder itself has no live device
readback or SMS confirmation. A TCP connectivity check is not device restoration.

## First capture: Guardian through the recorder

1. In the same spare window run `node $movementScript @movementArgs --run`.
   Wait for `relay_listening`. Save the displayed return SMS and file path.
2. In another PowerShell window test the current recorder URL's host/port with
   `Test-NetConnection`. Require `TcpTestSucceeded: True` before sending its SMS
   to the SIM. A connectivity probe sends no V52 identity and is closed by the
   recorder after 10 seconds; that is not a watch connection.
3. Send the current recorder SMS to the device. Wait for `upstream_connected`
   **and fresh identified watch traffic at Guardian**. The relay is forwarding
   to the existing Guardian gateway in this phase, not to AnyTracking.
4. Record the physical menu without pressing the watch's Save. Use a fresh
   active window containing the current Mauritius time; the earlier
   15:10-16:30 window has expired. Save hours once, then On once using Guardian's
   separate controls. Note each action's exact time and the physical menu
   immediately and after reopening. Do not keep resending or start a timed
   acceptance wait here. Keep local Save untouched during this remote check.
5. Save Off once in Guardian and record the physical result. If the watch is
   still enabled or the outcome is unclear, use its physical Close / 0 Save
   for cleanup and distinguish that local action in the notes.
6. Before the 10-minute expiry, send the verified Guardian return SMS. Confirm
   fresh Guardian traffic, then Ctrl+C the recorder. Share `guardian.jsonl`
   privately with the action times and physical observations. A success toast
   or bare watch reply alone remains transport evidence.

Review this file before another reroute. If the capture is incomplete, identify
the missing segment instead of treating it as proof that a command was absent.

## Second capture, only if the comparison still needs it

Use the same recorder with `--backend anytracking`, a new `anytracking.jsonl`,
and the freshly verified return route. Keep the same watch and comparable
active hours/interval; note any changed setting rather than hiding it. Repeat
only the agreed app actions through Health → Sedentary (upper Save for On/Off,
lower Save for hours), with the same action order as the Guardian check.
Guardian telemetry is paused during this phase. This is an operator-controlled
comparison with the existing app, not supplier contact.

Restore Guardian and physically close the setting before ending. Compare
startup ACKs, additional setting commands, exact reminder bytes, replies and
connection resets. If an actionable difference is found, change one bounded
path and recheck setting application before scheduling a fresh timed trial.
Do not mark remote reminders accepted from recorder tests or a local baseline.

## Software checks

Run `node --test test/movement-session-capture.test.js` from `gateway`.
The tests use synthetic loopback peers only: preview/no dependencies, CLI
bounds, privacy redaction, binary/fragmented framing, exact bidirectional
forwarding, no generated ACKs/settings, identity rejection, short/disk-failed
writes, observation loss, row bounds, concurrent stop and timed shutdown.
They do not connect to the device, ngrok or AnyTracking.
