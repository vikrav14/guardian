# Identify a phonebook slot through the existing AnyTracking recorder

23 September 2026. The operator proposed repeating the successful same-watch
reference capture for phonebook entries. The standalone relay now includes
`phonebookSlot` on complete supplier-to-watch PHBX entry writes. It still
redacts the name, phone and picture, and forwards the original bytes unchanged.
The optional private answer file deliberately excludes PHBX; no private file
is needed for this slot check. This page is the repository QA handoff; a Wiki
mirror cannot be updated through the available connector.

## What this can establish

Saving a known contact in AnyTracking while the recorder is connected can
identify that contact's serial from the PHBX downlink. Note the contact and save
time locally, then match the logged serial and check the entry on the watch.
A bare PHBX response is receipt only. No downlink means the action did not
produce an observed write; an unchanged save may be optimized away by the app.

The manual documents 15 contacts, but a captured write is not a list of all
occupied or free entries. Adding a new contact reveals the slot used for that
addition; it becomes occupied. Do not later import it as an empty slot or infer
the remaining slots from one or two writes. If Guardian's managed inventory
has already been configured, do not edit it through AnyTracking; reconcile the
inventory first. This reference procedure is for the existing unimported pilot.

## Windows procedure

Keep Guardian and ngrok running. Use another PowerShell window. The existing
capture endpoint must still forward to port 9002; read fresh addresses rather
than reusing the old SMS. Stop a previous recorder in its own terminal before
starting a new one; do not stop the gateway listener on 9000/9001.

```powershell
cd C:\Users\MSI\repos\guardian
git pull --ff-only origin feat/v52-watch-modes
cd gateway

& {
    $ErrorActionPreference = 'Stop'
    $guardianEndpoints = (Invoke-RestMethod http://127.0.0.1:4040/api/endpoints).endpoints
    $guardianReturn = @($guardianEndpoints | Where-Object { $_.name -eq 'command_line' })
    $guardianCapture = @($guardianEndpoints | Where-Object { $_.name -eq 'guardian-answer-capture' })
    if ($guardianReturn.Count -ne 1 -or $guardianCapture.Count -ne 1) {
        throw 'Both existing Guardian and capture tunnels are needed. Show the endpoint table before continuing.'
    }
    if ($guardianReturn[0].upstream.url -notmatch '^(?:localhost|127\.0\.0\.1):9000$' -or
        $guardianCapture[0].upstream.url -notmatch '^(?:localhost|127\.0\.0\.1):9002$') {
        throw 'Unexpected tunnel forwarding. Check the endpoint table before changing watch routing.'
    }
    $guardianReturnUri = [uri]$guardianReturn[0].url
    $guardianCaptureUri = [uri]$guardianCapture[0].url
    if ($guardianReturnUri.Scheme -ne 'tcp' -or $guardianCaptureUri.Scheme -ne 'tcp') {
        throw 'Both watch routes must be TCP endpoints.'
    }
    if (Get-NetTCPConnection -State Listen -LocalPort 9002 -ErrorAction SilentlyContinue) {
        throw 'A recorder already owns port 9002. Stop that recorder in its own window first.'
    }
    foreach ($guardianUri in @($guardianReturnUri, $guardianCaptureUri)) {
        if (-not (Test-NetConnection -ComputerName $guardianUri.Host -Port $guardianUri.Port -InformationLevel Quiet)) {
            throw "Public tunnel unreachable: $guardianUri. Keep the watch on Guardian until the tunnel is repaired."
        }
    }
    $guardianLog = Join-Path $env:TEMP ("guardian-phonebook-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
    Write-Host "TO RECORDER SMS: ip,$($guardianCaptureUri.Host),$($guardianCaptureUri.Port)#"
    Write-Host "RETURN SMS: ip,$($guardianReturnUri.Host),$($guardianReturnUri.Port)#"
    Write-Host "LOG: $guardianLog"
    node scripts/capture-reference-answer-mode.js `
        --protocol-id 9705254749 --listen-port 9002 `
        --guardian-return-host $guardianReturnUri.Host `
        --guardian-return-port $guardianReturnUri.Port `
        --minutes 15 --run | Tee-Object -FilePath $guardianLog
}
```

1. Wait for `relay_listening`, then send the printed **TO RECORDER SMS** to
   Jesh's watch. Wait for `reference_connected`, watch traffic, supplier replies
   and AnyTracking online status.
2. Open Phonebook in AnyTracking. Start by saving one known existing contact
   with the same name and number. Note the save time and which person locally.
   Do not change SOS, Answer mode or caller restrictions for this capture.
3. Look for `command: PHBX`, `direction: server_to_watch`, and
   `phonebookSlot: <number>`, followed by the watch PHBX response. Verify the
   existing contact is still correct on the watch. If nothing is sent, report
   that; do not invent a dummy change just to force traffic.
4. Return with the printed **RETURN SMS** before the 15-minute window expires.
   Confirm fresh Guardian telemetry. Stopping or expiry does not restore the
   watch's route automatically. Share the PHBX lines and action time; private
   phone/name values are not needed in the log.

Then decide the next bounded action from the actual capture. Recording a second
caller added through AnyTracking can establish its assigned slot and approved
incoming calling, but is not acceptance of Guardian's add-contact UI. Any
captured occupied slot must be imported as occupied. The second-caller Auto vs
Manual comparison remains the physical acceptance sequence in
[Contacts acceptance](watch-contacts-app.md).

## Verification

Eighteen recorder tests pass, including fragmented/coalesced PHBX writes,
separate slot values, name/number/image redaction, malformed/unexpected slot
forms, bare replies, byte-transparent forwarding and the existing bounded
answer-mode capture. No real watch command or routing SMS is sent by this update.

## 2026-09-23: AnyTracking second-contact write addressed slot 2

The operator reports adding a second contact in AnyTracking during the
same-watch recorder session. The supplied normal log establishes:

| UTC time, 23 September | Observed exchange |
| --- | --- |
| 20:44:47.040 | Reference connection established; watch and supplier heartbeat replies followed |
| 20:45:55.873 | Supplier-to-watch PHBX, prefix 3G, length 0038 (56 bytes), three arguments, phonebookSlot 2 |
| 20:45:57.210 | Same session watch-to-server bare PHBX reply, prefix 3G, length 0004; 1.337 seconds after the write |

The write occurred at 00:45:55 MUT on 24 September. Names, numbers and exact
payload bytes remain redacted. The operator's action correlates the second
contact with addressed serial 2. Treat serial 2 as used/reserved by this write;
do not allocate it as empty. The ACK establishes receipt, not a read-back of
stored contact details or an incoming-call result. Other occupied/free serials,
slot 1's mapping, and optional argument contents are not established here.

Next: inspect the watch phonebook, restore the printed Guardian route and verify
fresh Guardian telemetry, request Manual through Calls, and test ringing/manual
answering/two-way audio from the second phone. Then compare the two approved
callers under Auto and restore/test Manual. No physical second-caller outcome
or Guardian route restoration was supplied with this capture. This is supplier
provisioning evidence, not acceptance of the Guardian add-contact UI. No live
inventory was imported or modified by this documentation update. PR #115 remains
draft.

Follow-up: the operator confirms the contact is visible, the Guardian return
SMS was sent, and the second phone now rings. Both approved phones rang in
Manual; under Auto the original number auto-answered and the second kept
ringing. See [the full comparison and remaining checks](watch-caller-scope-20260924.md).
