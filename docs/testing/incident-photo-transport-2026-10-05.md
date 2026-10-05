# SOS photo transport investigation — 5 October 2026

All times below are Mauritius (UTC+4). No identities, coordinates, radios,
recipient numbers or media are included. These are separate from the earlier
ACK-without-image failures in the 2 October reports.

## Observed SOS

- Gateway e7a69d0 started at 12:51:21 with the preserved private environment;
  ngrok started at 12:51:20. The operator updated the watch's newly assigned TCP
  endpoint by SMS and reported OK. Watch traffic resumed at 12:54:47.
- SOS receipt: 12:56:56.891. The operator says they cancelled its outgoing call
  within a few seconds. The exact cancellation instant is not in gateway logs.
- First capture authorization: 12:57:02.177, expiring at 13:01:02.177.
  The write trace starts at 12:57:02.260 and records one rcapture attempt 2 ms
  later. It does not record callback completion or establish watch receipt.
- The capture connection's final inbound chunk preceded the camera command:
  12:56:57.747. Its recorded lookback ends with the alarm reply and UPLOAD;
  an UPLOAD echo appears in the gateway log before capture. Raw inbound bytes
  were not retained, so the final chunk's precise content is not reconstructed.
- Another connection opened at 12:57:21.039 and was subsequently identified as
  this watch. It sent heartbeats and other traffic while the old socket stayed
  silent. There was only one connected watch socket at camera dispatch.
- At 12:59:57.755 the gateway destroyed the old socket under its packet-idle
  policy. Its close record has no peer end or socket error. This is a local
  timeout, not proof that the watch/carrier/tunnel closed it. The pending photo
  failed as watch_disconnected, and the sequence stopped with one attempt.
- Through 13:03:02.185 (including the full late-observation grace), the selected
  socket had zero incoming bytes, ACKs or image headers. The replacement had
  11,133 bytes in 74 frames, zero photo headers and zero buffered remainder.
  Diagnostics classified three heartbeats and 71 other frames; do not relabel
  those 71 from assumptions about packet spelling. No bytes/events were lost
  to diagnostic caps, and no logging failures were recorded.
- There was no second capture or manual CR. Only required protocol replies
  were recorded during capture after rcapture, on the replacement connection.
  Later automatic recovery CR commands remain in the original gateway logs.

## Independently verified outcomes

One initial WhatsApp recipient: delivered 12:57:13, read 12:57:39. Another was
rejected with Meta 131030. Photos & AI follow-up: delivered 13:00:09, read
13:00:11 to the accepted recipient; the other follow-up was not accepted.
The authorized gallery correctly reports zero available images and zero AI
summaries. Its Photo 1 card represents a failed request, not a received image.

A read-only historical comparison also found a later 2 October SOS at 23:01:34
with five fully decoded/stored image records, received through 23:07:42. Their
media retention has now expired; this does not claim the old images are still
viewable. Their request-to-first-image-header times were 5.227, 5.040, 9.227,
5.576 and 5.680 seconds. The first request followed SOS by 6.092 seconds,
compared with 5.286 seconds today. An arbitrary longer initial delay is not an
established fix from this comparison.

## Supported conclusion and remaining boundary

Today's capture was associated with a connection that became silent before
the command and was later replaced. The receiver did not reject a arriving
photo in the measured window; there was no image header to decode/store/analyse.
Neither a call-related modem transition nor lost downstream delivery is proved.
The earlier ACK-only failures on uninterrupted sockets remain unexplained by
this different no-ACK event. Do not replay this ambiguous request on reconnect.

## Prepared observational change

`photo-transport-diagnostics.js` records bounded numeric socket counters,
write return/backpressure, callback completion/error timing and a fixed-schema
summary of the last decoder event before capture. It retains no raw payload,
location, identity or arbitrary error text. Completion explicitly means Node
stream evidence, not watch delivery or camera readiness. The callback is not
awaited; capture bytes, readiness policy, deadlines, grants, retries and
initial alert delivery are unchanged. Errors in diagnostics cannot block I/O.

Regression coverage includes a real local TCP exchange; queued/no-callback
timeout; delayed callback without image; async and thrown write errors;
privacy; and today's no-ACK/replacement/old-socket-close ordering. All 68
focused tests and all 1,633 gateway tests pass. This is diagnostic preparation,
not hardware acceptance or a demonstrated camera fix.

The original passive recorder and temporary sleep helper have exited after
the terminal late observation. Runtime rollout is recorded in the local task
report separately; installing files does not update an already running Node
process. Wi-Fi, location selection, Firebase/Maps, tunnel settings and private
environment remain unchanged.
