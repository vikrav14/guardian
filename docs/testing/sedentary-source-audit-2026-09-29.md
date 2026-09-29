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

## Guardian afternoon observation - 29 September 2026

All times below are Mauritius time (UTC+4). The earlier app-load blocker was
resolved for this session: both local and HTTPS routes initially returned 404;
after starting the movement pilot with the original gateway environment, an
unauthenticated local request returned 401 `sign_in_required`, and the signed-in
app loaded its stored request. This establishes route availability and a working
authenticated read, not hardware acceptance. The separate care-reminder watcher
being disabled is not evidence that this HTTP pilot is disabled.

The operator supplied the read-only `movementReminderSettings` audit for a
request created at 13:48:34.974 (`2026-09-29T09:48:34.974Z`). It records enabled
true, interval 20, start 00:30, end 15:00 and timezone Indian/Mauritius. Status
was `replies_observed`, reason null and nextCommand null. Every evidence row
has handoff true, replyObserved true and appliedStateVerified false:

| Sent | Body | Bare watch reply |
| --- | --- | --- |
| 13:48:36.269 | `SEDENTARY,0,20` | 13:48:36.748 |
| 13:48:38.153 | `SEDENTARYWORKTIME,00:30-15:00,-` | 13:48:38.608 |
| 13:48:39.341 | `SEDENTARY,1,20` | 13:48:39.706 |

Unlike the earlier AnyTracking midday observation, the daytime-containing
window and final enable now have exact recorded command/reply evidence. The
start remained 00:30 rather than the initially suggested 14:00; this still
includes the observation, so the operator was not asked to resave it merely
to change the start label. Neither the requested window nor its reply proves
which clock or worktime state the firmware actually uses.

At 13:55 the operator agreed to observe until 14:20. At 14:07 they reported
Close / 0 on the physical watch and supplied a Guardian screenshot showing
Selected: On, 20 minutes, 00:30-15:00 and Watch replied - check the watch.
At 14:08 they explicitly confirmed only opening the physical menu, with no
local Save. The menu check therefore did not include an operator-issued local
settings save; the difference between requested and displayed state remains
unresolved. Do not dismiss Close / 0 or call it definitive remote readback.

At 14:22 the operator reported "i got nothing and its 14.22" in response to
the sound/vibration/on-screen observation request. Record **no reminder
reported by the cutoff; physical acceptance not passed**. Sound mode and
volume were requested but never confirmed. Detected motion, firmware timer
start/reset and applied hours remain unknown; opening the watch menu also
occurred during the observation. This is not proof of a firmware defect, a
specific timer reset, or a transport failure. Do not extend the wait, infer
that a prompt was missed, or immediately start another enable cycle.

The observation has ended. Recommend one explicit Off through the working
Guardian page, then read-only status refresh and a separate physical-menu
check. If local fallback is needed, the previously observed physical Close /
Save behavior is available. Off dispatch, reply and physical cleanup after
this observation have not yet been supplied and must not be marked complete.

### Earlier escalation proposal (superseded by the software investigation)

At 14:26 and 14:37 the operator explicitly requested no supplier escalation and
asked to fix the difference from AnyTracking. No message was sent. The questions
below remain unresolved reference notes, not the current next action.

Retain the exact request/replies above, the supplier comparison, both previously
reported V52 firmware labels and the no-local-Save/no-reminder observations for
Jett. Ask for the supported SEDENTARYWORKTIME syntax and clock basis, any required
command order, the relationship between remote settings and the local menu,
an applied-setting readback, movement/reset/repeat rules and sound-mode behavior.
The supplier has already defined On/Off polarity and the interval's units;
do not repeat those questions. A further physical trial should answer a specific
newly supported question, not repeat this wait. No supplier message was sent.
PR #118 remains draft and customer movement reminders remain gated.

### Follow-up: independent Save actions

