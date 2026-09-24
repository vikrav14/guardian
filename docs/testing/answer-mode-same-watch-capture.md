# Same-watch answer-mode comparison with a Guardian return route

## Reference call passed; exact control capture pending

PR #115 remains draft. The operator approved and ran the same-watch comparison
on 22 September, and reports that auto-answer with two-way audio worked through
AnyTracking. The Guardian return SMS has been sent; fresh Guardian telemetry
and Manual restoration remain unreported. See the
[reference result and exact-capture follow-up](answer-mode-reference-success.md).
The separate new watch's voice/SMS issues remain separate from this pilot.

The latest Guardian trial sent exact APPLOCK,JT-0 with lowercase 000c, received
a bare APPLOCK reply, and still rang. The requested Manual restore remains
unreported. Confirm that restoration before this comparison.

## Why this can resolve the uncertainty

The official AnyTracking APK's Setting class selects its answer-mode dialog by
the server-provided numeric model. Models 220, 236, 239, 244, 216, 234, 224, 226,
237 and 247 use the two-choice dialog (v0); other supported models enter u0,
whose value interpretation also varies by model. Both save paths call
SendCommandByAPP with CommandType ANS, Model 0 and Paramter. The two-choice
dialog sends API 0 for Manual and API 1 for Auto. Model 0 in that request is not
evidence that the watch's numeric model is zero. No JT translation or extra
wire-level prerequisite was found in these app paths or the supplied protocol.

