# V52 medication reminders with an optional voice recording

Status: implemented as a restricted Android/Web pilot in draft PR #144 on
5 October 2026. The operator confirmed one audible AnyTracking Once reminder;
The first Guardian Once reminder also played audibly at the operator's report;
its vibration/profile interaction remains unverified (see the latest checkpoint).
Keep this PR draft until that acceptance and the remaining hardware gates pass.

## Implemented pilot

The Medication reminders card in Watch preferences now offers **Standard alert**
or **Your voice**, alongside a label, local Mauritius time, Once/Every day and
an enabled switch. Recording begins only on an explicit tap after microphone
permission, shows elapsed time, stops at ten seconds, and stops when leaving the
app. The guardian can listen, replace the recording, reopen it privately, edit
the schedule, turn it off or request removal. The responsive editor was checked
at 320/390/1280 logical pixels with enlarged text and on the connected Samsung.
It adds no navigation tab. Text is not synthesized into speech.

The pilot accepts 0.5–10 seconds of 8 kHz mono PCM16, then encodes AMR-NB at
12.2 kbit/s locally in a bounded gateway worker. The vendored Apache-2.0
OpenCORE encoder and its provenance are under `gateway/vendor/opencore-amr`.
Ten seconds is a conservative application cap, not an established watch limit.
New recordings still need intelligibility/playback acceptance on this firmware.

`GET/POST /app/medication-reminders` and the authenticated `/audio` preview route
require a Firebase user token, linked device, active Family/Care service and
matching server pilot UID/device flags. Enable explicitly with
`VOICE_MEDICATION_PILOT_ENABLED`, `VOICE_MEDICATION_PILOT_IMEI`,
`VOICE_MEDICATION_PILOT_UID` and the app's `GUARDIAN_VOICE_MEDICATION_PILOT_IMEI`.
Identity values stay in private configuration. Recordings never enter public
Firestore fields, command logs or fixtures; previews use private/no-store HTTP.

Each device has a transactional three-slot registry independent of frequency.
Existing records keep their old frequency-derived slot reservation, including
uncertain legacy deletions. Duplicate legacy records on one physical slot are
preserved and cannot be edited through this sender until deliberately reconciled.
The card counts physical slots, allowing a new reminder in an unused slot. No
automatic migration, overwrite, reset or legacy replay occurs. Once a device
uses the managed flow, rules and the legacy dispatcher reject its old medication
write path. Weekly legacy rows are preserved, but this pilot edits only Once and
Daily: weekday ordering is unresolved. This is not a general migration rollout.

Requests carry an idempotency key and expected revision. The server binds one
fresh watch session, claims a 45-second operation lease, rechecks authorization,
and uses the shared command coordinator before the binary write. Routine work
may wait up to 25 seconds behind capture; explicit Off remains prompt. It marks
the write durably before dispatch, waits up to ten seconds for a matching reply,
and never automatically retries or replays ambiguous work after reconnect or
restart. An uncertain connection cannot enable another reminder until reconnect;
a bare late reply cannot confirm an Off on that connection. Removal retains the
record/audio/slot until an eligible same-session status-1 reply is observed.

The app distinguishes a watch reply from an unconfirmed/not-sent result. Neither
proves audible playback or medication adherence. Code 0 is treated conservatively
as unsuccessful, with its precise firmware meaning still an acceptance item.
Guardian WhatsApp medication scheduling is unchanged and is separate from the
watch's programmed audio.

Runtime dependency: sending requires the shared coordinator in the combined
pending reporting/photo work. This PR fails closed on main without that module;
merge/integrate that dependency before enabling the sender elsewhere.

Software validation: 1,351 isolated-branch gateway tests; 1,667 combined gateway
tests; 75 isolated / 91 combined Firestore emulator tests; 55 focused Flutter
tests. Coverage includes access revocation, bounds/Unicode/framing, slot
contention, revisions/idempotency, expiry, camera deferral, prompt Off, timeout,
session replacement, interrupted operations, private preview/deletion, microphone
permission/background handling and responsive layouts. Android and Web builds
pass. These counts do not substitute for real watch playback.

## Experience and acceptance principles

Extend the existing Medication reminders editor, available on Family and Care.
Keep time, repeat days and the visible reminder text. Add **Reminder sound**:

