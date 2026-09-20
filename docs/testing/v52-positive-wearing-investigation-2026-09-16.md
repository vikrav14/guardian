# Automatic wearing: remaining signal investigation

## Product correction

The requirement is automatic, current wrist detection in the overview. The
operator rejected the unknown-status/manual-family-check experience on
16 September. Those controls are implemented, but they do **not** complete this
requirement. A software test passing or a family check does not accept automatic
wearing. No customer acceptance flag or display wording is changed by this work.

## Receive coverage correction and completed worn-only baseline

The operator's question about checking every incoming packet identifies a real
diagnostic gap: the existing receipt census skips decoder errors and retains
metadata rather than full payloads. Its complete byte accounting applies to one
closed repeat session, not every session or what the watch is sending now.
A raw baseline was therefore needed before ruling out a missed incoming field.

The [five-minute pre-decoder byte capture](v52-worn-wire-capture-2026-09-16.md)
preserves the original received stream for the consented exact pilot, including
unknown payloads, rejected frames and unfinished fragments. It reports gaps and
socket byte accounting explicitly. The operator completed that baseline at
22:30:59–22:35:59 Mauritius. Independent length-based reconstruction consumed
all **732 bytes** and matched the socket counters: **2 LK, 1 TKQ and 4 UD_LTE**,
with zero drops, rejected frames, untracked sessions or unfinished fragments.
Every UD_LTE has fixed-field state `00000000`; the complete payloads have no extra
contact field identified and there is no separate unknown command. No current
bit-3 signal was being missed by the parser in this window.

This is a complete diagnostic result, not positive wearing acceptance. A setting
or query could still expose contact outside this passive baseline. The next
step is the exact-firmware supplier question below, now updated with this result;
another unchanged removal cycle is not requested.

## Concrete implementation route after the repeat

The direct route is an exact-firmware setting or firmware change that exposes
**current contact**, including return to the wrist, independently of the removal
alarm event. First ask whether this build already supports such a setting; if
not, request the existing documented bit-3 contract to be implemented and
periodically reported. Supplier availability of that change is not yet known.

Guardian already parses the fixed status field and implements `v52_bit3_worn`
behind exact-device acceptance. With accepted fresh repeated bit-3 observations,
the overview already renders **Wearing detected**; it invalidates the claim on
removal, conflicting/stale evidence and disconnect. Re-running 40 existing
focused decoder, ACK and wearing tests passes. This confirms the software path,
not the present hardware's ability to supply its input. No new algorithm can
distinguish the observed on/off states from their identical zero-bit reports.

The [firmware request and supplier-contact record](v52-current-contact-firmware-request-2026-09-16.md)
contains the two exact firmware labels, required reporting behaviour, observed
counterexample and matching AL acknowledgement evidence. On 16 September the
operator sent the core current-contact questions and firmware labels to Jett
via WhatsApp (screenshot time 23:00 Mauritius). We are awaiting his response;
the longer request contains additional engineering follow-up detail.
No further identical removal cycle is required. A changed firmware or documented
contact interface would justify a new, targeted acceptance comparison.

### Source corrections from reopening the original documents

- Original Protocol section II.26, page 8, defines the leading oxygen argument
  as measurement type, with `0` for device-initiated measurement. The previous
  statement that its basic interpretation was unknown was too broad. It is not
  a documented contact-quality flag or an acknowledgement result sent by the
  watch; the response status belongs to the server's separate reply.
- Original Protocol page 3 explicitly shows `[SG*…*0002*AL]` as the response to
  `AL_LTE`. The repeat captured that form with matching ID/length and a locally
  completed write in 5 ms. Changing the prefix, adding an AL result code or
  changing it to `AL_LTE` is not supported by this source.
- Page 13 labels bit 3 wearing. Page 18 leaves it blank in the **CDMA** annex;
  that annex must not replace the non-CDMA V52 LTE table. The separate Example
  still calls bit 3 unused. Exact firmware behaviour, not selecting a convenient
  table, must resolve the discrepancy.
- Another manufacturer's [published protocol](https://www.4p-touch.com/beesure-gps-setracker-server-protocol.html),
  section III.3, names bphrt arguments 4–7 as height, sex, age and weight.
  This is a useful explanation for the four empty slots, not an accepted V52
  field mapping. It provides no hidden contact flag to turn on in Guardian.
- The same other-manufacturer source distinguishes removal alarms from removal
  SMS. SMS/modem interaction remains a possible disconnect hypothesis, not a
  demonstrated cause or a reason to change this pilot's alert settings. The
  original V52 protocol's general `MOD` setting affects more than this alarm.

The primary PDFs remain the operator-supplied originals identified by name and
SHA-256 in the [source inventory](v52-temperature-wearing-capability-research-2026-09-15.md).
The latest [repeat review](v52-removal-ack-capture-2026-09-16.md) includes the
1,727-byte incoming-session accounting and completes the cleanup evidence.

## What the existing evidence rules out