Code inspection confirms a concrete workflow difference: the supplier upper
Save sends one SEDENTARY setting and lower Save sends one WORKTIME setting;
Guardian inserted an extra Off and coupled both controls into Off/worktime/On.
There is no supplier evidence requiring that sequence. The connected pilot now
uses independent explicit `switch` and `hours` actions, with one captured-format
frame each. It preserves the other component's last-requested state and records
exact outbound frame hex. Old combined clients fail before a send.

The UI also disabled Save for requested On after a reply despite lacking device
readback. A fresh explicit Save is now possible after completion, while busy,
version, UUID, authorization and unconfirmed-change guards remain. A failed
initial load no longer shows default Off/hours as if they were loaded.

These are verified software discrepancies and targeted corrections, not a
proven firmware diagnosis. The observation below supports the corrected path's
enable behavior, but does not isolate which former difference caused Close / 0
or establish timer behavior. Do not claim hardware acceptance from unit tests.

### Operator result at 14:58 MUT: isolated Guardian On reflects Open / 20

Following instructions to use correction `2dbaa83`, leave active hours alone,
select On and press Save On/Off once, then reopen the physical menu without its
Save, the operator reported: "clicked on on save / watch it shows open 20".
Record the isolated enable **menu check as passed by operator observation**.
14:58 is the report time; exact command/reply times and the new audit rows have
not been supplied. This is stronger evidence than a bare transport reply but
does not establish a general device-state readback or reboot persistence.

The timed reminder, motion reset, repeat behavior and worktime enforcement
remain unverified. Next is one explicit Guardian Off Save and a separate menu
observation; do not assume cleanup has already happened. The previous requested
hours ended at 15:00, so this report is not a basis for beginning a new 20-minute
test inside that expiring window. PR #118 remains draft.

### Operator result at 15:01 MUT: Guardian Off reflects the disabled menu

In response to the explicit Off check, the operator reported selecting Off in
Guardian, seeing Close / 20 first, then Close / 0. This is consistent with the
earlier local disabled-display normalization. Record the corrected Guardian
**Off menu check as passed by operator observation**, alongside the 14:58 On
result. The last physical state reported is closed. Exact Off request/reply
rows and send time have not yet been supplied; 15:01 is the report time.

This establishes the two observed setting transitions. It does not establish
long-term suppression, timed prompt delivery, worktime enforcement or sensor
reset rules. Next verify an independent hours Save while still Off, including
the exact window/reply and unchanged physical menu, before enabling another
timed observation. The old window ending 15:00 must not be reused for that wait.
Scene mode and volume still need an explicit operator confirmation.

### Follow-up at 15:08-15:17 MUT: hours replied, later On still shows Close / 0

The 15:08:17 app screenshot shows Watch replied - check the watch and
Requested hours: 15:10-16:30. The operator had reported the physical menu
remaining Close / 0 while Off. This confirms the app's recorded hours action
and reply status, not the exact WORKTIME socket bytes or firmware application.

The operator then selected On and Save around 15:15 and reported Close / 0.
Their read-only audit supplied at 15:17 establishes:

| Field | Observed value |
| --- | --- |
| Request created | 15:15:12.238 MUT (`2026-09-29T11:15:12.238Z`) |
| Action / result | `switch` / `replies_observed`; reason and nextCommand null |
| Outbound frame | `[3G*9705254749*000e*SEDENTARY,1,20]` |
| Socket handoff | 15:15:13.019 MUT; handoff true |
| Bare reply | 15:15:13.576 MUT, 557 ms later |
| Merged requested state | enabled true, interval 20, 15:10-16:30, Indian/Mauritius |
| Physical observation | Close / 0; appliedStateVerified remains false |

The frame hex is byte-for-byte equal to the previously captured AnyTracking
On / 20 frame for this protocol ID. This request contains only one command;
it is not the former combined Off/worktime/On sequence. It rules out a missing
socket handoff, different outbound frame or absent reply for this attempt.
It does not prove applied state or explain the physical-menu result.

