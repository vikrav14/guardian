# V52 sedentary source audit - 29 September 2026

PR #118 remains draft. This is a review of five original supplier PDFs supplied
again by the operator, the current sender, and the overnight and midday captures.
It does not establish that remote reminders work or change a watch setting.

## Original source inventory

Page numbers below are one-based PDF pages. Text was extracted from all five
files and the relevant command and timezone pages were checked visually.
These fingerprints identify the originals without publishing the attachments.

| Original filename | Pages | SHA-256 |
| --- | --- | --- |
| `2. V46-V48-V52 Communication Protocol.pdf` | 18 | `8f01881b9773f9ee762ceb2cc4dff9aa037abfa7a5540d6a723e1f4dd9161dbf` |
| `3. V46-V48-V52 Communication Example.pdf` | 5 | `976b5721fbde52959a62d9f8975b9faf4bf6263e4b057d1eaa72950820e73e2b` |
| `v52.pdf` | 2 | `0d2d4130ca97f7cf526de7412fb2591140ddf3c5c14d9db2153ca6a2b2e02590` |
| `V52-DataSheet.pdf` | 3 | `503c0f4f8efebbb78893f28c654f29fcf7d7e3b6dbcc374b9ba54d8285a374fd` |
| `1. Switch-Server SMS-Commands.pdf` | 1 | `dd3132d753aa89d9e67a9cd84dfcff525a42c35c5e265cbdff74c8f1f4d9281d` |

The protocol and example match the earlier recorded hashes; these are not new
firmware-specific revisions. The protocol cover is dated 2021-12-20; the pilot
previously reported firmware labels dated 2025-03-10.

## What the sources actually establish

| Source | Finding | Limit |
| --- | --- | --- |
| Example p2, sedentary interval entry | Request `[3G*9705000296*000e*SEDENTARY,1,26]`; reply `[3G*9705000296*0009*SEDENTARY]`. | One literal example; no range, worktime, readback, or menu behavior definition. |
| Protocol p7, II.20-21 | Defines REMIND clocks and gives HSW. | These sections are not SEDENTARY definitions. Neither SEDENTARY nor SEDENTARYWORKTIME appears in this protocol PDF. |
| All five PDFs | SEDENTARYWORKTIME is absent. No sedentary applied-setting query or value-bearing reply is defined. | The worktime body comes from the operator's supplier capture, not these PDFs. |
| Guide p1 and datasheet p3 | Advertise sedentary reminders as a capability. | No configuration fields, active-hours enforcement, cadence, or local/remote setting equivalence. |
| Guide p2; protocol p4, II.10 | Guide describes a default timezone of +8; protocol says the 4G version adjusts timezone from network time. | Neither establishes the current pilot clock or which clock its sedentary schedule uses. Do not guess a timezone correction. |
| Protocol p6, II.19; example p2; guide p2 | Scene mode has ring/vibration/silent choices. | Check mode and volume before an audible test; the sources do not explain Close / 0 or prove how sedentary speech interacts with every mode. |
| SMS sheet p1 | Documents provisioning/status/server commands. | No sedentary SMS command or reminder-state readback. |
| Example p3, CONFIG entry | Shows hardware/function configuration with abbreviated fields. | No definition mapping those fields to current sedentary On/Off, interval, or active hours. Do not treat an abbreviation as readback. |

The separate [Jett reply](care-reminder-supplier-reply-2026-09-22.md) supplies
1=On, 0=Off, interval in minutes without detected movement, and an audible
prompt. Those definitions are supplier evidence, not additional text in the
example PDF. A bare SEDENTARY reply carries no saved values or success code.

## Comparison with the implementation and captures

- `movementFrame` uses the same 3G prefix and lowercase, four-digit hex length
  as the example. SEDENTARY,1,26, SEDENTARY,1,20 and SEDENTARY,0,20 each contain
  14 ASCII payload bytes, so `000e` is correct. The 20-minute value is supported
  by actual AnyTracking captures; it is not an arbitrary replacement for 26.