| Evidence | Consequence |
| --- | --- |
| Worn and removed live UD packets both contain `00000000` | Inverting bit 3 or treating zero as worn cannot solve detection. |
| A removal alarm is followed by zero-bit UD while the watch remains off | Clearing bit 20 is not restoration. |
| The removed temperature comparison returned `btemp2,1,36.53` | A plausible temperature and its leading `1` cannot establish skin contact. |
| The saved 17:37–18:01 Mauritius capture contains 44 packet records: 29 UD_LTE, 7 LK, 2 TKQ, 2 REMOVE, 2 CR, 1 AL_LTE and 1 DEVMESSAGE | The receipt capture already inventories every decoded command, not just selected wearing fields. There is no separately named restoration message in this excerpt. It does not cover every possible firmware behaviour or reveal unretained fields. |
| The heart-rate decoder retains the three documented leading bphrt fields and discards trailing fields | Additional quality/failure/contact data, if supplied, needs a separate bounded capture before interpretation. |

The receipt capture has no dropped packet numbers (1–44); the supplied excerpt
does not include its eventual `capture_finished` marker. The exact physical
return time is not established by this file. The capture contains no bphrt or
oxygen upload, so it cannot answer the optical-sensor question.

Sources in the repository: [temperature comparison and conflicting vendor
documents](v52-temperature-wearing-capability-research-2026-09-15.md),
[removal/ACK field checkpoint](v52-removal-ack-capture-2026-09-16.md), and
the private operator attachment `Pasted text(20260916-140224).txt`. Raw health
payloads and personal/device identifiers are not copied into this document.

## Primary integration research

