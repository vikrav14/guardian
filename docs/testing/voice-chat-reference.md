# V52 voice-message reference evidence

Updated 6 October 2026. This note prepares PR #145's ordinary recorded-message
feature. It does not enable listening, calls, recording, sending or forwarding.
Times below use Mauritius time (UTC+4).

## Existing captured downlink

An offline, metadata-only inspection of the bounded 5 October reference found:

| Observation | Result |
| --- | --- |
| Supplier TK frame received | 5 October, 21:50:31.339 |
| Prefix and payload length | SG; declared and actual payload both 2,569 bytes |
| Binary structure | Complete frame and closing delimiter; valid documented escapes |
| Unescaped audio | 2,534 bytes, AMR-NB file header |
| Media structure | 8 kHz, mono, mode 7 / 12.2 kb/s; 79 complete 20 ms frames |
| Structural duration | 1.58 seconds |
| Subsequent watch result | 21:50:31.701, 3G, exact four-byte TK,1 payload |

The result has no transaction ID. Its ordering is recorded without claiming a
played/read receipt or an independently proven association with an app action.
No ambient sound or existing clip was played during this inspection. The clip's
purpose and audible outcome were not confirmed by the operator; it must not be
attributed to remote listening or a medication reminder. Private frames and
audio remain outside Git. Synthetic bytes must be used for committed tests.

## Controlled two-way reference, 6 October

The selected watch connected through the bounded transparent relay to the
supplier at 15:39:02.853. Supplier CONFIG, ICCID, LK and TKQ replies followed;
the operator separately confirmed AnyTracking showed Online. The recorder
forwarded original bytes and generated no commands or messages.

| Observation | App to watch | Watch to app |
| --- | --- | --- |
| Audio frame received | 15:39:50.745 | 15:40:20.720 |
| Prefix | SG | 3G |
| Complete wire frame | 8,544 bytes | 11,368 bytes |
| Declared = actual payload | 8,523 bytes | 11,347 bytes |
| Unescaped AMR file | 8,390 bytes | 11,142 bytes |
| AMR profile | NB, 8 kHz mono, mode 7 / 12.2 kb/s | Same |
| Complete 20 ms frames | 262 / 5.24 seconds | 348 / 6.96 seconds |
| Exact receive result | Watch `3G TK,1`, 15:39:51.045 | Supplier `SG TK,1`, 15:40:21.316 |
| Operator playback result | Audible on the watch | Audible in AnyTracking |

Both audio frames contain all five documented escape codes. Their frame lengths,
closing delimiters and complete AMR frame boundaries validate. A separate bare
`3G TK` arrived at 15:40:21.523 after the supplier result. Its meaning is not
established; it must not be treated as audio or as another successful delivery,
and a receiver must avoid an ACK loop.

The operator initially reported silence in AnyTracking, then corrected that the
phone's volume was low and the clips were audible. They separately confirmed
audible playback on the watch. Preserve that correction: the initial report is
not a confirmed codec or playback failure. The observer did not play audio.

These are supplier-reference results, not a tested Guardian inbox/sender. They
establish two short clips and operator-confirmed playback, not firmware duration
limits, maximum size, late-result correlation, a played receipt or reliability
under disconnection. Private frames and audio remain outside Git. The bounded
recorder's final completeness and verified return to Guardian are tracked in the
local run record. The supplier session closed at 15:42:39.896 and fresh identified
Guardian telemetry at 15:43:01.915 verified the operator's reported return.
Recorder and sleep helper exited at 15:44; terminal capture completeness was
true, with five private frames / 19,985 bytes and no limit/write error. Only the
temporary recorder tunnel was removed; Guardian and its original tunnels stayed
running. The reference heartbeat is paused.

## Current reusable implementation

The merged medication feature supplies an isolated, bounded PCM-to-AMR worker,
AMR structure validation, private audio access and Flutter recording/preview
patterns. Reuse the proven media primitives where appropriate; do not copy the
reminder's settings transport, three-slot state or ACK correlation into TK chat.
The older closed PR #117 contains binary parsing/storage tests, but its SOS-only
and WhatsApp-forwarding policy is outside #145 and must not be revived.

Integration must preserve the shared command coordinator, emergency replies,
incident-photo serialization, fixed SMS-off policy and no ambiguous replay.
Main's current medication/photo behavior must remain unchanged while the voice
feature is built behind its own capability gate.

## Remaining exact-watch observations

- Maximum accepted duration/bytes; the two short successful clips do not
  establish these limits or all firmware versions.
- Actual Guardian Android/Web recording, authorized playback and incoming-watch
  notification, once the feature is implemented.
- Device behavior when an outgoing result is delayed or absent, including
  whether an old result can arrive after reconnection. Never infer transaction
  correlation from whichever request is currently pending.

The initial app proposal remains a maximum of 30 seconds and 24-hour retention.
Those are provisional product bounds, not proven firmware limits. A short
successful clip does not validate a 30-second maximum.

## Controlled reference procedure

Use a bounded transparent relay and operator-controlled routing. Verify the
current temporary endpoint and a real identified watch connection before any
message action; stale tunnel ports and public reachability probes are not
device evidence. Preserve existing reminders and all Guardian configuration.
Guardian cannot receive this watch's alarms/locations while it is routed to the
supplier, so restoration and fresh authenticated Guardian traffic must be
verified before completing the reference.

Once the operator is available, use one short neutral clip in each direction,
one explicit send per clip, and record what the operator actually hears. Keep
command/results, durable storage and physical playback as separate outcomes.
Do not invoke Voice monitoring, place calls, trigger alarms, request camera
captures or repeat ambiguous sends. The recorder must remain passive and stop
at its fixed deadline. The separate fall recorder completed before this voice
comparison. No alarm, camera, reminder or listening trial was requested here.
