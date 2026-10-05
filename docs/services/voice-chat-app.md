# V52 recorded voice messages in Guardian

Status: implementation draft opened at the operator's request on 5 October 2026.
This first commit contains the source audit, app flow and acceptance plan only.
No TK receiver, audio sender, app inbox or microphone behavior is activated.

## Product flow

Add **Voice messages** to the wearer's Home card/actions and wearer details.
Use the selected wearer's identity consistently, with an unread count when
available. Keep the existing bottom navigation; open a dedicated conversation
screen from the wearer context.

- **Watch to guardian:** the wearer records a message using the watch's voice
  message function. An authorized guardian sees an incoming clip, duration,
  receipt time and Play/Pause control in that wearer's conversation.
- **Guardian to watch:** the guardian taps Record, explicitly grants microphone
  access, records, stops, previews, then taps Send. Include cancel/delete draft
  and clear upload or delivery errors. Do not autoplay incoming clips.
- Show incoming/outgoing direction and distinguish saved/uploading, waiting for
  the watch, sent, device accepted/rejected, expired and unknown outcome. An
  app playback action may mark a clip played **in Guardian**; the protocol does
  not establish that the wearer listened to an outgoing message.
- Use this ordinary messaging flow without requiring SOS or fall. Existing
  emergency alerts remain independent. This feature adds neither automatic SOS
  recording nor remote microphone activation, calls or listen-in behavior.

Android and Web need recording and playback support. A browser recording's
container/codec is not necessarily AMR. Validate conversion to the accepted
watch format on the server and serve an authorized compatible playback version
where needed. Do not assume raw AMR playback works on both clients.

Initial product proposals, to validate before implementation: retain clips for
24 hours with a visible expiry, and cap a recording at 30 seconds. These are
Guardian bounds, not claimed firmware limits. Enforce the smaller accepted
device byte/duration limits, including frame overhead and escaping. Preserve
existing service entitlement patterns; confirm package placement before release.

## Supplier evidence

The shared V46/V48/V52 Communication Protocol, section II.36 on PDF page 10,
documents bidirectional `TK` with AMR audio and receive results `1` (success)
and `0` (failed). The opposite direction's text says "ARM"; retain the source
discrepancy and validate actual media rather than treating it as another codec.
The original SHA-256 was verified again on 5 October:
`8f01881b9773f9ee762ceb2cc4dff9aa037abfa7a5540d6a723e1f4dd9161dbf`.
See the [supplier inventory](../testing/sedentary-source-audit-2026-09-29.md).

```text
Audio body in either direction: TK,<escaped AMR bytes>
Receive-result body:           TK,1 or TK,0
Envelope:                     [CS*<protocol ID>*<hex wire length>*<body>]
```

The documented escape relationships are:

| Raw audio byte | Escaped wire bytes |
| --- | --- |
| `7D` | `7D 01` |
| `5B` | `7D 02` |
| `5D` | `7D 03` |
| `2C` | `7D 04` |
| `2A` | `7D 05` |

Encode once from raw audio bytes to wire bytes; decode the inverse once. The
printed arrows use opposite directions in the two explanations. Verify the
encoding and length convention with a known captured clip on the exact watch;
do not double-escape delimiters, treat bytes as UTF-8, or copy sample identities.
This section does not prove an SOS-triggered recording command, AMR-NB/WB
profile, maximum clip length, playback receipt, or a transaction identifier.

## Existing implementation and reusable work

Main `0acf707acf7cfb22a23a3fa1bf3c0cc299f907a0` and the currently combined
checkout do not contain a complete TK audio/app flow. The parser acknowledges
`TKQ`; that separate packet does not implement `TK` media delivery. The generic
command/downlink path builds and logs ASCII strings and must not carry audio.

