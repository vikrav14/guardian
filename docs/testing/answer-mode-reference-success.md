# V52 answer mode: successful reference call, 22 September 2026

> **23 September update:** The Manual selection now has an exact reference
> exchange: 3G APPLOCK,JT-0 followed by 3G ACALL,0, with bare replies and four
> private records saved. Physical Manual behavior is still awaiting the
> operator's call result. Read the [new capture](answer-mode-manual-capture-20260923.md);
> this page preserves the earlier 22 September reference-call evidence.

## What changed

The operator reports that the existing Guardian pilot watch automatically
answered an incoming call after selecting Answer mode in AnyTracking, and that
audio worked in both directions. This is a successful reference-platform call
on the same pilot watch/SIM used for the failed Guardian APPLOCK trials. It
establishes that auto-answer is achievable in that tested configuration.

It does not yet establish the command mapping, the cause of the difference,
automatic-answer delay, caller eligibility, persistence, or a Guardian setter.
The operator also deliberately saved SOS and phonebook settings in AnyTracking
during this session. Their exact values were redacted. The contact writes and
mode selection mean this is not a comparison that changed only command framing.

## Captured evidence

| UTC on 22 September | Observation |
| --- | --- |
| 20:11:25.800 | Standalone relay listening, same-watch comparison, 15-minute window |
| 20:12:19.725 | Supplier connection established for the intended pilot |
| 20:12:19.734 | Watch CONFIG reported JT:0; this predates the reported mode change |
| 20:12:20.164 | Supplier replied with CONFIG,1 using prefix 3G |
| 20:15:48.155 / .603 | Supplier SOS contact command and bare watch reply |
| 20:16:04.657 / 05.241 | Supplier PHBX phonebook command and bare watch reply |
| 20:18:55.562 | Supplier ACALL: prefix 3G, length 0013, 19 payload bytes, one redacted argument |
| 20:18:57.458 | Bare watch ACALL reply, 1.896 seconds after the downlink |
| 20:19:01.474 | End of the supplied excerpt; one earlier session closed |

The successful UI selection and incoming-call timestamps were not supplied.
ACALL is therefore an observed candidate exchange, not an established mapping
for Answer mode. Neither its redacted argument nor its exact frame can be
reconstructed from this file. Do not guess a value, replay the bare reply,
or treat mixed SG/3G prefixes as the explanation.

The operator confirmed sending the Guardian return SMS after the successful
test. Fresh Guardian telemetry and physical Manual restoration have not yet
been supplied. A useful next observation is whether the setting still
auto-answers once the watch has a fresh Guardian connection. Returning routing
does not itself reset the answer setting.

## Retain the existing complete log first

The first supplied excerpt ends before the full Manual/Auto/Manual sequence.
Ask for the remaining normal capture log first; an already-captured short
setting command may avoid another supplier-routing test. Preserve action times
and call results alongside it. Do not run another routing change if those
existing records resolve the missing exchange.

## Exact local capture if the relevant argument is still redacted

The standalone recorder now accepts --private-answer-file with an absolute
path to a new local JSONL file. Preview creates no file and opens no network.
With --run, the file is created exclusively (never overwritten), and retains
exact frameHex for ACALL, APPLOCK and ANS in both directions, for the selected
device only. Recording a candidate does not authorize sending it.

Normal console output remains redacted. No raw SOS, PHBX, location, CONFIG,
ICCID, media or other command payloads go into this additional file. Capture is
limited to 64 candidate frames, at most 512 bytes each. Limits and write errors
are reported; they do not change the bytes forwarded between watch and server.
Disk-write failure ends private recording, not the existing TCP forwarding.
This file can contain private argument data encoded as hex: keep it outside
the repository and do not paste it into a public issue or PR. POSIX creation
mode is 0600; on Windows the destination directory's access controls apply.

After restoring Guardian, checking fresh telemetry and verifying the current
ngrok return address, pull feat/v52-watch-modes. No gateway restart is needed
for this standalone helper update. Stop the previous recorder, keep the
gateway/ngrok agent running, and prepare a new private path:

```powershell
$guardianPrivateAnswer = Join-Path $env:TEMP ("guardian-answer-private-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".jsonl")
```

Add --private-answer-file $guardianPrivateAnswer to the already-reviewed
capture command, together with the current --guardian-return-host/port. Route
through the actual capture endpoint only after relay_listening. Correlate
Press to answer, Handsfree auto answer and Press to answer with their exact
exchanges and physical calls. Restore the saved Guardian route before expiry,
then require fresh telemetry. Stop/expiry still never sends a restoration SMS.

Keep all three original/current endpoints distinguishable. The tested ngrok
3.39.9 endpoint body uses url "tcp://", inspect false, and upstream.url
"127.0.0.1:9002". That installed agent rejected a tcp:// prefix on the upstream
and rejected omitted inspect:false. These were endpoint configuration errors;
they did not change the watch's server.

## Implementation and release boundary

Once exact, action-correlated enable/disable bytes and physical results are
available, review their argument semantics, approved-caller behavior and
persistence before implementing the narrowly scoped Guardian adapter. Continue
to distinguish requested, handed off, replied, and physically applied states.
No guessed ACALL command or new production downlink has been added. PR #115
remains draft and customer automatic-answer controls remain disabled.

Validation: 17 focused recorder tests and all 1,297 gateway tests passed.
Tests used local fake peers and synthetic arguments, not the supplier account
or real watch. No live private-argument capture has yet been collected.