- **Standard alert**: a reminder without a recorded clip; its interaction with the requested watch profile still requires hardware acceptance.
- **Your voice**: record a short message, stop, play the preview, replace or remove
  it, then save it with the reminder. Request microphone permission only when
  recording starts. A denied permission must leave the existing reminder intact.

Show a recording indicator and duration. Reopening the reminder must recover its
saved recording and sync state. No new bottom-navigation item is needed.
Text is a label/message; it must not imply that the watch synthesizes speech.
Generated speech is outside the first implementation.

Show distinct states for saving, waiting for the watch, sent, a device response,
failure and an unknown result. Do not label transport handoff as playback, or a
protocol response as confirmation that medication was taken. The user reports
that the current reminder rings; recorded speech is a new acceptance item.

## Source and current-code audit

The original shared V46/V48/V52 Communication Protocol, section II.29, spans
PDF pages 8–9. Its SHA-256 is
`8f01881b9773f9ee762ceb2cc4dff9aa037abfa7a5540d6a723e1f4dd9161dbf`.
The companion Communication Example has SHA-256
`976b5721fbde52959a62d9f8975b9faf4bf6263e4b057d1eaa72950820e73e2b`.
Both original files were hashed again on 5 October and match the
[earlier supplier inventory](../testing/sedentary-source-audit-2026-09-29.md).
Source originals stay private; identifiers in vendor examples are not targets.

The documented body is:

```text
TAKEPILLS,<time-switch-frequency-customize>,<reminder number>,<Unicode text>,<voice data>
```

Section II.29 describes reminder numbers 1–3 and allows an empty audio field,
while retaining its separating comma. It asks for a device response containing
a status code, but does not define that code's meanings here. Its example
response length is inconsistent with its payload; compute frame lengths from
actual wire bytes, never copy that literal length.

Important differences from the existing implementation, audited on main
`0acf707acf7cfb22a23a3fa1bf3c0cc299f907a0` and the combined checkout:

| Area | Current implementation | Work required |
| --- | --- | --- |
| Command builder | `gateway/src/commands.js` sends schedule, frequency again, and hex text; no audio field | Introduce an evidence-backed voice form without silently changing the existing capture-matched text form |
| Reminder number | Uses frequency 1/2/3 as the following field, matching three supplier examples | Model slot identity separately from repeat frequency; verify slot replacement/off semantics |
| Capacity | App creates reminder documents without a watch-slot allocator | Enforce three documented watch slots transactionally; never silently overwrite another reminder |
| Week mask | Code assumes Sunday-first; prose in the referenced clock section says Monday-to-Sunday | Resolve with supplier or asymmetric Monday-only/Sunday-only hardware checks before changing saved schedules |
| Unicode | Current helper iterates code points into hex | Validate UTF-16BE against source examples, including accented text and surrogate pairs; define unsupported-text handling |
| Persistence | `medicationReminders` stores text/time/frequency and transport sync status | Add optional private audio references, separate slot, revision and honest outcome metadata |
| App | `watch_preferences_page.dart`, `MedicationReminderService`, `MedicationReminder` | Add recording/preview/edit flow with authorization and capability checks |

The existing scheduler sends the separate guardian WhatsApp reminder. Do not
turn it into repeated watch-audio delivery or alter that notification contract.

## Evidence needed before a voice command is enabled

Section II.29 does not specify the medicine audio codec/profile, rate, duration,
byte limit, file header, escaping, or chunking. Section II.36 specifies AMR for
**TK voice chat**; that is not proof that TAKEPILLS uses the same representation.
The first controlled reference capture below now supplies evidence for one
AMR-NB profile and the five escape mappings in TAKEPILLS. Other durations, Guardian-generated audio and
other configurations still need acceptance. Also establish:

- Independent slot behavior: two daily reminders in different slots, update
  one without changing the other, and disable/remove exactly one slot.
- Status-code meanings and correlation when replies contain no slot/request ID.
- Clock/day mapping, on-watch persistence, sound/vibration/silent interaction,
  repeat count, and whether the watch plays the recording without connectivity
  once the schedule is stored.

Do not infer missing syntax from TK, append guessed AMR bytes, or automatically
rewrite existing reminders during rollout. Plan a migration that accounts for
the old frequency-derived fields and any already-stored device reminders.

## Implementation boundaries

- Preserve existing linked-device authorization and Family/Care eligibility.
  The server allocates slots and validates revisions; clients cannot select
  another family's audio object or set authoritative device-result fields.
