# V52 voice-message reference: evidence and next check

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

## Missing exact-watch observations

- A short clip explicitly recorded on the watch: upload framing, actual AMR
  profile, supplier acceptance and playback in the guardian app.
- A short clip explicitly recorded in the supplier app and sent once: exact
  send/result sequence, notification on the watch and operator-confirmed sound.
- Device behavior when an outgoing result is delayed or absent, including
  whether an old result can arrive after reconnection. Never infer transaction
  correlation from whichever request is currently pending.

The initial app proposal remains a maximum of 30 seconds and 24-hour retention.
Those are provisional product bounds, not proven firmware limits. A short
successful clip does not validate a 30-second maximum.

## Controlled reference procedure to prepare

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
at its fixed deadline. No new hardware trial was started while preparing this
note; the existing fall recorder has completed and stopped.
