# PR #115 investigation handoff — 22 September 2026

> **Latest physical result:** The operator reports automatic answering and
> two-way audio after setting Answer mode through AnyTracking on the same
> pilot watch. The relay observed ACALL with one redacted argument; its mapping
> to the UI action is not yet established. SOS/PHBX writes were deliberate
> operator actions. The Guardian return SMS was sent; fresh Guardian telemetry
> and Manual restoration remain unreported. Read the
> [reference success and exact-capture follow-up](../testing/answer-mode-reference-success.md).
> Earlier sections below are historical checkpoints. PR #115 remains draft;
> no verified Guardian replacement command has been implemented.

## Earlier Guardian trial: exact supplier framing replied; Auto still rings

The operator completed the requested lowercase-frame trial. PR #115 remains an
open draft; this Guardian trial did not pass physical automatic answering.

| Evidence, 22 September 2026 | Observed result |
| --- | --- |
| Fresh gateway session | Connected at 19:28:51.207 UTC |
| Auto helper request | 19:29:15.456 UTC; APPLOCK,JT-0; supplier framing; length 000c; 12 payload bytes; one live session |
| Watch reply | 19:29:16.749 UTC, 1.293 seconds after the helper request |
| Reply content | Bare APPLOCK; zero arguments; not truncated; appliedStateVerified:false |
| Physical incoming call | Operator reports the watch kept ringing; no automatic answer |
| Manual restoration after this call | Requested, but no new handoff/reply or physical result supplied |

The earlier Windows checkout was identified as feat/v52-care-reminders at
93ef8f0. Its source lacked the applock-example override. The operator was then
instructed to switch to the draft watch-modes branch and restart only the
gateway. The later helper, actual lowercase downlink and diagnostic reply prove
those trial capabilities were available; the post-switch Git HEAD itself was
not pasted.

Sound + vibration, manual answering and audio both ways were physically
confirmed earlier in this testing sequence after a fresh profile,1 downlink.
The operator was instructed to keep that profile unchanged. A second profile
capture/physical baseline immediately after the gateway restart was not supplied.
The uppercase and lowercase trials therefore also span a gateway branch/runtime
change; do not describe them as a strict experiment changing only one byte.

The exact lowercase frame reached a responding watch. Bare APPLOCK is a protocol
response without a returned setting value or execution result. It is not proof
that Auto was applied. The supplied excerpt continues with live telemetry and a
later TCP connection at 19:33:12.612 UTC; no causal link from that connection to
the unanswered call is established. Actual call time, wait duration and ring
count were not measured in the supplied evidence.

**Conclusion:** The exact supplier example did not produce automatic answering.
Both length-field cases have now failed in the reported trials. Repeated case
changes are not a demonstrated fix. This still does not establish unsupported
firmware, a need to reverse JT polarity, or an ANS TCP command.

**Next:** Restore documented Manual with the existing trial helper, capture its
reply and confirm a subsequent incoming call waits for the wearer to answer.
Further Auto work needs new evidence about this firmware's applied setting or
the official platform's actual command/setup sequence. The separate reference
watch capture remains blocked by its unconfirmed server and return-SMS path.
Keep customer Auto controls disabled and preserve caller restrictions.

This checkpoint changes documentation only. No runtime, dependency, gateway
routing or watch setting was changed by the repository update.

## Previous checkpoints (superseded where the latest result differs)

## Latest: Sound + vibration baseline confirmed; Auto still rings

The operator resumed a controlled trial on the existing Guardian pilot after
restarting the laptop. PR #115 remains an open draft. This checkpoint supersedes
the historical paused state below; the separate AnyTracking reference capture
is still on hold because its server/return-SMS path is unconfirmed.

- Guardian HTTP health passed and the pilot diagnostic reported connected:true.
  The wellness routine remained enabled. This is connection evidence, not
  automatic-answer acceptance.
