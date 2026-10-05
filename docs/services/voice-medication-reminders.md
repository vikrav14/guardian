# V52 medication reminders with an optional voice recording

Status: implementation draft opened at the operator's request on 5 October 2026.
This change records the audited protocol, app flow and delivery gates and adds
an operator-only transparent reference recorder. It does not implement or enable
Guardian voice reminders. Keep the PR draft until implementation and exact-watch
acceptance are complete.

## Intended experience

Extend the existing Medication reminders editor, available on Family and Care.
Keep time, repeat days and the visible reminder text. Add **Reminder sound**:

- **Standard alert**: preserve the existing choice and watch alert-profile behavior.
- **My voice**: record a short message, stop, play the preview, replace or remove
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
AMR-NB profile and the five escape mappings in TAKEPILLS. Limits, playback and
other configurations are still unverified. Also establish:

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
- [ ] Implement slot ownership, migration, private assets and authenticated APIs;
  update `firestore/SCHEMA.md` and rules together.
- [ ] Implement the supported builder/response path and command coordination.
- [ ] Add Android/Web record, preview, replace/remove and sync/error states.
- [ ] Test Unicode, framing lengths, binary delimiters if applicable, slot
  capacity, concurrent edits, revocation, expiry, interrupted upload, unknown
  response, reconnect/restart and deletion/off behavior.
- [ ] Test overlapping medication configuration, SOS/fall and photo capture;
  preserve emergency priority and current reporting restoration.
- [ ] With an operator-approved neutral test recording, verify actual audible
  playback, displayed text, chosen days/time, independent slots, off, global
  alert profiles, reboot and gateway-disconnected execution separately.
- [ ] Record results in the V52 acceptance ledger and update the QA Wiki when
  implementation changes what is built. Enable the app option only after the
  target firmware and platform acceptance pass.

The two-way voice-message PR is a sibling feature. Shared audio tooling may be
reused after its format is proven; these remain separate commands and contracts.

## Reference recorder, 5 October checkpoint

`gateway/scripts/capture-medication-session.js` wraps the existing transparent
movement relay. It forwards the selected watch's original bytes unchanged to
AnyTracking or the local Guardian backend, and generates no commands or ACKs.
It opens no listener/files without `--run`. Raw TAKEPILLS and TK frames only are
saved to a separate explicitly named private file; other traffic has redacted
metadata. TK is included in case the supplier transfers a medicine recording
separately. Capturing it does not prove it belongs to a specific reminder.

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

Fifteen focused relay/recorder tests pass, including exact split binary
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
The enable value is 0 (documented as off), consistent with that report; the
selected repeat row is not yet confirmed. This sample separates
the repeat field from the reminder number but does not settle the complete
repeat/day/slot mapping. The supplied screen shows three named rows, Once,
Daily and Customize; that screenshot alone does not prove the submitted state.

The capture finished cleanly with 16 observed frames, two privately saved
TAKEPILLS frames, no framing/storage failure and no private limit reached.
Private recordings, reminder text, device identifiers and raw frames remain
outside Git. No Guardian medication command was sent. Actual activation,
scheduled playback after returning to Guardian, off/removal and persistence
remain acceptance items.
