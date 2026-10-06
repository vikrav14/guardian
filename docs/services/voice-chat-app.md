# V52 recorded voice messages in Guardian

Status: implemented as a gated pilot in PR #145 on 6 October 2026, after
PRs #147/#148 merged. The branch now contains binary TK receive/send, private
storage, audio conversion and the Android/Web conversation. The exact-account
pilot was installed and enabled at 17:12 MUT. The operator confirmed audible
short clips in both Guardian Android directions at 17:17. Web hardware playback,
long clips and adverse-case acceptance remain pending. See the updated
[reference evidence and controlled check](../testing/voice-chat-reference.md).

## Product flow

The selected **Action button** design adds **Voice messages** to the wearer's Home card,
below Call watch / View journey and above incident Photos.
Use the selected wearer's identity consistently, with an unread count when
available. Keep the existing bottom navigation; open a dedicated conversation
screen from the wearer context.

The conversation uses the wearer's and guardian's profile avatars, with initials
when no photo is available, and incoming/outgoing bubbles with actual playback
progress. The Home action shares View journey's typography and button style.

New, durably stored incoming clips trigger one best-effort FCM attempt to the
authorized pilot guardian's registered devices. The notice is generic and
contains no audio or wearer name. Receipt replies remain independent of push
success; duplicate uploads do not create another notification. Android supports
foreground, background and cold-start taps; Web uses an in-app banner when open
and a conversation link from its background notification. A tap rechecks the
signed-in recipient and live message access before opening the conversation.
An already-open conversation refreshes without autoplay or another popup.
Provider acceptance does not establish phone delivery. Notification permission,
registered tokens and network availability are required; real phone receipt and
tap-to-open still need acceptance for this revision. Push failure is not retried.

- **Watch to guardian:** the wearer records a message using the watch's voice
  message function. An authorized guardian sees an incoming clip, duration,
  receipt time and Play/Stop control in that wearer's conversation.
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

Implemented product bounds: retain clips for
24 hours with a visible expiry notice, and cap a recording at 30 seconds. These are
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

Offline inspection on 6 October found a complete supplier-to-watch `TK` frame
in the existing bounded 5 October reference. It contained correctly escaped
AMR-NB, 8 kHz mono, mode 7 (12.2 kb/s), 79 complete frames / 1.58 seconds. A
subsequent exact `TK,1` receive-result frame was recorded. No clip was played by
the inspection, and the operator did not confirm audible playback or associate
that clip with a specific supplier-app action. This validates one captured
historical downlink structure. In a separate controlled 6 October comparison,
the selected watch exchanged a 5.24-second app-to-watch clip and a 6.96-second
watch-to-app clip. Both were complete AMR-NB mode 7 files with all five escapes
and exact `TK,1` results. The operator confirmed audible playback on the watch
and in AnyTracking; an initial app-silence report was corrected as low phone
volume. A subsequent bare `TK` is recorded separately with unverified meaning.
The linked reference note contains metadata only. No Guardian voice deployment,
maximum duration, transaction correlation or general reliability is established.
Private audio is excluded from the repository.

## Existing implementation and reusable work

Main `2b477228ac52526c9e0b81b6f80784e103aa18ea` and the currently combined
checkout do not contain a complete TK audio/app flow. The parser acknowledges
`TKQ`; that separate packet does not implement `TK` media delivery. The generic
command/downlink path builds and logs ASCII strings and must not carry audio.

The 6 October integration baseline also includes the merged voice-medication
feature. Its bounded worker-based PCM-to-AMR encoder, synthetic codec tests and
Flutter recording/preview patterns are reusable. The medication sender's slot
ownership, schedule, settings ACK handling and ten-second product cap are not
the ordinary voice-message contract. Preserve those paths while introducing a
separate binary TK transport and conversation authorization/storage model.

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
- [x] Capture short wearer-recorded and supplier-app outgoing clips; verify
  codec/profile, framing, escaping, results and operator-reported playback in
  both directions (6 October supplier reference).
- [ ] Establish accepted byte/duration limits and timeout/reconnect behavior;
  the short reference clips do not validate the proposed 30-second cap.
