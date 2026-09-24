# SOS and fall handsfree callback pilot

Implemented on draft PR #115. After the bounded reconnect fix in `aa41f37`, the
operator confirmed SOS WhatsApp delivery, automatic answering on the callback,
and normal ringing on a call after five minutes. This accepts that SOS cycle on
Jesh for the tested caller. Normal app Auto/Manual and the earlier two-caller
comparison also passed. On 24 September at 14:25 MUT, an uncancelled fall
produced a recorded `00200000` alarm, delivered WhatsApp and a watch reply to
Auto. The operator then confirmed the callback auto-answered. Two-way audio
for that call and fall-window restoration are still unreported. Broader recovery
checks remain open. See the evidence below.

## What is built

- Calls → **Handsfree after SOS or fall**, separate owner opt-in. Enabling first
  requests the proven Manual sequence. It arms only after both watch replies.
- A fresh decoded V52 SOS or fall opens one five-minute window for the existing
  captured Auto number. The owner's primary alert contact must match that
  number. Other alert recipients and phonebook permissions are unchanged.
- Before writing Auto, the gateway can wait for a newly identified connection
  within the original thirty-second start deadline. It probes at most two
  different sockets, requires a firmware reply on the chosen socket and checks
  current authorization/cancellation before writing. It never repeats Auto
  after any setting write or extends the five-minute incident window.
- The watch cannot distinguish an alert-button call from another call by that
  same number. All its incoming calls during the window can auto-answer.
- Duplicate alarms do not extend the window. An explicit **Send Manual setting**
  ends the current window. Turning emergency answering off also restores Manual.
- A private, durable restoration job exists before Auto is written. Gateway
  startup and ten-second recovery scans retry Manual with backoff (up to one
  attempt per minute) until the watch replies. They never replay uncertain Auto.
- An offline watch can stay in Auto beyond five minutes: there is no proven
  device-side expiry. The app shows restoration pending until receipt. A watch
  reply remains receipt evidence, not proof of ringing, speech or applied state.
- Everyday Auto is unavailable while this policy is on or restoration is
  pending. Normal incoming calls therefore return to Manual after recovery.

This is a caller-number policy using the exact accepted capture, not an
inference that every SOS1 contact automatically gains Auto. The pilot's primary
SOS, primary alert contact and captured Auto number coincide. Changing a primary
alert contact blocks new Auto windows until operator setup matches; it does not
retarget captured bytes, rewrite phonebook entries or alter the watch's outgoing
SOS/fall dial configuration. Test scope on additional firmware/numbers before
broad rollout. The final physical state reported before this change was Manual.

## Install for Jesh (PowerShell)

Pull the draft branch while preserving the unrelated untracked news-review file:

```powershell
cd C:\Users\MSI\repos\guardian
git pull --ff-only origin feat/v52-watch-modes
firebase deploy --only firestore:rules,firestore:indexes
cd gateway
node scripts/configure-emergency-calls.js --imei 861397052547492
node scripts/configure-emergency-calls.js --imei 861397052547492 --apply
```

The setup script reuses the private capture already installed for Calls. It
resolves the **unique linked service owner** whose primary alert number matches
that capture. It sends no watch command and leaves the feature off. If it reports
`primary_owner_ambiguous`, inspect the owner account and supply
`--manager-uid <Firebase-owner-UID>`; it will still check the phone match,
subscription, device identity and capture revision. Never paste a capture/phone
into a public issue or create a guessed ACALL command.

Restart the gateway (`npm start`) and rebuild/restart Flutter. Existing Guardian
routing stays in place; no AnyTracking recorder/tunnel change is needed.

1. Open Jesh → Watch settings → Calls → **Set up emergency answering**.
2. Review the primary hint and enable. Wait for **Watch replied to Manual**.
3. Confirm an ordinary call from each approved test phone rings manually.
4. In a supervised test, trigger a real watch SOS. Normal app/WhatsApp alerts must
   arrive independently of call-mode success. Wait for **Watch replied to Auto**
   before expecting handsfree answering; calls remain possible while it prepares.
