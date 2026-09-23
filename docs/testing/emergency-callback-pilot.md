# SOS and fall handsfree callback pilot

Implemented on draft PR #115; hardware acceptance remains open. Normal app
Auto/Manual and the two-caller comparison have passed on Jesh. An actual SOS
or fall triggering this new five-minute policy has not yet been tested.

## What is built

- Calls → **Handsfree after SOS or fall**, separate owner opt-in. Enabling first
  requests the proven Manual sequence. It arms only after both watch replies.
- A fresh decoded V52 SOS or fall opens one five-minute window for the existing
  captured Auto number. The owner's primary alert contact must match that
  number. Other alert recipients and phonebook permissions are unchanged.
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

## WhatsApp fall call button

Existing approved SOS callback templates and notification recipient selection
remain unchanged. All entitled recipients can still receive alerts; only the
configured callback number was proven to auto-answer in the two-phone pilot.

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