- The captured `SEDENTARYWORKTIME,21:00-23:59,-` body contains 31 ASCII bytes
  (`001f`). The pilot's `00:30-01:15,-` variant has the same byte length. This
  verifies framing only, not time-window semantics or acceptance of every value.
- Guardian Save On sends Off, worktime, then On; it waits for a same-session
  bare reply before each following command. This three-step sequence is our
  pilot workflow, not a sequence mandated by the PDFs.
- `Indian/Mauritius` is validated and stored in Guardian's settings. The sender
  transmits wall-clock strings and does not send LZ or verify the watch clock.
  No conclusion that the pilot is four hours wrong follows from that fact.
- Observing Open / 20 after a local Save establishes local menu persistence.
  Local Close / 20 normalizes to Close / 0. The documents do not establish that
  this editing menu is authoritative for a remotely stored reminder. Do not
  classify a remote command as applied or ineffective solely from that menu.

## Overnight supplier comparison, in Mauritius time

On 29 September, the relay recorded supplier Off at 01:13:45.545 with a bare
reply at 01:13:47.174; supplier On / 20 at 01:30:25.726 with a bare reply at
01:30:26.846. Both setting frames used 3G and `000e`. At 01:42 the operator
explicitly reported Close / 0 after reopening the physical menu without a
local Save, while AnyTracking displayed Open / 20. This is a direct operator
observation; the reused 00:54 photo is not evidence of a new observation time.

The 01:30 command was outside the earlier requested 00:30-01:15 window. No new
worktime command was captured in that comparison, and the schedule actually
retained by the watch was not read back. This is a confound, not a diagnosis.
Earlier Guardian commands around 00:40 and 00:50 were inside the requested
window and also yielded Close / 0; the late comparison cannot explain them.

The observed symptom is not isolated to Guardian's sender. It does not prove a
firmware defect or that both services failed to enable the running reminder.
No controlled, timed remote reminder observation has resolved that question.
Recorder expiry does not restore routing or disable a stored setting. Fresh
Guardian telemetry and cleanup after that remote On were unconfirmed at the time.
The midday follow-up below supersedes the routing status, but does not establish
remote reminder acceptance or completed Off cleanup.

## Midday supplier capture and observation - 29 September 2026

All times in this section are Mauritius time (UTC+4). The public recorder TCP
port failed a connection test while the supplier server was reachable. The
operator recreated only the recorder endpoint and its public TCP check passed;
the next recording reached the supplier at 12:33:45.988. A local ngrok endpoint
listing alone is not sufficient evidence that its public port is reachable.
Future runs must rediscover addresses; do not reuse ports from this record.

The operator supplied screenshots and the six private rows from
`daytime-20260929-123343-914.jsonl`. Exact setting frames were:

| Sent | Body | Prefix / length | Bare watch reply |
| --- | --- | --- | --- |
| 12:35:02.102 | `SEDENTARY,1,20` | `3G` / `000e` | 12:35:03.052 |
| 12:35:15.070 | `SEDENTARYWORKTIME,21:00-23:59,-` | `3G` / `001f` | 12:35:15.807 |
| 12:36:45.627 | `SEDENTARYWORKTIME,21:00-23:59,-` | `3G` / `001f` | 12:36:46.683 |

Both worktime frames are identical. The upper Save sent On / 20, even though
the operator described the earlier state as closed. The app screenshots show
Open / 20, first period 21:00-23:59 and an empty second period, plus a Success
toast. The supplied physical-watch photograph shows Open / 20. Whether that
photo followed only reopening, with no physical local edit/Save, has not been
explicitly confirmed. Do not upgrade this to applied-state readback.

The bytes and lengths match the current Guardian sender. This supplier run used
On then worktime, whereas Guardian's combined On request uses Off, worktime,
then On. Order remains a comparison variable; there is no evidence yet that
changing the order fixes reminder behavior.