5. Call from the primary phone: verify Auto and two-way audio. Call from the
   approved second phone: verify it still waits for a tap. Record call timestamps.
6. After five minutes, wait for **Watch replied to Manual**, then call the primary
   again: it must ring until answered. Confirm audio after answering.
7. Repeat using a controlled fall test without putting the wearer at risk. Verify
   existing fall settings, notification wording and frozen location are preserved.
8. Test gateway restart and a temporary lost connection during a window: the app
   must show restoration pending, then Manual after recovery. Do not interpret the
   elapsed countdown as proof the watch stopped auto-answering. Check whether a
   Manual change during an ongoing call interrupts it; this is not yet measured.

Record: watch firmware, alert source/receipt time, primary/second caller outcome,
Auto/Manual reply timestamps, audio, callback-window end and restore result.
Normal alert notification must still work if Auto fails, the owner has no active
Family/Care service, or the gateway cannot verify a fresh alarm time. Buffered
alarms, malformed/missing source time and source time more than two minutes old
cannot open a window. A queued Auto attempt expires after thirty seconds.
App-created alerts never enable this device setting. No synthetic live alert is
sent by installation or setup.

## First SOS attempt: 24 September, 01:53 MUT

The operator received the existing SOS WhatsApp message and called the watch;
the app did not show Auto, and the untouched watch kept ringing. Supplied logs
identify the failure before any Auto write:

| UTC on 23 September | Evidence |
| --- | --- |
| 21:53:15–16 | Full-layout `AL_LTE` SOS, state `00010000`; emergency outcome `admitted` |
| 21:53:16.944 | Auto starts read-only connection check on connection 1 |
| 21:53:20.945 | No firmware reply within four seconds; `connection_unconfirmed`, `reply_timeout` |
| 21:53:22–26 | Manual recovery also fails preflight on connection 1 |
| 21:53:38.379 | New watch connection 2 arrives, about 23 seconds after SOS receipt |
| 21:53:43–45 | Connection 2 replies to the check, then both Manual commands |

This is a preflight/reconnect gap, not a rejected Auto setting: there is no Auto
`awaiting_watch_replies` or Auto ACALL write in this attempt. The logs do not
establish why the first connection stopped replying. The fix waits for that
replacement connection only before a setting write and within the already
authorized start deadline. A regression models the 23-second replacement and
checks one captured Auto write on the checked replacement socket, expiry,
cancellation, identity mismatches and no replay after uncertain delivery.

For further retests, pull and restart the gateway. No Flutter rebuild, database
redeploy, preference reconfiguration or template replacement is required for
this fix. Keep emergency answering enabled and verify its ready status, then
trigger one fresh SOS. Look for `waiting_for_connection` if preflight fails,
followed by `connection_checked`, `awaiting_watch_replies` and `watch_replied`
for Auto. Record the physical primary/second caller result and Manual expiry
result separately. Notification delivery must continue while preflight waits.

## Successful SOS retest: 24 September MUT

Following the reconnect fix, the operator reported that the SOS WhatsApp
message arrived and the callback automatically answered. The supplied Calls
screenshot shows `Watch replied to Auto. Returning to Manual in 2m 39s` in
the emergency card. The everyday Manual selection remained selected below;
that selection was not the emergency state. The operator subsequently reported:
`it works. after 5 mins, the watch kept ringing` in response to the planned
post-window primary-phone call. Record normal ringing after the window as a
physical observation, not an inference from a command reply.

Accepted for this Jesh pilot: real SOS notification, handsfree callback and
return to normal ringing after approximately five minutes. Exact retest/call
timestamps and two-way audio for this particular emergency call were not
provided. The earlier two-phone scope test remains separate; the second caller
was not retested within this SOS window. Fall activation, offline/restart
restoration and a window expiring during an ongoing call still need acceptance.
This does not establish a device-side expiry when Guardian cannot reconnect.

UI follow-up proposed, not implemented: replace the confusing everyday
Manual/Auto controls and duplicate request-status card in the customer flow
with one emergency preference, a single callback-window status, and an End
handsfree now action that restores Manual while preserving future emergency
opt-in. Retain an honest restoration-pending state if the watch is offline.