This supports a **hypothesis**, not a finding: the supplier server may select a
different command or preceding setup for this firmware. It may also send the
same bytes. Capturing the same watch avoids assuming the second device is an
equivalent reference. A command reply or supplier success message is still not
physical acceptance. The [manufacturer's V52 guide](https://ireachfar.com/wp-content/uploads/2023/07/User-Guide-RF-V52-Smart-GPS-Watch-U.pdf)
describes automatic answering for SOS/family callers after two rings, but does
not disclose its implementation. The existing caller was already recognized;
do not reset the approved contacts to repeat that check.

## What the tool does

Use the existing standalone capture-reference-answer-mode.js with the paired
options --guardian-return-host and --guardian-return-port. Preview validates
the host/port and prints the return SMS. Those options change restoration
guidance only; supplier upstream remains fixed at a.igps123.com:7720, the
endpoint in the supplied switch-server sheet. Its live availability and the
pilot's account registration are not established by the helper.

Only --run opens the separate loopback listener. A matching watch identifier is
required before the upstream connection. The relay forwards original bytes;
it neither invents commands nor ACKs. Existing limits, redaction and no-replay
behavior remain. It captures exact bytes for short switches and command/length
metadata for more complex messages. A redacted payload is a capture limitation,
not a reason to reconstruct a guessed command.

**During the comparison the supplier receives the pilot's telemetry and controls
the watch connection. Guardian's live telemetry, TCP commands and scheduled
readings for that watch are interrupted.** Supplier queued commands may run
when the watch reconnects. The relay forwards those too; it does not guarantee
that only answer mode changes. Check the owner's supplier settings/history
before connecting, retain the current approved-contact configuration privately,
and stop the comparison if unrelated settings change unexpectedly.

The software does not send SMS. Expiry or Ctrl+C closes connections; it does
not return the watch to Guardian. The printed restoreCommand is guidance only,
and routingRestored/returnRouteVerified always remain false.

## Prepare without changing the watch

Keep Guardian and its ngrok agent running. Use AnyTracking on the owner's phone
to confirm access to the correct pilot device. It may show offline and refuse
to open Answer mode while its TCP server is Guardian; that alone does not block
the prepared comparison. Open Answer mode after the reference connection and
fresh online status. Login failure or a missing device must be resolved first.

In a separate PowerShell window, with the updated draft branch available:

```powershell
cd C:\Users\MSI\repos\guardian\gateway
$guardianEndpoints = (Invoke-RestMethod http://127.0.0.1:4040/api/endpoints -ErrorAction Stop).endpoints
$guardianLiveTcp = @($guardianEndpoints | Where-Object {
    $_.url -like 'tcp://*' -and $_.upstream.url -match '(^|:)9000/?$'
})
if ($guardianLiveTcp.Count -ne 1) { throw 'Expected one current Guardian TCP endpoint.' }
$guardianReturnUri = [uri]$guardianLiveTcp[0].url
$guardianPilotId = Read-Host 'Enter the existing Guardian pilot protocol ID'
$guardianReturnSms = "ip,$($guardianReturnUri.Host),$($guardianReturnUri.Port)#"
$guardianReturnSms
node scripts/capture-reference-answer-mode.js --protocol-id $guardianPilotId --guardian-return-host $guardianReturnUri.Host --guardian-return-port $guardianReturnUri.Port --minutes 15
```

Check the preview identifies the intended pilot, captureMode is
same_watch_comparison and networkOpened is false. Privately retain the exact
return SMS outside the relay window. Compare the current watch server using its
documented ts# reply if available. Existing fresh Guardian telemetry after the
recent successful routing SMS supports the current route, but a new failed SMS
or changed tunnel must be resolved before this test. Never reuse an old port.

Prepare a separate ngrok TCP endpoint named guardian-answer-capture, forwarding
to 127.0.0.1:9002, using the existing agent's /api/endpoints API. List endpoints
before and after creation. If a same-name endpoint already exists, inspect it;
do not replace it blindly. If the account rejects another endpoint, stop before
changing the watch. Keep the original TCP and WhatsApp HTTPS endpoints running.
Obtain the capture endpoint's actual public URL, and prepare its server-change
SMS separately from the Guardian return SMS. This endpoint alone does not route
the watch or send telemetry to the supplier. On the tested ngrok 3.39.9 agent,
set inspect:false and use upstream.url "127.0.0.1:9002" without a tcp:// prefix;
omitting that flag or using the prefixed upstream caused creation errors.

Show both concrete routes to the operator. Obtain agreement to the temporary
supplier telemetry/control path before the next section. The existing
reference-watch runbook's approval is not transferred to this different watch.

## Execute only after operator agreement

1. In the prepared window, start the relay with the same checked arguments plus
   --run. Confirm relay_listening and the correct Guardian restoreCommand.
2. The operator sends the prepared capture-route SMS to the pilot's existing
   SIM. Require reference_connected and fresh online telemetry in the correct
   AnyTracking device. If that fails, send the prepared Guardian return SMS.
3. In AnyTracking, set Press to answer. Record the time and capture the actual
   downlink/reply. Make one approved call and verify manual answering and audio.
4. Set Handsfree auto answer. Record the time, actual downlink/reply and any
   preceding setup. Make one call from the same approved number with the watch
   beside the informed operator. Record actual wait duration, rings, answering
   and audio. Leave caller restrictions, sound profile and contacts unchanged.
5. Select Press to answer again, observe its response and confirm manual
   answering. Record any unexpected setting change without publishing private
   contact/status data.
6. **Before stopping the relay**, send the saved Guardian return SMS. Confirm
   the pilot's identified Guardian connection and fresh telemetry. If the relay
   already expired, the same SMS is still required. Check the wellness routine
   remains enabled; do not treat a slot missed during the comparison as a pass.
7. On Guardian, verify manual behavior again. If needed use the documented
   Manual trial helper, preserving the physical result separately from its ACK.
8. Stop the relay and delete only guardian-answer-capture. Keep Guardian's two
   existing endpoints. Retain the capture privately for targeted redaction.

No automatic fallback or restore is claimed. If SMS restoration fails, report
that and resolve routing before treating the test as complete.

## How this becomes a fix

| Result | Implementation consequence |
| --- | --- |
| Same watch auto-answers and supplier sends different command/setup | Review the exact model/bytes/order and documented semantics, then implement a bounded Guardian adapter and physically retest. |
| Same watch auto-answers with the same command | Compare preceding configuration, timing and caller eligibility; command spelling alone is not the explanation. |
| Same watch still rings through the supplier | Preserve the failed reference result; no firmware support conclusion follows automatically. |
| Supplier device stays offline or capture is incomplete | Inconclusive. Restore Guardian; do not invent the missing exchange. |

This tool provides evidence needed to build a correction; it does not itself
make an incoming carrier call answer. The first live comparison has now been
reported as a physical pass; the exact Guardian control path remains pending.

## Verification

Seventeen focused relay tests passed locally, including default network-free
preview, invalid/incomplete return routes, target checks, unchanged byte
forwarding, redaction, time limits and correct Guardian return guidance on both
manual stop and expiry. Tests used local fake TCP peers, no real watch or
supplier account. No customer feature or firmware command was enabled.
The additional tests cover private-file preview/no-overwrite, exact candidate
bytes without public disclosure, bounded recording, short writes/write errors,
file closure and retained Guardian restoration guidance.
The full gateway suite also passed: 1,297 tests, zero failures.
