# SOS voice messages

| Field | Value |
|---|---|
| Service ID | `voice-messages` |
| Minimum package | Family |
| Current state | Implemented behind a disabled acceptance flag |
| Customer-visible | No |
| Protocol surface | V52 `TK` with escaped AMR bytes |
| Local retention | Maximum 24 hours |
| WhatsApp template | `guardian_sos_voice_ready_v1` (approval required) |

This service is a short, wearer-recorded message associated with a real SOS.
It is not `MONITOR`, live streaming, automatic ambient recording or remote
microphone activation.

## Customer flow

1. The watch creates a normal SOS alert. Guardian sends that alert immediately;
   it never waits for audio.
2. The wearer uses the V52 voice-message function to record a short message.
3. The watch uploads a `TK` packet over mobile data.
4. Guardian accepts the clip only when the same IMEI has an unresolved SOS from
   the preceding 30 minutes and the family has an entitled WhatsApp recipient.
5. Guardian sends a second approved utility template saying that an SOS voice
   message is ready.
6. The recipient taps **Play SOS voice message**. The quick reply is bound to
   that recipient and opens WhatsApp's customer-service window.
7. Only then does Guardian upload the AMR file to Meta and send it as an audio
   message. If the clip is missing, expired or belongs to another recipient,
   Guardian sends no audio.

The two-message design is intentional. Meta permits free-form audio messages
inside a customer-service window, while templates are required outside that
window. A template quick reply creates the recipient action needed before the
audio is released.

## Implemented controls

- binary-safe V52 frame parsing; ordinary ASCII telemetry remains unchanged
- vendor escape decoding for `0x7d`, `[`, `]`, comma and asterisk
- AMR-NB file/frame validation; AMR-WB is detected but fails closed until the
  exact hardware codec and provider delivery path are accepted
- 512 KiB and 30-second hard limits
- deferred `TK,1` acknowledgement only after durable SOS-bound storage
- `TK,0` for invalid, disabled, unentitled or non-SOS audio
- deterministic clip IDs to suppress device retries
- private Firebase Storage objects with no client read rule or download token
- opaque per-recipient quick replies; the document key is an HMAC over token
  and recipient, so neither token nor phone number is stored
- 24-hour local expiry and cleanup, including a Meta media delete request
- no audio bytes, recipient numbers or playback tokens in logs

Meta currently documents AMR as a supported WhatsApp audio format, so Guardian
does not transcode a valid watch clip. Meta also documents provider-side media
retention; local deletion cannot retroactively change a provider's retention
obligations after a recipient asks WhatsApp to play the clip. This disclosure
must be included in the final privacy review.

## Required configuration

```dotenv
FIREBASE_STORAGE_BUCKET=your-firebase-storage-bucket
SOS_VOICE_MESSAGES_ENABLED=false
META_WHATSAPP_SOS_VOICE_TEMPLATE=guardian_sos_voice_ready_v1
SOS_VOICE_RETENTION_HOURS=24
SOS_VOICE_CLEANUP_MINUTES=15
```

The feature flag must remain `false` until the hardware and template gates
below pass.

## Template awaiting submission

- Name: `guardian_sos_voice_ready_v1`
- Language: English (`en`)
- Category: Utility
- Body: `Guardian received an SOS voice message from {{1}} after the SOS at {{2}}. Tap below to play it. The message expires after 24 hours.`
- Button: one Quick Reply named `Play SOS voice message`
- Runtime body parameters: wearer name, SOS time
- Runtime button payload: opaque recipient-bound token

## Real-device acceptance still required

- confirm that this exact V52 firmware sends a complete AMR file in one `TK`
  frame rather than undocumented chunks
- record a five-second watch message and require `TK,1` only after storage
- play the resulting WhatsApp audio and verify intelligibility
- reject a clip recorded without an active SOS
- reject a copied button from a different phone
- verify the clip and playback capability expire after the configured window
- measure on-wire bytes for 5-, 15- and 30-second recordings
- confirm the normal SOS template still arrives when recording never happens
- obtain approval for `guardian_sos_voice_ready_v1`

Automated tests prove the parser, policy, storage contract and Meta payloads.
They do not prove how the physical watch firmware packages its recordings.

## Sources

- ReachFar V46/V48/V52 communication protocol, section 36 (`TK`, AMR and byte escaping)
- V52 user manual: watch/app voice messages use the data plan rather than phone calls
- [Meta audio messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/audio-messages)
- [Meta template fundamentals](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview)
