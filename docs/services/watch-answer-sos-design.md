# Watch answering and SOS/fall callbacks: proposed product design

Status: **SOS/fall-triggered answering remains a proposal for draft PR #115.**
Manual/Auto Calls settings and a per-device authorized request path are now
implemented; see [Calls setup and app acceptance](watch-calls-app.md).
This does not implement an emergency window or automatic restoration.
The user asks for ordinary calls to require manual answering and an option
for automatic answering when a guardian calls during an SOS, extended on
23 September to fall alerts and their WhatsApp call button. This document
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
  Guardian and confirmed both expected call outcomes in that helper trial.
  The updated Calls app subsequently passed the operator's retest: Manual
  replied at 18:46:18.771 UTC, then Auto at 18:47:06.455 UTC on 23 September.
  Auto was requested last in the latest supplied logs. No exact call
  timestamps/durations were supplied for that app run.
  No ACALL value is inferred by inversion.
- The observed Manual pair contains no caller identity, SOS incident identifier or
  expiry parameter. The later second-caller comparison supports caller-specific
  Auto behavior on the pilot: both approved phones rang in Manual; the original
  configured caller auto-answered in Auto while the second phone kept ringing.
  Enabling Auto from the second handset still uses the original backend-owned
  caller configuration. See the [physical record](../testing/watch-caller-scope-20260924.md).
  A call-end hook, multiple Auto numbers and device-enforced expiry remain
  unestablished. A subsequent operator update confirms Manual has already been
  set; no repeat Manual request is needed. No separate post-restoration call
  result was supplied with that update.

Detailed evidence: [Manual capture](../testing/answer-mode-manual-capture-20260923.md).

## Repository review — 23 September 2026

Reviewed PR #115 at `25b754a` against its main base `4386b0d`. This review
changes the design only; it sends no watch command or Meta message and does
not submit or edit a live template.

| Existing path | What the repository implements | Missing emergency behavior |
| --- | --- | --- |
| SOS WhatsApp | Three callback templates; static Call watch at index 0, map URL at index 1 when location exists; exact pilot IMEI/SIM guard | No automatic answer-mode request |
| Fall WhatsApp | guardian_fall_alert_v1, guardian_fall_last_location_v1 and guardian_fall_unavailable_v1; map at index 0 or no map | No callback template selection or call-button guard |
| App SOS and fall detail | Call watch uses the saved SIM through tel: | No incident-bound mode preparation |
| Watch settings → Calls | Explicit Auto/Manual requests, checked connection and bounded reply wait | No emergency policy, incident window or restoration worker |

Sources: `gateway/src/guardian-sos-plan.js`, `sos-whatsapp.js`,
`guardian-fall-plan.js`, `fall-whatsapp.js`, `notify.js`, `firestore.js`,
`watch-calls.js`, and `apps/mobile/lib/services/watch_call_actions.dart`.
The app already exposes calling for both incident types; the extra fall call
button is needed in WhatsApp.

Live Meta template definitions/status and the operator's running environment
were not accessible in this review. Existing SOS callback templates are
reported in use by the operator. The code and repository documentation specify
map-only fall templates; live approval or template contents must not be
inferred from their names.

### Preserve existing SOS templates; add fall callback variants

Proposed new names below are **not submitted or approved**:

| Fall location evidence | Proposed template | Button layout |
| --- | --- | --- |
| Fresh | guardian_fall_callback_alert_v1 | 0: Call watch; 1: View location |
| Last known | guardian_fall_callback_last_location_v1 | 0: Call watch; 1: View last known location |
| Unavailable | guardian_fall_callback_unavailable_v1 | 0: Call watch |

Keep the four existing body parameters and frozen fall-location snapshot.
Use fall wording (a fall alert was received; please call/check on the wearer),
never the SOS phrase claiming they pressed a button. No location must still
allow calling. Retain the current fall templates until the corresponding
callback templates are confirmed approved for the pilot's exact watch SIM.
Add a separate fall template gate; do not activate it merely because the SOS
gate matches. Unknown/mismatched SIMs retain the standard template.