- Store recordings privately. Retain an active reminder's recording for reuse;
  remove replaced/deleted assets once no active record or bounded in-flight
  operation references them. Cancellation must retain enough state to disable
  the intended watch slot before declaring it removed.
- Keep audio and medication text out of packet logs, command summaries and
  public fixtures. Use byte counts, revisions and redacted failure reasons.
- Use a binary-safe, bounded transport if the confirmed voice format requires
  it. The generic ASCII command-string/logging path must not receive raw audio.
- Use the shared per-device command decision point from the combined work.
  Required replies, emergency activity and explicit stops remain prompt.
  Deferred settings keep the newest valid revision and recheck access, session
  and expiry. Do not replay an ambiguously applied voice schedule after restart.
- Save/program the watch ahead of the scheduled time; do not depend on a
  server-side send at that minute. Whether an accepted schedule survives a
  gateway outage or watch reboot requires a real-device result.

## Delivery and acceptance checklist

- [x] Read sections II.20, II.28 and II.29 and the three non-audio examples;
  compare the existing app/schema/builder and identify unresolved fields.
- [ ] Obtain exact TAKEPILLS voice encoding, limits, slot and response evidence.
- [x] Implement pilot slot ownership, private assets and authenticated APIs;
  update schema/rules. Conflicting legacy slots are preserved and fail closed;
  broader migration remains a separate acceptance task.
- [x] Implement a pure binary voice-frame builder and compare it privately to
  the captured disabled Daily / enabled Once command bytes.
- [x] Implement the authorized sender, response lifecycle and command coordination.
- [x] Add Android/Web record, preview, replace/remove and sync/error states.
- [x] Software-test Unicode, framing lengths, binary delimiters, slot
  capacity, concurrent edits, revocation, expiry, interrupted upload, unknown
  response, reconnect/restart and deletion/off behavior.
- [ ] Test overlapping medication configuration, SOS/fall and photo capture;
  preserve emergency priority and current reporting restoration.
- [ ] With an operator-approved neutral test recording, verify actual audible
  playback, displayed text, chosen days/time, independent slots, off, global
  alert profiles, reboot and gateway-disconnected execution separately.
- [x] Record current evidence in the V52 ledger and QA Wiki. Restrict the live
  app to the operator-authorized pilot pending Guardian playback acceptance;
  do not enable a general rollout before target firmware/platform acceptance.

The two-way voice-message PR is a sibling feature. Shared audio tooling may be
reused after its format is proven; these remain separate commands and contracts.

## Reference recorder, 5 October checkpoint

`gateway/scripts/capture-medication-session.js` wraps the existing transparent
movement relay. It forwards the selected watch's original bytes unchanged to
AnyTracking or the local Guardian backend, and generates no commands or ACKs.
It opens no listener/files without `--run`. Raw TAKEPILLS, TK and PROFILE frames are
saved to a separate explicitly named private file; other traffic has redacted
metadata. TK is included in case the supplier transfers a medicine recording
separately. Capturing it does not prove it belongs to a specific reminder.
PROFILE is included for the alert-style comparison; exact prefix, case and mode
remain private with the addressed frame. A bare reply is not scene readback.

Bounds: 20 minutes maximum, 64 private frames, 2 MiB raw bytes; inherited framing,
session and metadata-row limits also apply. Media never enters the metadata
file. Full-frame private records include timestamp, exact Base64 bytes and hash;
their captureRef joins the session/direction in metadata. Keep the private file
and all real captures outside Git. The terminal summary separately reports
private-write/limit failure; a complete metadata framing log alone does not
prove complete private capture. Limits/write errors stop private recording while
forwarding continues until the relay deadline. Unknown framing stops observation,
not transparent forwarding.

Use verified current public TCP recorder/return endpoints. The default reference
backend is not inferred: explicitly select `--backend anytracking`, which uses
the existing `a.igps123.com:7720` reference route. Forwarding temporarily diverts
Guardian telemetry/alarms; restore the verified Guardian route before expiry.
Neither stopping the relay nor creating its optional absolute `--stop-file`
restores the watch route or undoes a saved reminder.

First trial: confirm a fresh reference connection, inspect existing reminders,
then use a free slot and a neutral short recording, once-only a few minutes ahead.
Record save/response time, actual audible playback and app state independently.
Preserve existing reminders. Inspect the resulting command before expanding to
two slots, changes or removal; cleanup must use supported app controls and be
verified. No speculative Guardian TAKEPILLS audio is sent by this recorder.