The positive 14:58 On and 15:01 Off observations remain, but they do not prove
consistent On behavior after the intervening hours action. Read the individual
request audits to compare earlier successful On/Off with the exact hours frame
and later On; do not infer worktime delivery from merged desired state alone.
Hours, ordering and firmware/menu behavior remain unresolved variables. Do not
claim that worktime caused the result, guess a timezone correction, or start
another blind wait. Actual reminder behavior and scene mode remain unverified.
PR #118 stays draft, with no customer activation or supplier escalation.

### Full request audit and follow-up hours Save, supplied at 15:21-15:24 MUT

The operator supplied the immutable requests from 14:45-15:20 MUT. The query
did not reach its 50-record limit. All four were replies_observed with null
reason, one evidence row each, and the captured 3G/lowercase-length framing:

| Created (MUT) | Sent (MUT) | Body | Bare reply (MUT) |
| --- | --- | --- | --- |
| 14:58:07.532 | 14:58:08.211 | `SEDENTARY,1,20` | 14:58:09.245 |
| 15:00:51.458 | 15:00:52.144 | `SEDENTARY,0,20` | 15:00:53.041 |
| 15:05:22.424 | 15:05:23.123 | `SEDENTARYWORKTIME,15:10-16:30,-` | 15:05:23.840 |
| 15:15:12.238 | 15:15:13.019 | `SEDENTARY,1,20` | 15:15:13.576 |

This closes the earlier missing-hours-wire-evidence gap and supplies the exact
earlier On/Off times. The earlier successful On had merged requested hours
00:30-15:00; the later On had 15:10-16:30. Neither audit reads firmware state.
The two On frames are identical, and the worktime has 31 ASCII payload bytes,
length 001f, with the same syntax as the captured supplier example.

To test the observed supplier ordering, the operator kept On selected and the
15:10-16:30 hours unchanged, then pressed only Save active hours at about 15:22.
They reported Close / 0 afterward. The 15:24 screenshot shows Selected: On,
the unchanged hours and Last request: Watch replied / Requested hours:
15:10-16:30. The public log includes a SEDENTARYWORKTIME echo between nearby
15:22:35-era entries; the echo itself has no timestamp, so do not assign an
exact receive time from its neighboring location event. The immutable audit
for this final hours request has not been supplied.

The order check did not resolve the reported symptom; it is not evidence that
the firmware's behavior is independent of all ordering or timing. Do not make
an automatic extra hours command into a supposed fix. The latest reviewed
receive path observes the bare reply before asynchronous event processing;
both SEDENTARY commands are in SERVER_ONLY_COMMANDS and produce no ACK back.
The command_echo handler logs only. "Dropped, not re-acking" describes skipping
an ACK to the reply, not discarding the outgoing request. No hidden Off was
identified in those reviewed paths; this is not a complete capture of every
possible external writer. Weak home-Wi-Fi evidence and the CR recovery probe
do not establish a cause for Close / 0; the watch continued sending packets.

The current clock, scene mode and audible volume still need explicit checks
before a further bounded behavior observation. Preserve the menu result as
reported without equating it to documented remote readback. Actual reminder
acceptance remains pending; no supplier contact, customer activation, guessed
hardware command or blanket ACK change is justified by this result.

### Bounded behavior observation completed at 15:56 MUT: no reminder reported

At 15:29 the operator reported "current time is mautitiur time / sound mode on".
This confirms the operator's clock-match and sound-enabled observations; it
does not supply an exact volume level or prove the reminder-specific sound path.

The agreed observation was 15:30-15:55 MUT with the watch worn, ordinary seated
inactivity, the watch arm resting, the screen allowed to sleep, and no further
setting changes. This was inside the recorded requested 15:10-16:30 window.
The latest intended switch remained On / 20, with the exact 15:15 frame/reply
and subsequent hours reply described above. The unresolved physical menu
before the observation was Close / 0. The protocol does not define it as
remote-state readback; neither the menu nor bare reply proves applied state.

