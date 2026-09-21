# Watch alert styles and call answering

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

No result for this new comparison has been supplied yet. Customer auto-answer
controls remain unaccepted. Supplier contact is not required before completing
these concrete local checks.