The static phone destination belongs to the approved template, not an arbitrary
per-message watch number. Preserve exact device/SIM matching. A future fleet
needs a per-watch destination solution, such as an authenticated dynamic
incident link; never reuse Jesh's phone button for another watch.

### What the current button can and cannot trigger

A phone-number CTA hands a normal call to the phone dialer. The current Meta
webhook/parser and app tel: path supply no trusted incident-specific call-start
or call-end signal. Meta's official button webhook reference describes
quick-reply messages; it must not be treated as receipt of a phone-button tap.
A message delivered/read status is also not a call-start signal.

Therefore the compatible design arms Auto when a fresh trusted SOS/fall
incident is accepted, independently of the existing notification dispatch.
Calls arriving before that command is received may still ring manually; an
old WhatsApp message clicked after expiry must not silently re-arm Auto.

During a window the firmware cannot be assumed to distinguish a call dialed
from that message from an ordinary call from the same number. A different
URL/quick-reply action could provide explicit preparation and readiness before
dialing, but would change the template/user flow and still would not establish
a device-enforced one-call mode. Do not promise only the exact WhatsApp-originated
call will auto-answer.

Official reference checked:
[Button messages webhook reference](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/button).
The official indexed excerpt describes quick-reply triggers; full-page fetching
was rate-limited during this review. Claims about the current Guardian flow
above are grounded in its source, not in an invented provider callback.

## Proposed app experience

Place **Calls** in Watch settings alongside existing communication preferences.

| Preference / situation | Intended behavior, subject to hardware validation |
| --- | --- |
| Normal calls | Press to answer by default; preserve the selected sound/vibration profile |
| Handsfree answering during SOS or fall | Separate informed opt-in, off until chosen and the feature is verified |
| Fresh trusted SOS/fall with the option enabled | Request a short handsfree callback window while alerting the guardian |
| Window finished or incident closed | Restore the normal Manual setting; expose any pending restoration |

A five-minute callback window is a proposed pilot default, not yet an enabled
setting or a proven watch timeout. The implementation must configure the
selected duration explicitly and show its deadline. Avoid an always-on Auto default.
The existing general Auto preference keeps its separate informed choice;
it does not grant consent to incident-triggered automation.

Explain the wearer-facing consequence before opt-in: an approved caller may
connect without a tap during an active handsfree window. Do not present this
as silent monitoring. The on-watch sound/indication is another physical check;
do not invent an announcement the firmware has not demonstrated.

Show requested configuration separately from command handoff and any verified
device state. Appropriate states include preparing, request sent, restoration
pending and failed. An ACK alone must not turn into "auto-answer confirmed".
A countdown is a server policy deadline, not proof that the watch has reverted.

## Integration with the existing SOS and fall flows

The reviewed gateway has deterministic SOS notification planning, a callback
template variant with a static PHONE_NUMBER button, and pilot eligibility
checks. The existing callback code does not implement answer-mode switching
or establish incoming caller/call-ended telemetry.

Proposed sequence:

1. Receive a fresh trusted SOS/fall incident from the linked watch and check the stored
   emergency-handsfree preference, authorization and supported firmware.
2. Send the normal SOS/fall notification immediately. Request the answer-mode window
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
its own SOS (including any outbound dial attempt), not only an idle-watch call. Also test a fall callback while preserving its
existing fall alarm and auto-dial settings.
Preserve the callback-SOS project's existing scope; do not guess a new alarm
mode or change carrier/caller configuration to make this test pass.

## Two constraints that must stay visible

**Caller scope:** The two-phone pilot now demonstrates differentiated behavior:
Auto answers the configured original caller while the second approved caller
rings manually. This supports a callback policy scoped to that configured
number; it does not establish every SOS/family caller or unknown-caller behavior
under Auto. It does not distinguish an emergency call from an ordinary SIM call
from the same number. The tested original number is also the primary contact;
the comparison does not isolate ACALL-number matching from primary/SOS-role
eligibility. Do not claim either is the sole firmware rule. Retain approved-caller restrictions. Do not temporarily
open the watch to unknown callers or change its phonebook/SOS contacts as part
of answer-mode switching.