- A fresh profile,1 downlink was supplied for one live session. The operator
  confirmed ringing, vibration, manual answering and audio in both directions
  on the baseline call. This fills the earlier missing-downlink gap for the
  Sound + vibration incoming-call observation.
- The proposed supplier-framing helper could not run: trial-answer-mode.js was
  absent from the Windows checkout (MODULE_NOT_FOUND). That invocation sent
  nothing. The running branch and commit have not been reported.
- A temporary PowerShell Set-GuardianAnswerMode function used the existing
  authenticated loopback HTTP endpoint, keeping the live gateway running.
  It sends only documented APPLOCK,JT-0/1 with normal gateway framing (000C),
  validates the returned target, command, frame and positive session count,
  and makes no automatic retry. Its admin key stays local.
- Auto (APPLOCK,JT-0) then returned socket_handoff for one live session.
  The operator supplied the corresponding downlink with length field 000C
  and reported that the incoming call kept ringing.
- The latest excerpt contains no APPLOCK response. Do not borrow an older
  response as evidence for this request or infer that the watch never replied.
  Individual command/call timestamps and the actual wait duration were not
  supplied; twenty seconds was the requested procedure, not a measured result.
- The supplier-framing (000c) trial planned for this session did not occur.
  Earlier tests of both frame variants remain historical evidence.
- A Manual restore was requested after the call, but its latest handoff,
  response and physical result have not been supplied. Current applied answer
  mode remains unverified; keep customer automatic-answer controls disabled.

**Conclusion:** Confirmed Sound + vibration did not resolve automatic answering
in this trial. This does not establish unsupported firmware or a new command
mapping. No supported replacement for APPLOCK,JT-0 was found in the repository
evidence; AnyTracking's ANS API label still does not establish a TCP command.

**Next:** Request the documented Manual restore, confirm a subsequent call waits
for an answer, and collect the current gateway branch/commit plus any APPLOCK
response associated with the failed Auto request. Compare any new evidence
before repeating a call trial. Do not reroute either watch for the blocked
reference capture or change contacts/caller restrictions.

This update records operator evidence only. It changes no gateway, Flutter,
watch-control or relay implementation. The already prepared relay's software
validation is recorded in the PR; it has not been run against a real watch.

## Historical paused handoff (superseded where the latest checkpoint differs)

**State:** Paused at the operator's request. Keep PR #115 open as a draft; do not
merge, activate customer answer-mode controls, or continue physical tests while
work moves to PR #118. This checkpoint supersedes earlier "next test" instructions.

## Resume here