## Uncancelled fall upload and Auto reply: 24 September, 14:25 MUT

The earlier morning test was cancelled on the watch when ringing started; the
read-only database check found no new alert of any type. The operator repeated
the test following instructions to leave the watch warning untouched. The new
logs show a full-layout `AL_LTE` alarm, `type=fall`, `state=00200000`, `fields=25`.
This provides direct raw-state evidence for bit 21 on this pilot, beyond the
older database row that also recorded `00200000` as fall.

| UTC on 24 September | Observed result |
| --- | --- |
| Approximately 10:25:09 | Fall persisted; emergency outcome `admitted` |
| 10:25:09.605 | Auto connection preflight starts |
| 10:25:10.010 | Same connection verified by firmware reply |
| 10:25:10.676 | One captured Auto frame sent; waiting for ACALL |
| 10:25:11.700 | ACALL reply received; `watch_replied` |
| Following lines | Primary WhatsApp `wa=ok`; Meta `sent` then `delivered` |

The operator supplied the received WhatsApp screenshot at 14:25 MUT. It says
possible fall, identifies the position as approximate cell-tower positioning,
and shows a View location button only. No Call watch button is present in that
delivered template. Its delivery works independently of Auto activation; a
direct call from the configured primary number can test the current window.
The exact template name was not included in the logs/screenshot.

The operator subsequently reported `it auto answers`, physically confirming
the fall-triggered callback on Jesh. No new audio or expiry result accompanied
that report.

One other contact logged `wa=fail`; the primary's successful delivery does not
establish delivery to every contact. The provider error for that recipient was
not included. Two-way audio and Manual after this specific fall window still
require operator confirmation. Earlier cancellation
is consistent with the missing first upload, but the exact firmware cancellation
cutoff is not established by this comparison.

## WhatsApp fall call button

Existing approved SOS callback templates and notification recipient selection
remain unchanged. All entitled recipients can still receive alerts; only the
configured callback number was proven to auto-answer in the two-phone pilot.
The 01:53 MUT test confirms the existing SOS message and Call watch button are
delivered. Auto is triggered by watch alarm ingress, not template selection or
the button tap. New templates are not required for handsfree answering itself.
If suitable fall templates with a Call watch button already exist, verify their
approved names and component layout before mapping them instead of submitting
duplicate variants. The live Meta inventory has not been inspected here.

The following **fall variants are implemented but not claimed Meta-approved**:

| Location state | Template name | Buttons in order |
| --- | --- | --- |
| Fresh | `guardian_fall_callback_alert_v1` | Call watch; View location |
| Last known | `guardian_fall_callback_last_location_v1` | Call watch; View last known location |
| Unavailable | `guardian_fall_callback_unavailable_v1` | Call watch |

Prepare each English template in Meta with the existing four fall body values:

```text
GUARDIAN FALL ALERT

{{1}}
Time: {{2}}
{{3}}
{{4}}

Please call the watch to check on the wearer.
```

Body examples for review (synthetic): `A fall alert was received for Alex.`;
`24 September, 09:30`; `Approximate location near home · recorded 1 min before fall`;
`Watch online · battery 80%`. Use `Last known location: ...` for the second
variant and `Location unavailable when the fall was reported` for unavailable.
Do not say the wearer pressed SOS or promise the call will auto-answer.

The Call watch button is a **static phone button for the watch SIM**, never the
primary guardian's phone. The optional map URL is
`https://maps.google.com/?q={{1}}`, e.g. `-20.029192,57.5959408`. It is button index
1 because the phone button is index 0. Keep the existing frozen fall-location
values and do not insert a map for unavailable location.

Only after all three variants are approved for that exact watch SIM, configure:

```text
META_WHATSAPP_FALL_CALLBACK_PILOT_IMEI=861397052547492
META_WHATSAPP_FALL_CALLBACK_PILOT_NUMBER=<watch SIM in international format>
```

Both must match the device's IMEI/SIM; otherwise existing approved fall templates
continue. SOS approval/configuration cannot enable these fall variants. These
buttons initiate ordinary incoming calls; they do not signal a special call tag
to the watch or provide a call-ended event to Guardian.
