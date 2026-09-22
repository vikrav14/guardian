# Watch alert styles and call answering

> **Paused 22 September 2026:** Read the [PR #115 handoff](watch-modes-paused-handoff.md)
> before resuming. Earlier trial instructions below are history/prepared work,
> not a request to execute them while this PR is paused. Work moves to PR #118.

## Current scope

Alert-style controls already exist on main. The app queues `set_watch_alert_profile`;
the gateway sends `profile,<1..4>` on a live connection. Displayed settings are last
requested values, not verified watch state. Silent requires confirmation; automatic
expiry/restoration is not implemented.

PR #115 remains draft. Its old service contracts stay disabled. This branch adds
bounded APPLOCK reply diagnostics, not customer-facing auto-answer controls.

## V52 sources and command mapping

The supplier's `3. V46-V48-V52 Communication Example(1).pdf`, page 2, specifies:

| Behavior | TCP payload |
| --- | --- |
| Press to answer | `APPLOCK,JT-1` |
| Automatic answering | `APPLOCK,JT-0` |

Both payloads are 12 ASCII bytes (`000C`). Use the current connection's protocol ID,
never the example device ID. These are TCP commands with no documented SMS fallback.

The [ReachFar V52 user guide](https://ireachfar.com/wp-content/uploads/2023/07/User-Guide-RF-V52-Smart-GPS-Watch-U.pdf)
describes auto-answer after two rings for SOS/family callers. It describes safe mode
separately as caller filtering. Neither supplied source establishes changing safe
mode as an auto-answer prerequisite.

The original V52 supplier PDFs remain outside the repository; see
[reference inventory](../reference/README.md) and
[supplier validation](wifi-home-supplier-validation.md). Historical V28C documents
and other manufacturers' protocols do not establish V52 command semantics.

## Pilot evidence — 21 September 2026

| Item | Evidence and limit |
| --- | --- |
| Vibration-only incoming call | Fresh `profile,3` downlink, reply observed, operator confirmed vibration without sound |
| Sound-only incoming call | Operator reported a successful fresh retest; matching mode-2 downlink not supplied |
| Automatic answering | `APPLOCK,JT-0` sent to one live session; APPLOCK reply observed; incoming call kept ringing |
| Caller eligibility | Operator confirmed watch SMS `ts#` SOS1 readback matches the calling number; raw contact data deliberately not published |
| Manual restoration | Operator reported the call waited for manual answering after requested restoration; matching JT-1 downlink not supplied |
| Silent / expiry / reboot | Not verified |

Firmware labels reported by the pilot:
- `C403H_RFHZ_V52_EN_750_V1.3_2025.03.10_18.29.29`
- `C403H_RFHZ_V52_EN_04R6_V1.3_2025.03.10_18.29.29`

Automatic answering has **not passed**. Matching SOS1 removes the specific stored
SOS mismatch being investigated; it does not prove all firmware caller-matching
conditions. No cause or unsupported-firmware conclusion is established.

## Reply diagnostics

Previously, the parser dropped every APPLOCK argument before producing
`command_echo`. Bare `APPLOCK`, `APPLOCK,JT-0`, and `APPLOCK,ERROR` produced
identical events/logs. Earlier descriptions of the observed reply as "bare" were
therefore unproven. This limitation also applies to old profile logs, whose
argument handling is unchanged.

APPLOCK logs now include receive time and `replyEvidence`:
- `kind`: bare or parameterized, based on the actual argument count.
- `argumentCount`: total number of received arguments.
- `arguments`: at most eight tokens; only `JT-0`, `JT-1`, `OK`, `ERROR`,
  `FAIL`, `0`, and `1` are retained. Other values are redacted.
- `truncated`: whether more than eight arguments were received.
- `appliedStateVerified: false`: even a matching value or OK token is not proof.

Status tokens are diagnostic text only; their firmware meaning is not assumed.
No additional ACK is sent in response to APPLOCK. Dropping a response from ACK
processing does not cancel the command. No production automatic JT-1 reversion
was found during the repository audit.

## Instrumented follow-up — 21 September 2026, 19:08 UTC

The operator supplied `Pasted text(20260921-191154).txt` (100 lines) after running
the diagnostic gateway. It records one `APPLOCK,JT-0` downlink to one live session,
followed by an APPLOCK reply at `2026-09-21T19:08:32.909Z` (23:08:32.909 MUT):

```json
{"kind":"bare","argumentCount":0,"arguments":[],"truncated":false,"appliedStateVerified":false}
```

This capture establishes that **this reply was bare**, matching the supplied
communication example. It contains no returned mode or error detail; it still
does not establish that automatic answering was applied. The earlier captures
remain uninterpretable as to argument shape.

The operator reported that the call from the confirmed on-watch SOS1 number,
left untouched for the instructed 15–20 seconds, **kept ringing**. Auto-answer
therefore remains **not passed**. The exact call timestamp/ring count is not
present in the log. The excerpt contains no JT-1 downlink or verified manual
restoration after this final Auto trial. Earlier helper outputs reported
Auto -> Manual -> Auto socket handoffs; their exact timestamps were not supplied.

Next action: end the call, restore `APPLOCK,JT-1`, capture the reply, and confirm
manual answering. Ask the supplier to confirm support and prerequisites for
`JT-0` on the two recorded firmware labels, including any caller-number format
requirements and a supported way to read back answer mode. Keep caller
restrictions unchanged. Do not infer unsupported firmware or change JT mappings
from this result. Repeating the same enable/call trial without new information
would not resolve the remaining uncertainty.

The diagnostic commit `3eabb7d` passed Guardian release gates run
[35641384531](https://github.com/vikrav14/guardian/actions/runs/35641384531).
CI success validates the software checks, not physical auto-answer behavior.

## Instrumented trial procedure

1. Run this draft's gateway with the watch beside the informed operator. Preserve
   the existing tunnel and approved callers; wait for the live device session.
2. Use the already prepared local helper to send `APPLOCK,JT-0` once. Capture
   the matching downlink and the new APPLOCK `replyEvidence` line.
3. Call from the confirmed SOS1 number with the watch untouched for 15–20 seconds.
   Record whether it answers, approximate watch ring count, and two-way audio if it answers.
4. End the call, send `APPLOCK,JT-1`, retain its downlink/reply, and verify manual
   answering. Record exact local test times.
5. If the reply is still bare and the call still rings, give the supplier the
   firmware labels, commands, caller-match confirmation and observed results.
   Do not reverse JT values or change caller restrictions without V52 evidence.

## Remaining product work

- Honest requested, handed-off and physically observed state in the app,
  including the Primary SOS dropdown's current queued-as-sent wording.
- Verified auto-answer behavior and informed wearer controls before exposing it.
- Silent-mode acceptance and any explicitly designed expiry/restoration behavior.
- Reconcile the old service contracts with implemented main-branch controls.
- Real-device acceptance of reboot behavior and any claimed persistent settings.

## Deeper protocol audit — 21 September 2026

The operator requested further investigation before supplier escalation. Re-read
the supplied Communication Protocol, the full five-page Communication Example,
SMS provisioning sheet and V52 guide, and traced the helper -> authenticated HTTP
-> downlink -> TCP path.

| Check | Finding |
| --- | --- |
| Command mapping | Supplier example page 2: JT-0 automatic; JT-1 press-to-answer |
| Target | Live session protocol ID; never the example device ID |
| Prefix / punctuation | SG, brackets, asterisks, comma and ASCII hyphen match the example |
| Payload | Exactly 12 ASCII bytes; no BOM, space, CR/LF, NUL, checksum or terminator added after the closing bracket |
| Full frame | 33 bytes for the 10-digit protocol ID |
| Exact remaining byte difference | Offset 18 (zero-based): current builder uses C (0x43), supplier example c (0x63) in the length field |
| Queue / overwrite | Direct TCP path bypasses Firestore command queuing; no automatic JT-1 overwrite found in production |
| Reply | The instrumented pilot reply is bare APPLOCK; no applied mode or error detail |
| Caller data | Operator confirmed SOS1 via ts#; incoming caller-ID recognition and exact displayed number format have not been observed |
| Additional observation | Supplier example page 3 includes JT:0 in CONFIG; it does not define whether this is capability, default or applied mode for the pilot V52 |

Both 000C and 000c represent 12. The protocol itself uses uppercase hexadecimal
examples elsewhere. Uppercase is **not established as invalid**, and the new
comparison is **not a confirmed fix**. The independent
[Traccar Watch encoder](https://github.com/traccar/traccar/blob/master/src/main/java/org/traccar/protocol/WatchProtocolEncoder.java)
also uses a lowercase hexadecimal length and maps an incoming 3G manufacturer to
outbound SG; it is corroborating implementation evidence, not pilot acceptance.

### Exact-example comparison

The operator-only script `gateway/scripts/trial-answer-mode.js` defaults to
preview and requires an explicit mode and framing choice. With --send it makes
one authenticated local POST, without automatic retries. It checks that the
gateway reports the expected exact frame, detecting older gateways that ignore
the formatting option. It never queries or changes contacts, safe mode, SOS slots,
wellness schedules, or command polarity.

The optional `frameFormat=applock-example` is restricted to POST /dev/downlink
and exactly APPLOCK,JT-0 or APPLOCK,JT-1. Normal framing remains unchanged.
Regression tests exercise the real local TCP bytes and the script -> authenticated
HTTP -> downlink path, reject other commands/GET/unauthenticated requests, and
cover timeout ambiguity, preview and old-server mismatches.

Passive CONFIG logging retains only the JT field's presence/validity and a
single 0/1 value. Other CONFIG contents are discarded from this diagnostic.
Meaning and applied-state verification remain false. No CONFIG request command
is invented or sent; the pilot may never emit that packet.

### Next physical check

1. Update this branch and restart the gateway while preserving ngrok.
2. Keep the watch beside the informed operator. End any call, return to the watch
   face, and leave it idle for a minute. The V52 guide explicitly identifies a
   busy watch (including a call) as a reason settings can fail.
3. From a second PowerShell window in gateway, send exactly once:

   `node scripts/trial-answer-mode.js --imei <pilot-imei> --mode auto --framing supplier --send`

4. Confirm socket_handoff and literal lowercase 000c in the displayed frame.
   Wait for the APPLOCK reply and allow 30 seconds with the watch idle, then call
   from the already verified SOS1 number. Leave the watch untouched for up to
   30 seconds. Record answering/ring count, two-way audio if answered, and whether
   the incoming screen displays the saved contact name, a number, or Unknown.
   Describe number formatting only (local / +230 / 230 / 00230), not the full
   private number. Do not modify the stored contact while checking.
5. End the call and restore using the same exact-example framing:

   `node scripts/trial-answer-mode.js --imei <pilot-imei> --mode manual --framing supplier --send`

   Capture the reply and verify that another untouched call waits for manual
   answering. Record the actual outcome even if it differs from the documented label.
6. Preserve the APPLOCK and any answer-mode-config lines plus physical results.
   If auto-answer works, compare current versus supplier framing under the same
   idle/timing/caller conditions before attributing the result to the header case.
   The script supports --framing current for that explicit later comparison.

The first result for this comparison is recorded below. Customer auto-answer
controls remain unaccepted.


## Exact supplier-frame result — 21 September 2026, 19:37 UTC

The operator ran the exact-example Auto trial at `2026-09-21T19:37:28.514Z`.
Its output reported one live session and the expected 33-byte frame with a
12-byte payload and lowercase `000c`. The subsequent attachment
`Pasted text(20260921-194115).txt` independently contains:

```text
[downlink] sent APPLOCK,JT-0 to 9705254749 (1 session(s)): [SG*9705254749*000c*APPLOCK,JT-0]
[gateway] 9705254749 echoed back APPLOCK receivedAt=2026-09-21T19:37:28.889Z replyEvidence={"kind":"bare","argumentCount":0,"arguments":[],"truncated":false,"appliedStateVerified":false} (dropped, not re-acking)
```

The operator reports that automatic answering **did not work**. This is a failed
physical Auto test despite the exact supplier framing and a matching bare reply.
Both uppercase and lowercase trials have now failed to produce automatic answering;
the header-case change is not a demonstrated fix. The reply contains no applied
mode or error information, so the reason for failure remains unknown.

This excerpt contains no `answer-mode-config` observation and no subsequent
`APPLOCK,JT-1` restoration. Neither absence establishes unsupported firmware.
A later TCP connection at `19:39:56.078Z` does not establish why the call failed.
The operator subsequently confirmed that the incoming screen displayed the saved
contact. Combined with the prior SOS1 readback confirmation, this supplies evidence
of visible caller recognition. It does not establish that the firmware uses the same
internal matching rule for automatic answering. The precise call time, duration and
ring count were not provided; do not infer them from the instructed test procedure.

Next: end the call and restore Manual using the same supplier framing, capture
its reply, then verify that a fresh untouched call waits for manual answering.
The already-confirmed SMS SOS1 match and visible saved-contact recognition need
not be repeated. The evidence does not yet distinguish ignored mode application,
additional firmware prerequisites or an implementation defect; none is established
as the cause. No documented V52 applied-mode readback has been identified.

Do not repeat Auto without a new diagnostic reason or change contacts, caller
restrictions or undocumented command values. PR #115 remains draft; automatic
answering is not accepted.

The diagnostic runtime commit `d1d37b4` passed
[Guardian release gates run 35645517019](https://github.com/vikrav14/guardian/actions/runs/35645517019).
That software result does not change the failed physical outcome.

## Reboot comparison prepared — 21 September 2026

After the request to restore Manual and verify a call, the operator reported
"done". No new command output or detailed call observation accompanied that
completion report. The operator then asked what else could be tried.

The supplied Communication Protocol, section 43, documents `RESET` as a
device restart. Section 42 separately documents `FACTORY`; this trial never
sends FACTORY. The V52 user guide also documents remote reboot, but does **not**
say that answering-mode changes require it. Testing behavior across a restart
is a new diagnostic condition, not a known remedy or an established prerequisite.

The existing `gateway/scripts/send-reset.js` did not attach the admin header
required by the current gateway. The helper now:

- Requires an explicit device identifier and previews unless `--send` is present.
- Uses the configured HTTP port and admin key with one authenticated loopback POST.
- Sends only the documented RESET command; it cannot override the command or host.
- Bounds the request to ten seconds, rejects redirects, and never retries automatically.
- Verifies the returned command/frame and keeps `watchRestartVerified: false`.
- Requires the operator to observe a reboot and subsequent live telemetry.

This changes the helper CLI: prior no-argument sends and --host/--port overrides
are removed; explicit positional 10/15-digit identifiers remain supported.
No runtime server change or gateway restart is required for this helper update.
The assistant has not sent a live watch command.

### Supervised comparison

Keep the watch beside the informed operator; end any call and keep gateway and
ngrok running. Pull the draft branch in a second terminal.

1. Send Auto once with `trial-answer-mode.js --imei <pilot-imei> --mode auto --framing supplier --send`.
2. Capture the APPLOCK reply and leave the watch idle for 30 seconds.
3. Send `node scripts/send-reset.js --imei <pilot-imei> --send` once.
4. Observe whether the watch visibly restarts; wait for its new identified TCP
   session and fresh heartbeat. A socket-handoff result alone is not a reboot.
   If handoff is uncertain or no restart is observed, inspect logs and stop this
   comparison rather than retrying automatically.
5. After reconnection, leave the watch idle for a minute, then call from the same
   confirmed SOS1 contact and leave it untouched for up to 30 seconds. Record
   local time, ring count, answer behavior and two-way audio if it answers.
   Do not resend Auto after reboot: that would change what this test measures.
6. End the call, send Manual using the same supplier framing, capture the reply,
   wait 30 seconds and restart once with the same RESET helper. Wait for the new
   session/heartbeat and verify that a call requires a manual answer. If it
   answers automatically, report that result rather than claiming restoration.

Retain APPLOCK, RESET, TCP connection and any `answer-mode-config` lines,
without publishing contact data. This tests the requested modes across reboot;
it cannot directly read the stored mode. A failure does not establish unsupported
firmware. No caller-list, safe-mode, SOS-slot or server-setting change is part of
the comparison. Auto-answer remains unaccepted and PR #115 stays draft.

## Reboot trial result — 21 September 2026, 20:02–20:08 UTC

Source: operator attachment `Pasted text(20260921-200849).txt` and the report
"did not work" following the supervised Auto/reboot/call procedure. Automatic
answering remains **not passed**.

| Observed event | Evidence |
| --- | --- |
| Auto request | Exact supplier `APPLOCK,JT-0` frame with `000c`, handed to one session |
| Auto response | Bare APPLOCK reply at `2026-09-21T20:02:37.767Z`; no returned mode/error |
| Restart request | One `RESET` downlink to one session, after Auto; its exact send time is not printed |
| New startup traffic | TCP connection at `20:04:11.795Z`, followed by configuration, full pilot IMEI and fresh persistence |
| New configuration evidence | At `20:04:11.834Z`: `jtField: valid`, `reportedJt: 0`, `meaningVerified: false`, `appliedStateVerified: false` |
| Manual request | Exact supplier `APPLOCK,JT-1` frame, handed to two registered sessions |
| Manual response | Bare APPLOCK reply at `20:06:23.059Z` |
| Post-Manual restart/configuration | Not present in the supplied excerpt |

The startup sequence after RESET is consistent with a device restart. The
operator did not separately describe the visible boot sequence, exact call time,
ring count or post-restoration call outcome. The reported failure must not be
turned into a claim that the stored answer mode has been read back.

This is the **first captured JT configuration value from the pilot** in this
investigation. Parser review confirms it is extracted from a received `JT:0`
field, not a default substituted for missing data. Its meaning remains unknown:
it could describe a setting or another firmware property. The same-named field
in the mixed-family supplier example does not establish the V52 meaning.

Next complete the already-planned **Manual/reboot** half of the comparison.
Manual has already been handed off and replied to; do not resend Auto. If a
restart after that Manual reply has already happened, obtain its configuration
line instead of requesting another restart. Otherwise, with no call active,
send RESET once using the updated helper, observe the watch startup and wait
for identified reconnection/fresh telemetry. Retain the next
`[answer-mode-config]` line and verify an incoming call waits for a manual answer.

If JT changes to 1, that supplies evidence of a relationship between the request
and startup configuration on this pilot; it still does not prove successful
automatic answering. If it remains 0, that does not by itself distinguish a
static field, ignored setting or a setting that does not persist. If no field
arrives, record that absence without inferring a firmware capability.

The excerpt also logs unhandled `appcontacttel`, `APPANDFNREPORT` and `eicard`
during startup. It does not establish their semantics or a causal link to the
failed call; do not fabricate server responses. The multiple registered TCP
sessions likewise do not establish a cause of the Auto failure.

No runtime change or live command is made by this evidence update. PR #115
remains draft. The helper/runtime head `bc38754` passed
[Guardian release gates run 35648407320](https://github.com/vikrav14/guardian/actions/runs/35648407320);
software CI does not validate the physical answer-mode behavior.

## Manual reboot comparison — 21 September 2026, 20:16 UTC

The operator supplied the Manual helper output, the subsequent RESET helper
output and startup logs. The Manual request was made at
`2026-09-21T20:06:21.456Z`, handed to two sessions and replied to at
`20:06:23.059Z` in the earlier capture. RESET was requested at
`20:13:49.251Z` and handed to one session with the documented frame.

The watch then connected at `20:16:11.009Z`, supplied its full pilot IMEI and
fresh telemetry, and emitted this configuration evidence at `20:16:11.061Z`:

```json
{"jtField":"valid","reportedJt":0,"meaningVerified":false,"appliedStateVerified":false}
```

| Requested mode before RESET | Startup configuration (UTC) | Reported JT |
| --- | --- | --- |
| Auto, APPLOCK,JT-0 | 20:04:11.834 | 0 |
| Manual, APPLOCK,JT-1 | 20:16:11.061 | 0 |

The field is unchanged across the two requested modes. This comparison does
**not validate JT as an applied answer-mode readback**. It does not prove that
Auto is active, that Manual was ignored, or that the firmware lacks auto-answer.
A static/default field and a setting that is ignored or does not persist remain
possible explanations; these observations do not distinguish them.

The startup socket ended at `20:16:40.619Z` without a socket error or logged
gateway-initiated close, and a new connection arrived at `20:17:01.015Z` with
fresh session persistence. This is connection evidence, not evidence of an
answer-mode change or the cause of the failed automatic call.

Manual is the last requested mode. The physical incoming-call result after this
latest restart has not yet been supplied, so final Manual restoration remains
awaiting that observation. No additional Auto, Manual or RESET command is
needed merely to repeat this comparison.

Auto-answer remains not passed. The documented mapping, exact frame, bare replies,
stored SOS1 match, visible caller recognition and reboot comparison are now
recorded. Further command variations require new V52-specific evidence; there
is no demonstrated formatting fix or supported applied-state query to implement.
Keep customer auto-answer controls disabled and PR #115 draft. This update
changes evidence documentation only and sends no live device command.

## Official app investigation — 21 September 2026

Read-only analysis of the official AnyTracking 5.2.94 Android app found an
app-to-server ANS command abstraction for Answer mode and an ans settings field.
This is not a discovered V52 TCP command: the supplier server's translation and
the pilot's model-specific app path remain unknown. No JT value should be reversed
and no ANS TCP/SMS command should be guessed from those API values.

Startup review also confirms that Guardian's unknown-command fallback already
ACKs appcontacttel, APPANDFNREPORT and eicard; their log wording does not establish
a missing handshake. No runtime correction is justified by this audit alone.

The [reference-platform comparison](watch-answer-reference-comparison.md) records
source provenance, reproducible static-analysis findings, a proposed operator
trial and an explicit return-to-Guardian path. It requires owner agreement before
routing telemetry to the supplier. It has not been executed. No live command,
account access, caller-list change or new data forwarding occurred. PR #115 stays
draft and auto-answer remains not passed.
