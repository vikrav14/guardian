# Watch answering and SOS callbacks: proposed product design

Status: **SOS-only behavior remains a proposal for draft PR #115.**
Manual/Auto Calls settings and a per-device authorized request path are now
implemented; see [Calls setup and app acceptance](watch-calls-app.md).
This does not implement an emergency window or automatic restoration.
The user asks for ordinary calls to require manual answering and an option
for automatic answering when a guardian calls during an SOS. This document
preserves that requested outcome and the implementation constraints; it does
not treat proposed defaults, duration or UI copy as approved final behavior.

## Evidence available

- Reference auto-answer with two-way audio was reported on 22 September.
- On 23 September, AnyTracking sent 3G APPLOCK,JT-0 then 3G ACALL,0 after the
  operator selected Manual. Both commands received bare replies; four private
  records were saved. After reported Guardian return, an incoming call kept
  ringing until manual answering, then audio worked both ways.
- A subsequent reference run at approximately 21:04/21:05 Mauritius time
  passed Auto (two-way audio) and Manual (kept ringing) respectively. Auto
  sent a 3G ACALL frame with 19 payload bytes. All six private records have now
  been decoded: the Auto argument is the configured guardian number in `00…`
  format, matching the earlier center/SOS1 report. The exact private value
  remains outside the repository. An authenticated captured-frame Guardian
  trial is implemented. The operator subsequently ran Auto then Manual through
  Guardian and confirmed both expected call outcomes. Manual was tested last.
  No exact call timestamps/durations were supplied for that Guardian run.
  No ACALL value is inferred by inversion.
- The observed Manual pair contains no caller identity, SOS incident identifier or
  expiry parameter. Treat a device-wide persistent switch as the conservative
  working assumption until firmware behavior is tested. A per-caller or
  call-end hook has not been established.

Detailed evidence: [Manual capture](../testing/answer-mode-manual-capture-20260923.md).

## Proposed app experience

Place **Calls** in Watch settings alongside existing communication preferences.

| Preference / situation | Intended behavior, subject to hardware validation |
| --- | --- |
| Normal calls | Press to answer by default; preserve the selected sound/vibration profile |
| Handsfree answering during SOS | Separate informed opt-in, off until chosen and the feature is verified |
| Valid SOS with the option enabled | Request a short handsfree callback window while alerting the guardian |
| Window finished or incident closed | Restore the normal Manual setting; expose any pending restoration |

A two-minute window is only an example for pilot design, not a selected product
duration or a proven watch timeout. Avoid an always-on Auto default. If a
general Auto preference is later offered, it needs its own informed choice
and verified behavior; it is not needed to meet this emergency-focused request.

Explain the wearer-facing consequence before opt-in: an approved caller may
connect without a tap during an active handsfree window. Do not present this
as silent monitoring. The on-watch sound/indication is another physical check;
do not invent an announcement the firmware has not demonstrated.

Show requested configuration separately from command handoff and any verified
device state. Appropriate states include preparing, request sent, restoration
pending and failed. An ACK alone must not turn into "auto-answer confirmed".
A countdown is a server policy deadline, not proof that the watch has reverted.

## Integration with the existing SOS callback flow

The reviewed gateway has deterministic SOS notification planning, a callback
template variant with a static PHONE_NUMBER button, and pilot eligibility
checks. Main and feat/v52-callback-sos contain the same sos-whatsapp.js at this
review. The existing callback code does not implement answer-mode switching
or establish incoming caller/call-ended telemetry.

Proposed sequence:

1. Receive a valid SOS incident from the linked watch and check the stored
   emergency-handsfree preference, authorization and supported firmware.
2. Send the normal SOS notification immediately. Request the answer-mode window
   independently; command failure must not suppress or delay the safety alert.
   Keep the existing call action available.
3. Use an observed and physically accepted Auto sequence over a live connection.
   If the watch is unreachable, report that the request was not handed off;
   never deliver an expired Auto request later on reconnection.
4. A guardian calls the SIM normally, including through the callback button.
   Do not assume tapping that static phone button produces a backend event or
   identifies which approved caller will call.
5. On policy expiry or incident closure, request the prior normal Manual setting.
   Do not claim restoration on call end unless a dependable call-end signal
   has been established. Test whether changing mode affects an ongoing call.

Actual SOS callback acceptance must include the watch's behavior while handling
its own SOS (including any outbound dial attempt), not only an idle-watch call.
Preserve the callback-SOS project's existing scope; do not guess a new alarm
mode or change carrier/caller configuration to make this test pass.

## Two constraints that must stay visible

**Caller scope:** Auto's number-bearing argument suggests a selected caller,
but the one successful call does not prove exclusivity. It does not distinguish
an emergency call from an ordinary SIM call from that same number.
Other firmware-eligible approved callers might also auto-connect during the
window. Retain approved-caller restrictions and test their interaction with
Auto. Do not temporarily open the watch to unknown callers or change its
phonebook/SOS contacts as part of answer-mode switching.

**Offline restoration:** A backend timer cannot transmit Manual to an offline
watch. The switch may remain active beyond the requested window, including
while voice works but data does not. Store restoration intent durably, show
restoration pending, and reconcile on reconnect or gateway restart. Do not
claim a guaranteed hard expiry without a proven device-enforced timeout.
The product must resolve and explicitly describe this behavior before promising
"normal calls are always manual outside SOS".

## Product implementation after Guardian hardware acceptance

- Implemented for explicit app requests: typed, authorized answer-mode requests
  with backend-owned captured frames and caller configuration, device leases,
  stale-intent rejection and no automatic replay. No guessed SMS fallback.
  SOS window generation and reconciliation still require separate implementation.
- Serialize the multi-command mode transition per device. Keep request, each
  handoff, each reply, and applied-state evidence separate; define partial
  transition handling and bounded recovery before replay.
- Store each emergency window with its device, incident, request generation,
  actor, baseline normal mode, requested expiry and restoration state.
- Coalesce duplicate packets for the same SOS incident without indefinitely
  extending the window. The existing in-memory 90-second notification
  deduplication is not a durable mode-restoration mechanism.
- Fence stale requests/timers so an old expiry or delayed enable cannot
  override newer intent. Preserve an explicit authorized Manual override.
- Reconcile durable restoration on reconnect/startup, audit remote changes and
  keep the UI honest about offline or unknown state. Do not disable ordinary
  incoming calls or SOS notification delivery if handsfree setup fails.

## Verification order

1. Completed: decode and validate the six saved private records. The narrow
   operator replay is available in the [Guardian trial runbook](../testing/answer-mode-captured-trial.md).
2. Completed on the existing pilot: the operator ran Guardian's exact captured
   Auto then Manual sequences and confirmed both expected physical outcomes.
   This does not establish every firmware, initial state or caller restriction.
3. Verify the selected caller scope and unknown-caller rejection in both modes.
4. Test a real supervised SOS callback, duplicates, immediate/late calls,
   expiry during an ongoing call, disconnect, restart and restoration failure.
5. Validate authorization, stale-command rejection, transition ordering and
   durable reconciliation in software tests. Physical gates remain separate.
6. Complete the Calls UI-to-watch acceptance on the configured pilot. Its explicit
   Auto/Manual requests do not yet implement SOS-only behavior. Final SOS copy and
   customer enablement follow the remaining scope/restoration checks.