Closed [PR #117](https://github.com/vikrav14/guardian/pull/117), head
`02ae910a95f8ca17d36bf5d18a7be343042a9c58`, contains a prior **SOS-bound,
watch-to-WhatsApp** design and implementation: binary TK handling, validation,
private storage, retention and related tests. It also records the absence of
evidence for automatic microphone recording on SOS.

Audit and extract suitable parser/storage/tests from that branch rather than
blindly merging it. Its SOS-only policy, WhatsApp delivery path and disabled
Flutter contract do not satisfy this request for ordinary bidirectional app
messaging. Old test results do not prove compatibility with the current parser,
photo ingress, authorization rules or shared command coordinator. Keep #117
closed as historical evidence; this new PR owns the revised feature.

## Gateway, storage and coordination requirements

1. **Binary ingress:** bounded length-based framing, split/coalesced packets,
   malformed/truncated escapes and invalid media handling. Distinguish the exact
   TK result bodies from AMR uploads and prevent response loops. Preserve
   location, SOS/fall, image and required protocol-reply behavior.
2. **Private receipt:** establish a valid device session/identity, current
   feature eligibility and access policy before accepting a clip. Persist valid
   audio and metadata durably before returning success. Define failure/disabled
   handling from protocol evidence; never acknowledge successful storage when
   the upload was discarded. Record receipt time rather than inventing capture
   time. Keep media bytes and content out of raw/general logs and public fixtures.
3. **Authorized app access:** server-validated linked-wearer reads, uploads and
   sends; private object storage, short-lived access and expiry/deletion. Protect
   original and transcoded files equally. Revoke access when membership changes.
   Clients must not set device-result or receipt fields. Update schema and
   Firestore/Storage rules alongside implementation.
4. **Outgoing queue:** validate codec, duration and byte bounds; require preview
   plus an explicit Send. Use an idempotent app request identity and a bounded
   expiry for a never-dispatched message. Recheck session, access and expiry at
   dispatch. Never silently replay after an ambiguous write or reconnect.
5. **Correlation:** TK results have no demonstrated message ID. Permit only one
   unresolved outgoing clip per device and define conservative late-result
   handling. Do not assign a late `TK,1` to a newer clip merely because it is the
   current request. Incoming wearer clips must not be consumed as outgoing ACKs.
6. **Shared coordination:** integrate with the combined per-device decision
   point, including bounded backpressure. Routine media/configuration work may
   wait or expire; emergency handling, calls, required replies and explicit
   stops remain prompt. A photo request must not be silently duplicated or
   blanket-block urgent location handling because voice media is pending.

Text transcription, AI interpretation, WhatsApp audio forwarding and automatic
incident recording are outside this first app feature. A new app voice message
must not depend on the pending SOS/fall Meta template approvals.

## Delivery and acceptance checklist

- [x] Inspect supplier II.36, verify source hash and compare current parsing/app
  paths with closed #117's historical scope.
- [x] Define incoming playback, outgoing record/preview/send and honest states.
- [ ] Capture a wearer-recorded clip and a supplier-app outgoing clip with known
  harmless content; establish codec/profile, escaping, byte limits, results and
  how the watch displays/plays a received message.
- [ ] Implement private binary receive/store/ACK, bounded authorized send and
  server-owned delivery metadata, with cleanup and conversion where required.
- [ ] Implement Android/Web wearer-scoped conversation, recording, playback,
  unread state, expired media and offline/error handling.
- [ ] Test all five escapes, chunk boundaries, malformed lengths/media, oversized
  clips, storage failure, repeated uploads, late ACKs, cross-family access,
  revoked access, expiry/deletion, disconnect/reconnect and restart ambiguity.
- [ ] Test emergency/photo/setting overlap and bounded memory/backpressure.
- [ ] Physically verify audio in both directions, actual app playback and watch
  playback separately, including offline/timeout, no-duplicate, expiry and
  multi-guardian cases. Device acceptance is not a heard/read receipt.
- [ ] Record exact-firmware results in the V52 acceptance ledger, update QA Wiki
  when implementation changes what is built, and release behind a capability
  gate only after the app and hardware checks pass.

Sibling medication-reminder scope: [PR #144](https://github.com/vikrav14/guardian/pull/144).
TAKEPILLS voice encoding remains a separate evidence requirement; do not infer
its payload from this TK contract.
