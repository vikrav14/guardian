# Answer-mode reference capture without an HTTP inspection tool

> This procedure remains specific to the separate reference watch. A distinct
> [same-watch comparison](answer-mode-same-watch-capture.md) is now prepared for
> an existing Guardian pilot, using explicit Guardian return-route options.
> That comparison needs separate operator agreement because it changes the
> pilot's telemetry destination. Neither live capture has been executed.

## Current checkpoint — 22 September 2026

PR #115 remains a draft. The operator has resumed investigation after losing
access to the HTTP capture tool. Automatic answering is still **not passed**.
This helper is prepared and tested with local fake sockets, not a real watch.

Two devices must stay separate:

| Device | Established result | Remaining limit |
| --- | --- | --- |
| Jesh, Guardian pilot | Approved incoming calls work; documented Auto command, supplier framing and reboot trials did not produce automatic answering. | No replacement wire command established. |
| Separate new watch on AnyTracking | Operator captured ten ANS history entries, five Set:0 and five Set:1; all marked sent/responded, with 1–6-second response delays. | Calls on its new SIM do not currently work. Model/firmware equivalence and physical auto-answer are unverified. |

The latest reference history entry reports Set:0 at 16:07:49 on 22 September;
its timezone is unspecified. It is not a Jesh result. Public Android app 5.2.94
static inspection shows the two-choice dialog maps manual to API ANS/0 and auto
to API ANS/1. SettingRecord renders responseText and labels isResponse=1 as
success. Setting retrieves an ans field with GetDeviceSetInfo. These are server
API observations, not literal V52 downlinks or proof of answering. The operator's
browser capture is not assumed to use the Android endpoint names or app version.

## What this changes

`gateway/scripts/capture-reference-answer-mode.js` is a standalone Node diagnostic
using built-in modules. A separate TCP tunnel routes the reference watch through
the helper to its existing supplier server. It observes the actual watch/server
exchange; it does not need a browser inspector or a successful voice call.

- Default is preview: no port, network connection, Firebase, .env or credentials.
- `--run` binds only 127.0.0.1, port 9002 by default. Ports 9000/9001 are rejected.
- An explicit ten-digit protocol ID must match the first frame before connecting
  upstream. This is a targeting guard, not cryptographic authentication.
- Upstream is fixed to the supplied switch-server sheet's a.igps123.com:7720.
  Confirm that the reference watch already uses that endpoint before routing.
  A different endpoint or IP literal needs review; do not assume equivalence.
- Forwards original bytes with stream backpressure. Generates no commands/ACKs,
  does not rewrite identifiers and does not replay requests.
- Logs UTC timestamps, direction, bounded command names and frame lengths.
  Exact ASCII/hex is retained only for APPLOCK,JT-0/1, bare APPLOCK/ANS, and
  observed short commands whose only parameter is 0 or 1. Other payloads are
  redacted. A CONFIG JT value, if present, remains unverified.
- A newly observed command name is evidence for review, not permission to send
  it to Jesh. More complex commands retain metadata only; complete raw capture
  is deliberately not promised.
- Invalid frame boundaries stop inspection for that direction while forwarding
  continues. Truncated observations and the 2,000-row limit are explicit.
- Duration defaults to 15 minutes, maximum 20. Up to four connected pairs and
  40 connection attempts are allowed. Expiry or Ctrl+C closes the relay.

The reference watch continues sending its telemetry to its existing supplier;
the PC and its TCP tunnel also transport that traffic during this test. Jesh's
gateway, server routing, SIM, caller restrictions and wellness routine are not
part of this capture. Do not point Jesh at the relay.

## First operator step: establish restoration

Send the already documented read-only `ts#` SMS to the **new reference watch's
SIM**, from its authorized sender. Privately retain the reply. Share only the
server hostname/IP and port; omit contact numbers, location, APN and identifiers.
If SMS control is unavailable, resolve that first: the relay cannot restore the
watch's configured server by itself.

Only when its current endpoint is confirmed as a.igps123.com:7720, prepare this
exact return SMS to that same reference SIM:

```text
ip,a.igps123.com,7720#
```

That value comes from the supplied `1. Switch-Server SMS-Commands(1).pdf`, not
from a current observation of the new watch. No server-change SMS has yet been
authorized or executed for this capture. Confirm the endpoint and the concrete
temporary route with the operator before changing routing.

## Prepare the helper on Windows without changing the running branch

In a separate PowerShell window, fetch the draft branch and copy just this
standalone script to the operator's temporary directory. This does not check out
the draft or change the running gateway's source files.