- Branch: `feat/v52-watch-modes`.
- Last investigation commit before this pause: `de924b088d16849c126972f2d11ecb4d36441a65`.
- Last runtime/helper change: `bc3875432248ef6aeb6b616d11d4cc420cbdd270`.
- Main used by this branch: `4386b0d7e47798fbc4f4d30190d888ae8b0b3301`.
- [Full watch-modes history](watch-modes.md).
- [Official-app source analysis and proposed comparison](watch-answer-reference-comparison.md).
- [Canonical physical acceptance record](../GUARDIAN_V52_REAL_DEVICE_ACCEPTANCE.md).
- Latest verified CI before pause: **success**, Guardian release gates
  [run #319](https://github.com/vikrav14/guardian/actions/runs/35652558584),
  for `de924b0`. The last recorded local gateway suite passed **1,280/1,280**.
  These software results do not prove automatic answering. This pause is
  documentation-only; it does not rerun or alter the runtime.

## Latest operator correction and operational state

The operator explicitly clarified: **the watch works well in Guardian; the
connection problem is with AnyTracking**. Do not reinterpret this as a current
watch-to-Guardian outage. Whether AnyTracking cannot log in/reach its server or
can log in but shows the device offline has not been answered; leave that open.

The supplied AnyTracking screenshot shows Answer mode with Press to answer
selected and Handsfree auto answer available. It matches the two-option dialog
found in the inspected app. It does not establish its app version, the pilot's
numeric server model, fresh watch state, successful command delivery or physical
auto-answer. A stored/default selection is possible. The screenshot and raw
contact/status data are not republished.

No supplier-platform routing, native-app setting change or reference call test
has been reported. No relay or forwarding tool has been enabled. The latest
requested answer-mode command was Manual; final physical Manual behavior after
the latest reboot has not been separately reported. Do not claim either Auto or
Manual is a verified current setting from the CONFIG field.

Pausing this PR does not change watch settings, caller restrictions, ngrok,
Guardian's running gateway, the separate wellness routine or alert profile.
No hardware command or account access is performed by this checkpoint.

## Physical and protocol evidence already collected

| Area | Established evidence | Limit / unresolved work |
| --- | --- | --- |
| Approved calling | Known caller rings; two-way audio previously confirmed; unknown callers blocked. Stored SOS1 privately matched the test caller; incoming screen showed the saved contact. | This does not prove all auto-answer eligibility conditions. Preserve the caller restrictions. |
| Sound + vibration | Operator observed both and pressed to answer. | Matching profile,1 downlink not supplied for that observation. |
| Sound-only | Operator reported sound without vibration and a successful fresh retest after queue recovery. | Fresh profile,2 downlink not supplied with the retest. |
| Vibration-only | Fresh profile,3 handoff, reply, and operator-confirmed expected result after gateway restart. | Incoming-call acceptance only; not every reminder/output. |
| Silent / temporary expiry | Existing controls/scaffold reviewed. | Physical silent acceptance and automatic expiry/restoration remain incomplete. |
| Auto, normal framing | Documented APPLOCK,JT-0 handed off and replied; call kept ringing. | Handoff/reply is not applied-state proof. |
| Auto, exact supplier framing | Lowercase 000c trial and genuinely bare APPLOCK reply captured; caller recognized; call still rang. | No demonstrated formatting fix. |
| Auto after RESET | Lowercase Auto, reply, RESET and fresh startup observed; operator reports Auto still failed. | Exact call timestamp/ring count and visible boot were not separately supplied. |
| Manual after RESET | Manual handoff/reply, RESET handoff, new startup and CONFIG captured. | Final physical manual-answer observation after this reboot is still missing. |

Pilot firmware labels, obtained by VERNO:
- `C403H_RFHZ_V52_EN_750_V1.3_2025.03.10_18.29.29`
- `C403H_RFHZ_V52_EN_04R6_V1.3_2025.03.10_18.29.29`

The supplier communication example labels APPLOCK,JT-0 as Auto and APPLOCK,JT-1
as Manual. Both contain 12 ASCII payload bytes. Normal 000C and supplier 000c
differ only in hexadecimal letter case; both have failed physically in Auto.
There was no extra BOM, terminator or checksum in Guardian's compared frames.
Do not retry cosmetic variations or reverse the mapping without new evidence.

Key event times on **21 September 2026, UTC** (Mauritius = UTC+4):

| Event | Time |
| --- | --- |
| Exact supplier Auto request / bare reply | 19:37:28.514 / 19:37:28.889 |
| Auto reply before restart trial | 20:02:37.767 |
| Post-Auto startup CONFIG | 20:04:11.834 — reported JT:0 |
| Manual request / bare reply | 20:06:21.456 / 20:06:23.059 |
| RESET request after Manual | 20:13:49.251 |
| Post-Manual startup CONFIG | 20:16:11.061 — reported JT:0 |
| Subsequent reconnect / fresh session | 20:17:01.015 |

Both CONFIG observations explicitly have meaningVerified:false and
appliedStateVerified:false. The unchanged value cannot distinguish a static
field, an ignored request or a non-persistent setting. It does not prove that
Auto is enabled, Manual was ignored, or this firmware lacks the feature.
Voice calls bypass the gateway, so telemetry cannot prove answering/audio.

## Diagnostic code that is already on the branch

- Bounded APPLOCK reply summaries: receive time, bare/parameterized distinction,
  argument count, allowlisted values and truncation; arbitrary values redacted.
  Earlier logger output discarded arguments, so historical "bare" claims were
  corrected rather than retroactively treated as measured.
- Passive CONFIG JT extraction retains valid 0/1 observations without assigning
  verified meaning or applied state.
- `gateway/scripts/trial-answer-mode.js`: explicit target, auto/manual and
  supplier/current framing, preview by default; authenticated local HTTP send
  only with --send; verifies reported bytes; no automatic retry.
- `gateway/scripts/send-reset.js`: explicit target, preview by default,
  authenticated local send of documented RESET only; no factory reset,
  no automatic retry and no assertion that handoff proves restart.
- The supplier framing override is restricted to the documented JT commands.
  Normal production framing and customer controls were not changed.

The initial profile failures included Firestore requests stuck pending. A manual
gateway restart resumed processing; old requests then failed before the watch
reconnected. A fresh profile,3 request subsequently worked. Direct answer-mode
trials have their own actual handoff/reply evidence and are not explained away by
that old queue blockage. Automatic listener recovery remains separate draft
PR #138; it is not implemented by this PR.

Startup audit found that Guardian already emits same-command ACKs for
appcontacttel, APPANDFNREPORT and eicard through its unknown-command fallback.
CONFIG gets CONFIG,1; APPLOCK replies intentionally receive no further ACK.
No missing startup reply or automatic JT-1 overwrite was demonstrated.

## Official-app investigation and what remains unknown

Public official AnyTracking APK 5.2.94 was inspected statically, without logging
in or calling a device API. Its two-choice dialog uses the server API
SendCommandByAPP with CommandType ANS and parameter 0 for Press to answer or 1
for Handsfree auto answer. It reads an ans field from server settings.

Those API values are **not a V52 TCP/SMS command definition**. Model selection
and ANS-to-wire translation happen outside the inspected dialog; the server may
send the same APPLOCK command or a different exchange. Neither has been
established. Do not send guessed ANS commands, invert JT based on these values,
or use another model's commands. Package fingerprint, official download links,
static-analysis anchors and limits are in the linked comparison document; no
proprietary APK or decompiled source is committed.

## Resume sequence, only when the operator returns to #115

1. Read this checkpoint and the linked evidence before suggesting more tests.
   Reconcile the branch with current main at that time; do not assume today's
   CI or tunnel address is still current.
2. Establish the specific AnyTracking access problem. Guardian connectivity is
   confirmed by the operator; do not restart/reprovision a working setup merely
   because AnyTracking is unavailable.
3. If the operator chooses the prepared native-platform comparison, confirm
   their own app access, prepare the exact current return-server SMS, and obtain
   agreement before routing watch telemetry temporarily to the supplier. That
   trial pauses Guardian's live telemetry; keep existing contacts/restrictions.
4. Test the same watch/SIM/caller through the official app. If Auto works,
   prepare an authorized, bounded capture of the actual supplier-to-watch
   exchange before changing Guardian's command. If it fails or cannot connect,
   preserve the result without declaring the hardware unsupported.
5. Verify manual-answer restoration, return to Guardian and fresh telemetry.
   Update physical acceptance separately from API success and command replies.
6. Finish the remaining alert-style, requested-versus-applied UI and temporary
   silent-restoration scope before considering this PR complete or mergeable.

No additional command is requested by the pause. Auto-answer is **not passed**.

## Work selected next: PR #118

The operator reports that Jett has replied and wants to resume PR #118.
The reply text/image has not yet been supplied in this conversation at this
checkpoint; do not invent its content or mark a command definition resolved.

Existing #118 checkpoint: REMIND once-only sound and visible clearing passed;
local SEDENTARY speech was heard three times with unknown timing; HSW remains
untested. Review the supplier's actual response against the exact pilot firmware
before defining remote enable/change/off tests. Leave #115 paused meanwhile.