At 15:56 the operator reported "nothing". Record **functional acceptance not
passed: no reminder observed by the end of the bounded test**. Do not separately
invent sound, vibration or screen events, exact motion/wearing history, absence
of every possible external write, or applied firmware settings. The instructions
and reported outcome are evidence; sensor inactivity and reset rules remain
undocumented. This result does not establish a specific firmware fault or a
new sender defect, and it must not be used to claim the feature works.

Stop the observation without extending it or blindly resending On. At 16:01
the operator reported selecting Off and saving in Guardian, then observing
Close / 20 followed by Close / 0 on the physical watch. Post-test Off cleanup
is now operator-confirmed by that menu transition. Exact Off command/reply times
were not supplied, and this is not long-term suppression evidence. Earlier
positive menu checks and the new software gates are preserved as separate
evidence; the PR stays draft with customer controls gated.

Before another timed test, define a comparison that changes one relevant
variable and captures its result. A local-watch enable can serve as a reminder
engine control, but local menu persistence alone has already been checked and
is not a new behavior pass. A supplier-app comparison would require matching
hours, clock/sound conditions and a complete capture. Neither comparison was
performed in this observation; define its inputs and result criteria first. Do not contact
the supplier, alter the global ACK policy, invent a new command, or repeat the
same remote waiting test without new evidence or a specific comparison purpose.

### Local-enable control: audible/display reminder reported at 16:24:51 MUT

After the remote test and reported 16:01 Guardian Off cleanup, the operator was
instructed to enable Open / 20 directly in the physical watch menu, press the
watch's Save once, leave and reopen without another Save. At 16:04:56 they
reported "it shows open 20". Guardian's last requested state was to remain Off;
no new Guardian or AnyTracking setting Save was requested for this control.

The local observation was planned for approximately 16:05-16:29, inside the
unchanged requested hours 15:10-16:30, with the watch worn, arm resting and
screen allowed to sleep. At 16:24:51 the operator reported receiving a reminder
as sound, and screen text transcribed as "sedenatry reminder: do some exercise".
Record **local-enable audible and on-screen reminder observed: passed for this
single control**. The report is about 20 minutes after the enable confirmation;
do not turn the report timestamp into an exact firing time, calibrated interval
measurement, proof of sensor inactivity, vibration evidence or repeat behavior.

This supports the watch's ability to execute a locally enabled reminder under
the observed conditions. The earlier remotely enabled observation produced no
reported reminder, despite exact-frame handoff/reply evidence. The comparison
narrows the investigation to reliable remote application and any differing
stored settings/session conditions; it does not identify a defective byte,
prove that Guardian alone is responsible, or show that remote hours were applied.
No hours change was requested between the remote trial and local control.

On the prompt, the operator was instructed to finish by selecting Close and
Save on the physical watch and checking Close / 0, leaving Guardian unchanged.
At 16:26:41 the operator reported setting Close / 0, saving locally, leaving
and reopening the menu, and seeing Close / 0 persist. Local disable/menu cleanup
is operator-confirmed; it does not prove long-term prompt suppression, reboot
persistence or a remote Off transition. Do not infer or introduce an interval-0
wire command from the local UI normalization. Remote acceptance and PR #118
remain open; no further timer wait is needed to establish this local positive
control. Existing 21 September local speech reports remain separate historical
evidence, with unknown timing; this is not claimed to be the first-ever prompt.

## Guardian-through-recorder menu result — reported at 17:48:15 MUT

The operator reported Open / 20, followed by selecting Off and Save in Guardian.
The physical menu showed Close / 20 and then Close / 0. They reported restoring
the direct Guardian route to port 14062. This is a positive On/Off menu check
for this run; the reporter's timestamp is not the exact command timestamp.
No new timed remote reminder was observed in this short check. The JSONL file
and fresh post-return Guardian packets remain to be reviewed. No local Save
was reported in this sequence. Do not infer that the relay, startup ACKs or
any other unmeasured difference fixed the earlier inconsistent remote result.
The next action is capture review, with the watch left closed.

## Earlier comparison procedure (historical; not another immediate trial)

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
