# Voice-message implementation check — 6 October 2026

PR #145 now implements the ordinary recorded-message flow, with the selected
Home-card Action button and an Android/Web wearer conversation. This is a
software checkpoint; the live gateway and installed app have not been replaced.

## Validation

- Full gateway regression suite: 1,741 passing tests, including 19 new voice
  tests. Coverage includes all documented escapes, split/coalesced framing,
  malformed private headers, codec bounds/conversion, storage-before-ACK,
  duplicate requests, revoked access, connection/write uncertainty, durable
  dispatch locks, cleanup, and emergency/photo/coordinator overlap.
- Full Firestore emulator suite: 96 passing tests, including real concurrent
  voice transactions, private collection denial for linked and unrelated users,
  private audio deletion, expiry and retention of uncertain dispatch locks.
- Twelve Flutter conversation/service tests cover explicit record/preview/send, no autoplay,
  private playback/deletion, recording duration bounds, permission/background
  races, late audio downloads, no resend after timeout, offline/revoked access,
  unread action and a 320-pixel screen with larger text.
- The complete Flutter suite passed all 762 tests. Flutter analysis passed.
  Android debug APK and Web release compiled; these
  are development validations, not installation or hosting deployment receipts.
- The implemented 390-pixel conversation was visually reviewed using synthetic
  clips, Guardian colors and a local readable font fallback. Private reference
  audio and actual wearer data are excluded from screenshots and this repository.

## Physical acceptance still required

Enable only the exact account/device pilot after deploying its private rules
and history index. Verify a short clip sent explicitly in Guardian plays on the
watch, then a wearer-recorded clip appears and plays in Guardian. Record Android
and Web microphone/playback results separately. Do not generate messages from a
background observer or automatically repeat a send whose result is unknown.

The supplier reference confirms 5.24-second and 6.96-second clips, not Guardian
runtime behavior or the 30-second product cap. TK provides no message ID or heard
receipt. Ambiguous sends remain blocked pending operator investigation. Identical
incoming bytes are deduplicated per UTC day; multi-guardian access and broader
release/package placement remain outside this single-account pilot. See the
[implementation and limitations](../services/voice-chat-app.md).

SOS/fall photo reliability and cross-alarm grouping remain tracked by issue #149.
No SOS, fall, camera, call, monitoring or WhatsApp behavior was activated here.
