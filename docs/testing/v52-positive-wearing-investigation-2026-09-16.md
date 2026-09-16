# Automatic wearing: remaining signal investigation

## Product correction

The requirement is automatic, current wrist detection in the overview. The
operator rejected the unknown-status/manual-family-check experience on
16 September. Those controls are implemented, but they do **not** complete this
requirement. A software test passing or a family check does not accept automatic
wearing. No customer acceptance flag or display wording is changed by this work.

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

## Supplier question prepared; not sent

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
   cached-value behaviour, and no-contact/failed-measurement codes. Does the
   optical module expose contact validity or signal quality over TCP?
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