```powershell
cd C:\Users\MSI\repos\guardian
git fetch origin feat/v52-watch-modes
if ($LASTEXITCODE -ne 0) { throw 'Fetch failed' }
$guardianRelayPath = Join-Path $env:TEMP 'guardian-answer-reference-relay.js'
$guardianRelaySource = git show origin/feat/v52-watch-modes:gateway/scripts/capture-reference-answer-mode.js
if ($LASTEXITCODE -ne 0) { throw 'Could not read the relay script' }
[System.IO.File]::WriteAllText($guardianRelayPath, ($guardianRelaySource -join "`n"), [System.Text.UTF8Encoding]::new($false))
$guardianReferenceId = Read-Host 'Enter the NEW reference watch protocol ID, not Jesh'
node $guardianRelayPath --protocol-id $guardianReferenceId
```

Check preview target and reference endpoint. After the preflight and temporary
route are agreed, start in that separate window:

```powershell
node $guardianRelayPath --protocol-id $guardianReferenceId --minutes 15 --run
```

It does not redirect a watch automatically. Starting it alone changes no watch
settings. Keep the terminal open and the PC awake throughout the capture.

## Temporary endpoint and capture sequence

Use a separate endpoint on the existing ngrok agent targeting tcp://127.0.0.1:9002.
Keep the pilot's TCP and WhatsApp endpoints running. The ngrok Agent API supports
creating/listing/deleting named endpoints; creation can still fail because of
account limits. If it fails, stop before changing any watch routing. See the
[ngrok Agent API](https://ngrok.com/docs/gateway/agent/api).

1. Inspect the current agent endpoint list. Prepare a unique reference-capture
   endpoint; do not replace an existing endpoint or restart ngrok. Record the
   actual returned public TCP hostname and port, and confirm its upstream is
   127.0.0.1:9002. No public address is invented in this runbook.
2. Prepare `ip,<actual-reference-tunnel-host>,<actual-reference-tunnel-port>#`
   alongside the confirmed return SMS. Confirm these two concrete messages and
   the target reference watch with the operator before sending the temporary
   route. This is a supervised diagnostic, not production deployment.
3. Require relay `reference_connected` and fresh online status in the new
   watch's AnyTracking account. If these do not appear, use the prepared return
   SMS and stop. Do not queue more commands to an offline watch.
4. On AnyTracking, explicitly select Press to answer and save. Record local
   time and corresponding server_to_watch frame and reply. Then select Handsfree
   auto answer, save and record the same evidence. No voice call is required to
   learn which commands the reference server sends.
5. Select Press to answer again and record the final request. This requests
   restoration but does not prove applied state while calls remain blocked.
   Send the prepared return-server SMS and verify the reference watch is freshly
   online in AnyTracking **before** stopping the relay/removing its endpoint.
6. Stop the helper and delete only the temporary reference endpoint. Preserve
   the redacted capture and times. Never publish a full ts# reply or account
   credentials. Raw photos, coordinates and phonebook contents are not retained.

**Timeout is not restoration.** If the relay expires, the PC sleeps, or its tunnel
disconnects first, the watch remains configured to that temporary address and
may be offline. Send the prepared return SMS immediately and verify reconnection.
The helper explicitly reports routingRestored:false; it cannot send that SMS.

## How results change the next test

| Captured result | Next action |
| --- | --- |
| Auto sends APPLOCK,JT-0 with the bytes already tested | Formatting is less likely to explain the difference. Compare firmware, eligibility and preceding setup; do not repeat the same Jesh trial as new evidence. |
| Auto sends different bytes or additional settings | Review exact target/model, frame length, order and parameters. Prepare one bounded Jesh trial only after establishing what those captured commands do and how to restore them. |
| History says success but no corresponding downlink is captured | Check capture completeness, correct identity and connection before relying on the platform result. |
| Traffic cannot be decoded or arguments are redacted | Preserve the metadata/gap. Extend the diagnostic deliberately; do not guess the hidden bytes. |

Even a perfect capture does not establish physical automatic answering on either
watch. Jesh's working voice path remains the eventual acceptance target after
any observed protocol difference has been assessed.

## Verification

Local Node tests cover default preview, input restrictions, fragmented/coalesced
frames, binary payload boundaries, contact/telemetry redaction, exact forwarding
in both directions without generated ACKs, wrong-device rejection, observation
failure without traffic rewriting, identification timeout and capture expiry.
No real watch, ngrok endpoint, supplier account or reference-server connection
is used by those tests.

Validation for this change: eight focused relay tests passed; the full gateway
suite passed 1,288/1,288 after npm ci in an isolated copy verified against PR #115
head f11e43a5. An earlier dependency-path-only run failed five existing Wi-Fi
setup subprocess tests because their isolated environments could not resolve
dotenv; installing the lockfile dependencies locally resolved that test setup
problem. No Wi-Fi code was changed. Flutter/runtime UI files are unchanged.