At 12:53 the operator confirmed saving a 13:00-14:00 window in AnyTracking and
reported the physical watch clock as 12:53, matching Mauritius time. However,
the subsequently supplied private file still contains only the six rows above:
no 13:00-14:00 frame or reply was captured. The supplied public log ends with a
12:37:45.347 heartbeat reply, not a session-close or recorder-stop event. Do not
infer that the daytime schedule reached the watch from the app Save alone.

The operator restored the Guardian route; the 12:52 inspection reported
`sessionConnected: true`. Home matching remained `no_observation`, a separate
condition. The recorder started at 12:33:43.980 with a 20-minute bound, so its
nominal expiry was 12:53:43.980, not the earlier recording's 12:42 expiry.

The operator reported wearing the watch while seated at 12:55 and agreed to
observe through 13:25 without further changes. At 13:28 they reported no sound
and no on-screen reminder. Vibration, scene mode/volume, sensor-detected movement,
and applied worktime remain unconfirmed. Classify this observation as
**inconclusive: no reminder observed, daytime schedule delivery unverified**.
Do not mark it a pass, a proven firmware fault, or a Guardian send failure.
Do not extend the wait or repeat On/Off blindly.

### Guardian page shown during the observation

The screenshot shows Selected: Off, 08:00-20:00, Last request: Not checked, an
unconfirmed-result error and a disabled Save button. Source inspection confirms
these values match the form's initial values when state has not loaded. They
are not a live reading from the watch or proof that Guardian sent Off. Opening,
refreshing and reconnecting do not send reminder settings; the authenticated
POST Save path does. Guardian does not import AnyTracking's requested settings.

Before another Guardian timed trial, diagnose the status-load failure (current
gateway URL, route/pilot availability and authenticated read). Record the exact
requested daytime window, sent frames/replies and clock/mode before beginning
another wait. The initial-load UI must also avoid presenting fallback Off and
hours as though they were loaded settings. No runtime change is made by this
evidence update. Off cleanup after the midday enable remains unconfirmed.

## Next diagnostic, without repeating blind On/Off attempts

1. Read the physical watch's current clock and date. Record the full AnyTracking
   sedentary page, including both periods and the selected interval/switch,
   before pressing Save. These app selections are not saved-device readback.
   Record current scene mode and volume as observation, not a guessed fix.
2. Before another routed comparison, inspect current tunnel endpoints, verify
   the normal Guardian session and the return route. Do not reuse yesterday's
   endpoint merely because it appears in this note.
3. If a further operator trial is chosen, use one supervised daytime window
   containing the actual watch time and at least 30 minutes of observation.
   Capture the explicit lower worktime Save and upper On / 20 Save separately;
   retain exact bytes and replies. Do not substitute a local watch Save, which
   would mix local and remote configuration in the same test.
4. Record the physical menu as one observation. Observe actual prompts during
   ordinary comfortable seated activity for a bounded 20-25 minutes after final
   handling; record movement, sound/vibration and timestamps. One silent window
   is inconclusive because sensor reset rules are undocumented. Stop at the
   agreed bound instead of resending or extending indefinitely.
5. Request Off once through the active route, record reply and menu separately,
   use the known local Close/Save fallback if needed, and restore/verify fresh
   Guardian traffic before the recorder ends. Neither a reply nor a briefly
   closed display establishes long-term suppression of remote reminders.

If that controlled supplier trial remains inconclusive, send the exact firmware,
captured values, watch time, scene mode and outcome to Jett. Ask specifically for
SEDENTARYWORKTIME fields/time basis, local-menu versus remote-state behavior,
applied-setting readback and motion/reset rules. Do not repeat the already
answered switch-polarity/minute question. No message was sent by this audit.

## Change and validation scope

Documentation only: source hashes, visual page inspection, byte-length checks,
sender review and correction of menu-based acceptance wording. No watch command,
source PDF publication, reset, timezone change, customer activation or deployment.
No runtime code changed, so no new runtime test run is claimed. PR #118 remains
draft until the remaining physical behavior is established.