**Offline restoration:** A backend timer cannot transmit Manual to an offline
watch. The switch may remain active beyond the requested window, including
while voice works but data does not. Store restoration intent durably, show
restoration pending, and reconcile on reconnect or gateway restart. Do not
claim a guaranteed hard expiry without a proven device-enforced timeout.
The product must resolve and explicitly describe this behavior before promising
"normal calls are always manual outside SOS".

## Concrete implementation sequence

1. **Trusted incident origin and policy.** Add backend-owned provenance for
   accepted watch SOS/fall events. Current clients can create SOS alerts and
   their payload is not a trusted origin marker: do not arm the watch merely
   because alerts.type is sos or payload.source claims watch. App help alerts
   need a separately authorized, explicitly designed trigger. Store per-device
   emergency opt-in, consent revision, event types and bounded callback duration.
   Existing general Auto consent must not silently grant emergency automation.
2. **Shared transition ownership.** Reuse the tested capture and transport, with
   a shared transactional lease/generation across app requests and emergency
   transitions. Backend emergency actions must not impersonate a guardian or
   bypass request validation. Start with the verified configured caller; sending
   a WhatsApp alert to other contacts does not prove their calls auto-answer.
3. **Durable restoration first.** Before Auto handoff, persist the window,
   baseline normal preference and restoration obligation. Use separate
   preparing, reply_observed, unconfirmed, restoration_pending and restored_receipt
   states. A user Manual request cancels the window and supersedes stale Auto.
   An explicit newer user choice supersedes stale expiry work. Restoring Manual
   automatically is appropriate for a normal-Manual policy; do not overwrite a
   deliberately chosen normal-Auto preference using an older timer.
4. **Notifications remain independent.** Dispatch existing push/WhatsApp alerts
   without waiting on the watch command. Connection failure leaves normal
   calling available. Never claim auto-answer readiness in the alert merely
   because Auto was requested. Expose the preparation/receipt status in the app.
5. **Expiry, resolution and recovery.** Durable startup/reconnect processing
   handles pending restoration before allowing a new automatic enable. Reject
   stale Auto; do not replay it on reconnect. Duplicated SOS/fall packets and
   concurrent alerts must not restart a countdown indefinitely. Use incident
   IDs plus bounded durable coalescing; the current 90-second in-memory SOS
   dedupe and always-accepted fall packets are insufficient for this job.
   Expiry/closure requests the baseline and waits for its expected replies.
   No reliable call-end signal exists in the current parser.
6. **Fall WhatsApp variants.** Add the separately gated template selection
   described above, keeping current alerts available while approval is pending.
   Do not edit already-working SOS templates to ship fall support.

Manual restoration retry/reconciliation requires deliberate bounded recovery
semantics; the current explicit-request watcher intentionally never replays a
claimed setting. Do not simply turn on generic retries. Pending restoration
must survive gateway sleep/crash and remain visible until reconciled.

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
3. Completed for the original vs second approved caller on the pilot: both ring
   in Manual, only the original auto-answers in Auto. Unknown-caller rejection
   under Auto and second-caller audio remain pending. Manual has subsequently
   been set according to the operator; do not ask for a duplicate setting change.
4. Test real supervised SOS and fall callbacks, duplicates, immediate/late calls,
   expiry during an ongoing call, disconnect, restart and restoration failure.
5. Validate authorization, stale-command rejection, transition ordering and
   durable reconciliation in software tests. Physical gates remain separate.
6. Completed on the configured pilot: explicit Calls UI-to-watch Auto/Manual
   retest. This does not yet implement incident-triggered answering. Final
   emergency copy and enablement follow the scope/restoration checks.