- [Flespi's V52 integration](https://flespi.com/devices/reachfar-v52) lists
  wristband-connected status separately from the takeoff alarm. The page does
  not give the byte/bit mapping, prerequisites or tested firmware revision.
  It is a lead for a supplier/integrator question, not exact-watch proof.
- [Flespi's ReachFar changelog](https://forum.flespi.com/d/432-changelog-reachfar-protocol)
  describes DEVMESSAGE as SMS forwarding; the diagnostic did not retain its
  payload. The changelog does not document a positive contact contract.
- [Traccar's Watch decoder](https://github.com/traccar/traccar/blob/master/src/main/java/org/traccar/protocol/WatchProtocolDecoder.java)
  parses removal alarm bit 20 and numeric heart/temperature/oxygen values.
  The reviewed implementation provides no additional positive wearing mapping
  to transplant into Guardian. Its mixed-model mappings are not V52 acceptance.

These sources were inspected on 16 September 2026. Public integration support
does not resolve the conflicting supplied bit-3 descriptions or the exact
firmware's all-zero field observations.

## On-wrist baseline capture, 16 September at 20:58 Mauritius time

The operator reported a heart result on the watch at 20:58. The requested
on-wrist baseline produced two consent-gated sensor records in session 1:

| Response | Received UTC / Mauritius | Fields retained | Finding |
| --- | --- | --- | --- |
| bphrt | 16:58:16.242 / 20:58:16.242 | Seven arguments: three populated leading reading fields; arguments 3–6 empty | No additional contact, quality or failure field is populated in this response. |
| oxygen | 16:58:16.443 / 20:58:16.443 | Two arguments: a leading `0` and a numeric reading | Original Protocol II.26 defines `0` as device-initiated measurement type; it is not a contact flag. |

Both records report matching declared/actual payload lengths (40 and 32 total
frame bytes respectively). They arrived 201 ms apart. These are gateway receipt
times, consistent with the reported watch-result minute; the packets supply no
verified measurement timestamp or request correlation. The operator has not
provided the displayed numeric value for an exact screen-to-packet comparison.

The private source is
`1789577837381-c6175bb1-8858-4c60-909c-a76d6ae2f324.jsonl`.
Individual health values remain out of repository/PR documentation. This is an
observed packet shape, not a medical-accuracy or wearing-acceptance result.

An earlier launcher attempt printed capture-armed messages and then failed with
`journey_journal_writer_already_running`. That process did not finish gateway
startup. The supplied sensor file is a different, later capture and proves that
a subsequent run received these responses. It does not prove uninterrupted
connectivity after those records. Do not bypass or delete an active journal
writer's lock to start another gateway.

**Outcome:** the complete response has now been inspected. Empty trailing slots
do not reveal a missed positive contact flag in this sample. The result does not
prove that all firmware modes lack contact detection. Numeric presence, empty
fields and the oxygen prefix are not promoted into automatic wearing evidence.

**Next action:** obtain the firmware contract described below. In particular,
confirm the exact-build meaning of the four empty bphrt slots, how
no-contact/failed measurement is encoded, whether readings may be cached, and
which supported interface reports current contact and restoration. These
unresolved definitions give the supplier a specific question. Do not repeat
this same worn measurement or another removal-alarm cycle to seek a different
interpretation of the same fields. Any further optical comparison should target
a concrete validity/failure signal or firmware prerequisite.

The initial on-wrist check below is therefore **completed**, not a request for
another measurement. The capture window expires automatically; the gateway
can remain running. No new app build, deployment or device command follows
from this result.

## New bounded diagnostic: complete optical response fields

`npm run wear:sensor-capture` replaces `npm start` for one run. It enables the
existing packet/connection census plus a private sensor-response observer:

- At most ten bphrt/oxygen responses within ten minutes, including command-case
  variants, empty results, failure text and trailing fields. These are opaque
  evidence, not accepted contact or health-quality flags.
- The exact configured pilot and existing backend-managed wellbeing consent
  are required. Consent is checked for each saved packet and after queued work.
- Responses are saved in a local private JSONL file under
  `gateway/data/wear-sensor-captures/`. Values are absent from ordinary logs.
  Receipt time and connection number are retained; no measurement timestamp is
  invented. The existing separate packet census lasts up to thirty minutes.
- The observer runs after normal ACK writes. It sends no watch commands,
  enables no schedule/removal/SMS setting and changes no parsed events,
  Firestore records, dashboard claim or Wellness qualification. Existing
  gateway processing continues normally, including unverified pilot ingestion.
- The capture expires without stopping the gateway. There is no new Flutter
  build or Firestore rules deployment for this diagnostic.

### First check: stay on wrist

Do not begin another removal cycle. While the operator is wearing the watch:

1. Pull `feat/v52-care-wellbeing`. Stop the one running gateway with Ctrl+C in
   its terminal; keep ngrok running. Start the replacement gateway:

   ```powershell
   cd C:\Users\MSI\repos\guardian\gateway
   npm run wear:sensor-capture
   ```

2. Wait for the watch's live connection and the `[wear-sensor-capture]` armed
   line. In a second terminal use `npm run wear:trial` to confirm connection.
   Record the local time with `Get-Date -Format o`.
3. Start **one heart-rate measurement using the watch's own screen**. Record
   what the watch displays, including any error, and the completion time.
   Do not send `hrtstart,1`: the earlier exact-watch trial captured a bare reply
   without a visible measurement, so it would add ambiguity here.
4. After it completes, allow up to two minutes for an upload. Supply the private
   sensor JSONL indicated by `savedTo`, or the capture status lines if no file
   was saved. Share the file privately; do not paste health data into GitHub.
   Keep the watch on while the result is reviewed.

If no response is saved, inspect the already-running command census and consent
status first. Absence of an upload is not evidence of removal or sensor failure.
Do not change acceptance/consent flags or repeat requests to force a result.

### Decision after that check

- An explicit additional field or failure code is a candidate, not proof. Ask
  for its firmware contract, then perform a targeted worn/off/restored comparison
  with exact physical times and a fresh response in each phase. Keep existing
  removal alarm settings unchanged. Do not infer the code's meaning from one
  correlated observation.
- If the packet contains only plausible numbers and no reliable validity or
  contact information, stop treating numeric presence as a wearing solution.
  Seek a firmware contact/status interface. A lack of numbers cannot prove off
  wrist either; it may be a delivery or measurement failure.
- Before enabling a customer wearing claim, validate stationary worn use,
  off-wrist readings, a held/moving watch, refitting, stale/cached replies,
  disconnect/reconnect and charging. Contact proof must carry a defined age;
  alarm, contradictory evidence or expiry must end a positive claim. Do not
  invent confidence percentages from these few pilot samples.

## Supplier follow-up: core contact questions sent to Jett

The operator's WhatsApp asks for a current sensor-state query, bit-3/restoration
enablement or compatible firmware, with exact commands and example replies.
It has been sent; no supplier answer or firmware-team escalation is confirmed.
The question set below retains further detail for that engineering discussion.

For these two labels, in their observed wire order (roles not established):

```text
C403H_RFHZ_V52_EN_750_V1.3_2025.03.10_18.29.29
C403H_RFHZ_V52_EN_04R6_V1.3_2025.03.10_18.29.29
```

Ask ReachFar's firmware team to provide:

1. The continuous current contact state and explicit restored state supported
   by this firmware, including packet examples, bit/field, polarity, timestamps
   and reporting behaviour. Resolve Protocol p13's wearing bit 3 versus Example
   p5's unused bit 3. We observe zero on and off wrist, with bit-20 removal alarms.
2. Any prerequisite documented command, applied-setting readback and rollback;
   whether the contact state works independently of removal/SMS alarm enablement.
3. The exact bphrt/oxygen response-field definitions, fresh-measurement versus
   cached-value behaviour, and no-contact/failed-measurement codes. The on-wrist
   bphrt upload contained three populated reading fields and four empty trailing
   fields; oxygen had measurement type `0` as defined by Protocol II.26. Confirm
   this build's no-contact behaviour. Does the optical module expose contact validity or signal
   quality over TCP?
4. If this build emits only removal events, a compatible firmware that reports
   both current contact and restoration. If unavailable, explicitly confirm the
   capability limit so hardware suitability can be evaluated against the
   automatic-wearing requirement.

The separate repeated approximately 154-second post-alarm disconnect remains
unresolved. No new removal-alarm trial or network setting change is needed for
the first optical-response capture.

## Verification

Focused Node tests verify the real decoder's unchanged events/ACKs, consent and
pilot isolation, complete field retention, expiry during slow consent reads,
packet/size bounds, private file output and failure isolation. These tests
verify the diagnostic only, not an automatic wearing detector. Wiki mirror of
this product limitation remains pending; this document is the repo checkpoint.
