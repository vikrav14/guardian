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

## Next supervised trial

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