- [x] Implement private binary receive/store/ACK, bounded authorized send and
  server-owned delivery metadata, with cleanup and conversion where required.
- [x] Implement Android/Web wearer-scoped conversation, recording, playback,
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
PR #144 has since merged after independent TAKEPILLS wire and audible-playback
verification. TAKEPILLS and the bidirectional TK reference remain separate;
neither establishes playback in Guardian's inbox or all TK firmware limits.

## Implemented pilot and rollout

Gateway flags are `VOICE_MESSAGES_ENABLED=true`, `VOICE_MESSAGES_PILOT_IMEI`
and `VOICE_MESSAGES_PILOT_UID`; all three must match a current linked user with
an active server-owned Family/Care entitlement. The Flutter build additionally
requires `GUARDIAN_VOICE_MESSAGES_PILOT_IMEI` and `GUARDIAN_GATEWAY_URL`.
The Home button remains absent when eligibility cannot be verified. Broader
package placement and multi-guardian access are not released by this pilot.

Deploy the `voiceMessages` IMEI/createdAtMs index and private collection rules
before enabling a supervised pilot. This PR does not modify the existing
gateway environment or deploy a new runtime automatically.

- `/app/voice-messages` supports authenticated GET history and POST send;
  `/audio`, `/played` and `/delete` recheck current access. Audio is a private
  authenticated WAV response with no-store headers, never a public URL.
- PCM16 mono 8 kHz is converted in a worker to the captured AMR-NB mode 7
  format. Incoming audio is validated and decoded to PCM in a worker. Workers
  have a five-second limit and two-job bound. Binary payloads bypass generic
  text logging even with the pilot disabled. Bare TK is consumed without reply.
- Audio and metadata commit atomically in private Firestore documents before
  incoming TK,1. Storage/authorization failure uses TK,0. Malformed, disabled
  or unmatched frames do not receive a success ACK. No raw audio is logged.
- Outgoing audio uses SG TK, one current socket, explicit Send, a UUID request,
  a 30-second dispatch lease and a 10-second reply observation. Delivery state
  is persisted before writing bytes. Node write completion is not receipt.
- An exact same-session TK,1 is shown as **Watch replied**, not heard. TK,0 is
  rejected. Silence, disconnect or ambiguous persistence produces **Send
  unconfirmed** and latches further sends across gateway restarts. There is
  no automatic replay, reconnect resend or app retry. Recovery of that latch
  currently requires operator investigation; there is no customer unlock.
- TK has no message ID. The one-active-send rule, one-minute spacing and
  ambiguity latch reduce misassociation; a delayed duplicate result from an
  earlier successful send still cannot be conclusively correlated. This
  limitation remains part of physical acceptance, not a delivery guarantee.
- A bounded voice lease holds routine settings until the reply window ends.
  Calls, protocol ACKs, stop commands and emergency camera/location work stay
  prompt. A live incident capture rejects a new outgoing voice send. Hardware
  overlap behavior still needs acceptance; software never adds photo retries.
- Both directions share a 120-new-message/device/UTC-day storage cap. Incoming
  byte-identical audio is deduplicated per UTC day, because TK supplies no
  message identifier. Identical intentional clips in that day are also folded;
  a retransmission across midnight can appear again. No exactly-once claim.
- Media becomes inaccessible at 24 hours. A minute cleanup task removes expired
  audio in batches; a stopped gateway cannot perform physical deletion until
  resumed. Minimal receipt/idempotency metadata is kept up to seven days.
  Delete removes both PCM and AMR while retaining any uncertain-send latch.
- The app keeps drafts in memory, never uploads before Send, stops recording
  and playback on background/auth changes, and clears private conversation
  data when access fails. The microphone has an explicit stop and 30-second
  cap. New messages do not autoplay. Playback marks only **Played here**.

The controlled supplier reference proves short clips in both directions.
The Guardian Android pilot also passed audible 4.00-second outgoing and
3.86-second incoming clips. Thirty-second playback, Web microphone/speaker
behavior, offline/late-result recovery and multi-guardian policy remain release
checks.