Sixteen focused relay/recorder tests pass, including exact split binary
forwarding, no generated replies, identity/media filtering, limits, disk failure,
expiry and a local stop file. The existing expiry test now waits for the client
socket's asynchronous close before checking it. This is software verification;
the reference result below remains separate from playback acceptance.

## First AnyTracking capture, 5 October 2026

The operator routed the pilot through the private recorder and confirmed
AnyTracking was online after reopening the app. They saved one reminder and
reported returning the watch to Guardian. Fresh authenticated Guardian session
traffic verified restoration after the reference connection closed. The recorder
and temporary sleep helper were stopped; the original Guardian/ngrok processes
and public endpoints remained unchanged. The temporary recorder tunnel was removed.

At 17:00:59 Mauritius time, AnyTracking sent one `TAKEPILLS` frame with four
arguments: schedule, reminder number, UTF-16-style hexadecimal text, and binary
voice data. Its 5,732-byte payload length matched the header. The watch replied
`TAKEPILLS,1` at 17:01:01, about 1.67 seconds later. The reply alone does not
establish the meaning of status 1 or that the reminder played.

The voice field contained an AMR-NB file header followed by escaped binary,
not a hexadecimal or Base64 audio string. Applying the five documented TK
escape mappings produced 5,574 bytes: the AMR-NB header and 174 complete
12.2-kbit/s frames (3.48 seconds). All five escape codes occurred in this sample;
there were no invalid escapes or trailing bytes after frame parsing. This is
now direct evidence for that representation in this firmware's TAKEPILLS
command; it is not a claim about all firmware, other bitrates or size limits.
The same session contained no TK audio transfer. Frame parsing has been checked;
no independent codec decode is claimed. The operator reported no sound at the
scheduled time; this disabled-setting trial does not test enabled voice playback.

The captured setting was `17:06-0-2`, with reminder number 1. The operator
confirmed the scheduled time was 17:06 and reported that nothing happened.
The enable value is 0 (documented as off), consistent with that report. The
operator's 17:09 editor screenshot then confirmed Daily selected, time 17:06,
Enable showing Close, and a recording attached. This supports frequency 2 as
Daily in the sampled command while the separate reminder number remained 1.
It does not establish the complete repeat/day/slot mapping. The earlier list
screen's Once/Daily/Customize row names do not fix a slot's repeat type.

The capture finished cleanly with 16 observed frames, two privately saved
TAKEPILLS frames, no framing/storage failure and no private limit reached.
Private recordings, reminder text, device identifiers and raw frames remain
outside Git. No Guardian medication command was sent. Actual activation,
scheduled playback after returning to Guardian, off/removal and persistence
remain acceptance items.

## Enabled Once playback, 5 October 2026

A fresh bounded reference session connected at 17:13:34 MUT. AnyTracking first
sent the older disabled Daily setting, then at 17:13:37.978 sent
`17:16-1-1` with reminder number 1 and the same recorded voice. The latter
command's enable value is 1 and frequency is 1 (Once); the watch replied with
`TAKEPILLS,1` at 17:13:38.410. Each downlink had a valid 5,732-byte payload,
including the escaped AMR-NB recording described above. The reason for the
older setting arriving first was not established; no retry was generated by
the recorder.

The operator confirmed **hearing the voice** for the reminder scheduled at
17:16. This establishes one actual recorded-voice playback on the pilot watch
using AnyTracking, independently of the earlier protocol acknowledgement.
The precise playback second was not independently measured. It does not yet
pass the Guardian app-to-watch acceptance gate or establish all recordings,
repeat/day settings, slot combinations, offline execution or reboot persistence.

At 17:19:09.674 the supplier sent an off-setting for the same slot; the watch
replied at 17:19:11.514. This command matched the earlier `17:06-0-2` setting
and recording. Record that exact observed setting, without inferring why the
app sent it. It supplies command/reply evidence for off cleanup; no independent
watch readback or future-suppression test is claimed. The operator was then
given the verified Guardian return SMS and reported done. The reference session
closed at 17:19:43.735; an authenticated read-only Guardian check verified a
new watch packet at 17:20:07.430. The recorder stopped at 17:21:38.986 with
complete framing and private capture: 34 observed frames, six private records,
17,355 raw private bytes, no limit or write failure. Recorder/sleep helper exited,
the temporary tunnel was removed and the heartbeat paused. Guardian/ngrok and
their original endpoints were preserved. No reminder was sent by Guardian.

## Codec implementation checkpoint

`gateway/src/medication-voice-codec.js` builds a private binary Buffer with the
captured 3G prefix, an independent documented slot (1–3), explicit enable flag,
Once/Daily setting, lowercase UTF-16BE text hex and escaped AMR-NB recording.
It calculates LEN after escaping and bounds the complete payload to its
four-hex-digit envelope. This protocol bound is not a hardware recording-duration
promise. Input settings and malformed Unicode fail without leaking their values.

The audio validator deliberately accepts only the observed mono AMR-NB
12.2-kbit/s profile, with complete 32-byte speech frames, good-quality headers
and canonical zero padding. It checks file structure, not intelligibility.
The storage layout is grounded in [RFC 4867 sections 5.1 and 5.3](https://www.rfc-editor.org/rfc/rfc4867.html#section-5).
Other bitrates, AMR-WB, SID/DTX and weekly voice settings remain outside the
codec. The integrated settings builder now also permits the documented empty
voice field, retaining its final comma, for Standard alert. Legacy devices keep
their old command path; managed pilot devices cannot mix the two writers.

The codec has no network, storage or logging side effects. The integrated
sender enforces linked-device access, transactional slot ownership, revisions,
a single current session, coordination and expiry.
The Buffer must never enter the generic text command logger. Status 1 is recorded
as a device response, never as proof that a guardian or wearer heard the recording.

All four privately recorded downlinks (two distinct complete frames) matched
the new builder byte for byte in an offline comparison, without sending commands
or committing the private inputs. Fifty-four focused tests pass across the new
codec, legacy medication/command behavior and the relay/recorder. Tests cover
all five escapes, high bytes, independent slots, on/off, surrogate pairs, malformed
audio, explicit settings and raw/escaped payload bounds. App recording/preview,
private storage and sender coordination are now implemented as described above;
Guardian-to-watch acceptance remains open.

## Guardian Once playback and alert-style mismatch — 5 October 2026

The first managed Guardian voice reminder was saved at 18:42:02.058 MUT for
18:46, enabled Once in independent slot 1. Its encoded duration was 9.92 seconds.
The binary write evidence records 18:42:02.842, 16,288 total frame bytes, followed
by `TAKEPILLS,1` at 18:42:03.475. The operator subsequently reported hearing the
recorded voice and no vibration. This is one Guardian app-to-watch audible
playback result; the exact audible start second was not independently recorded.
The saved protocol evidence deliberately continues to say `playbackVerified:
false`: a device reply itself is not the source of the operator observation.

The app displayed Vibration from its cached requested profile. The latest profile
request was mode 3, created 22 September at 23:19:32.189 MUT and marked sent at
23:19:32.461. No new profile request accompanied the 5 October voice save. Sent
means transport handoff, not watch readback. Persistence through elapsed time,
restarts and the intervening supplier reference session is unverified.

Supplier section II.19 defines `profile,1..4` for ring/vibration and a bare
`profile` reply. Section II.29 defines the independent TAKEPILLS schedule, slot,
text and audio fields; it contains no per-reminder vibration field or explicit
rule for how recorded speech interacts with the global scene. The new Guardian
sender sends TAKEPILLS only: it neither reads/changes the cached profile nor
sends a vibration command. Do not infer that it switched vibration off, that
the firmware ignores profile, or that Vibration/Silent necessarily mute speech.

The UI wording is corrected to distinguish requested scene from confirmed watch
state, avoid promising that Silent mutes voice, and describe the unverified
interaction in the recording editor. The save notification now says queued,
which matches its Firestore enqueue operation. No transport/profile behavior
was changed and no watch command was sent during this audit. These copy changes
are in PR144; installation/deployment is deferred while the separate map-fix
task owns the combined Android/Web rollout.

Next controlled check, if the operator elects it: explicitly save Vibration on
the current connection, record command/reply separately, then save one neutral
Once voice reminder and observe speech and vibration independently. A bare
profile reply still is not readback. Do not send an automatic profile override,
fake a vibration field, or replay the expired reminder. Standard alert, other
profiles, Daily execution, independent-slot editing, off suppression and
offline/reboot behavior remain separate acceptance items.


## AnyTracking alert-style comparison — 5 October, 21:25 checkpoint

The bounded reference relay now privately includes PROFILE alongside TAKEPILLS
and TK; ordinary metadata still excludes addressed payloads and media. Sixteen
focused relay/recorder tests pass. It forwards original bytes unchanged and
creates no watch command or reply.

After the operator routed the watch, AnyTracking sent `profile,3` (Vibration)
at 21:20:07.167 MUT in a 3G frame; the watch returned bare `profile` at
21:20:07.772. Guardian's earlier downlink had the same body/mode but an SG
prefix. This is a protocol difference to investigate, not evidence that it
caused the vibration failure. The supplier also uses SG for another command;
there is no basis for a global prefix replacement.

The actual reminder saved through AnyTracking was enabled Daily, slot 1, at
21:25 with recorded voice, rather than the proposed Standard/Once comparison.
Its 5,753-byte frame arrived at 21:21:13.369; status 1 followed at
21:21:14.431. The observer requested no second save. Physical voice/vibration,
off cleanup and Guardian restoration are pending at this checkpoint. Daily
cleanup must be verified separately; acknowledgements prove neither playback
nor suppression. The capture ends at 21:37:50 MUT and must not be extended
automatically. No private recording or reminder text is published.


Operator outcome, 21:25 trial: Voice only, no vibration. This is an explicit physical/audible observation under AnyTracking after its profile3 command/reply, separate from TAKEPILLS status1. Recorded voice without vibration now occurred through both AnyTracking and Guardian; it is not unique to Guardian's new sender. This does not establish profile readback, universal firmware behavior, or the cause of missing vibration on Guardian's Standard reminder. The SG/3G prefix difference is not supported as the explanation of the voice result, because supplier3G produced the same result. No functional profile/framing change was made on this evidence. Standard/no-audio supplier comparison remains unperformed.
The operator was asked to disable only the21:25 Daily test reminder and submit once, then restore Guardian using the verified return endpoint. Cleanup and restoration remain pending at this checkpoint. Recorderdeadline21:37:50 unchanged.
## Reference comparison completed — 5 October, 21:30 MUT

The supplier sent Off for the same 21:25 Daily test in slot 1 at
21:28:41.624; status 1 followed at 21:28:42.513. This is command/reply evidence,
not independent watch readback or a future-suppression test. The operator then
reported returning the watch to Guardian. The reference connection closed at
21:29:02.792. An authenticated Guardian check at 21:29:51.297 verified fresh
selected-watch traffic at 21:29:31.010. That establishes return routing; the
check did not establish a new location fix.

The recorder stopped at 21:30:07.779 with complete framing/private capture:
34 observed frames, six private frames, 11,628 raw private bytes, no limits or
write errors. The recorder and temporary sleep helper exited. Only the temporary
reference tunnel was removed; Guardian/ngrok and their original endpoints were
preserved. The heartbeat is paused. No command was generated by the observer.

Result: recorded voice with no vibration occurred under both Guardian and
AnyTracking. Supplier Standard/no-audio behavior, other scene modes and the
reason for the standard Guardian reminder's missing vibration remain unresolved.
No functional framing/profile change is justified by this comparison alone.

## Call alert wording — 5 October 2026

Following the supplier comparison, the operator requested that the app present
this preference for incoming calls only. The card is now Call alert style;
option descriptions and the Silent confirmation refer to incoming calls.
Medication reminders are explicitly separate and may still play a tone or
recorded voice. The recording editor repeats that Vibration/Silent must not be
relied on to suppress its audio. The selected value is identified as a preference
that the watch has not confirmed, and enqueue success is described as queued.

This narrows the product description; it does not alter the global profile
command, assert firmware exclusivity to calls, or prove the four call modes.
No watch setting, call, reminder or gateway process is changed by this UI update.
The combined checkout retains the completed Wi-Fi, photos, reporting, map/avatar
fixes and soft sage styling. Existing configuration and pilot flags are preserved.

Validation for the call-alert copy: 19 focused combined Flutter checks passed,
including existing narrow/large-text preferences and recording-editor cases.
Targeted analysis of the three changed app sources found no issues. Android
debug and Web release builds succeeded with the existing android-config.json,
gateway URL and both movement/voice pilot defines. Android replacement install
succeeded on the connected Samsung. The Maps/build predeploy guard passed.
No new watch command or hardware acceptance claim is introduced by these checks.
