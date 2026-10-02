# Incident photo spacing — 2 October 2026

## Decision

The operator approved a prompt first SOS/fall photo followed by wider fixed
spacing. Follow-up requests now require at least 60 seconds since the previous
image was saved. Five remains a maximum within the original 12-minute incident
window, not a guaranteed count. The 120-second request deadline, single active
capture, fresh session, current access/consent checks, no replay and stop after
failure remain unchanged. Initial alerts and separate Photos & AI follow-ups
retain their independent delivery flow. No movement-based trigger, repeated
CR, new firmware command or change to reporting priority is introduced.

## Earlier hardware evidence (Mauritius time)

- 12:50:44 SOS: initial WhatsApp delivered, one capture ACK, no image before
  timeout. The capture trace contained RCAPTURE and a required UD reply only.
- 13:30:13 SOS: initial WhatsApp delivered at 13:30:24. Photo 1 was saved at
  13:31:23.912; its stored JPEG and ready AI were independently verified.
  Photo 2 followed the save by 10.856 seconds, received an ACK and no image,
  then timed out at 13:33:34.768. The sequence stopped with one actual image.
- The second failed wait included UPLOAD,60 at 13:33:15.354. Emergency reporting
  is allowed through coordination. This overlap does not establish causation;
  the earlier SOS failed without a competing routine command. No camera root
  cause has been established. Wider spacing has not yet been tested on hardware.
- The separate second Photos & AI update has a delivered receipt at 13:33:49.
  One initial-alert recipient was rejected with Meta 131030; no contacts or
  allowlists were changed. Gallery backend availability is verified, phone UI
  navigation and image/AI content accuracy are not.
- The operator confirmed that the proposed independent fall test did not occur.

Private runtime evidence remains in the local incident-test archive; no image
contents, raw locations, recipient numbers or credentials are included here.

## Regression coverage

The incident harness checks the prompt first photo, a full minute from save
(including delayed image arrival), rejection at 59.999 seconds, exactly one
capture at the boundary across workers/restart, passive packet freshness,
consent/access/deadline/disconnect rechecks, five-photo maximum, timeout stop,
preservation of earlier media, no replay, and independent AI/follow-up work.
The existing command tests retain prompt emergency/CR/replies/calls/stops and
routine work deferral. The minute between captures does not hold a camera guard.

Validation: `node --test` passed all 1,601 gateway tests with no skipped or
failed tests. The focused incident/coordination/live-snapshot/ops run passed
63 tests. No Flutter code or Android configuration changed in this update.

Hardware acceptance for this spacing remains pending a new operator-triggered
SOS and then a separate safe watch-only fall test outside the grouping window.
Record actual images, AI/gallery state and provider delivery independently.

## Local rollout

At 13:57 Mauritius time, a read-only check confirmed no pending photo alerts,
collecting incidents, active captures or pending/claimed follow-ups. The gateway
was restarted through the preserved combined launcher from the original working
directory. At 13:57:42, the watch was reconnected; live worker status reported
the 60-second gap, five-photo maximum and 720-second incident window. Both photo
and AI remained enabled; no old capture or follow-up was replayed. Local and
public health returned HTTP 200. The existing ngrok process and both tunnels
remained running. Hash checks confirmed no change to the original `.env`, mobile
`android-config.json` or preserved private runtime environment. Journey/Wi-Fi
work was preserved. This is rollout verification, not a new photo trial.

## Subsequent hardware evidence and ingress diagnostics

The 14:05:26 SOS completed five stored images and five ready AI analyses; the
separate Photos & AI update was delivered/read at 14:14:38. Save-to-next-request
gaps were 61.664, 161.417, 178.737 and 62.157 seconds. Fresh-session gating can
make the gap longer than the minimum minute.

The independent fall at 14:29:46 saved two images with ready analyses. Its third
request at 14:33:11 followed the second save by 113.461 seconds but received only
a 29-byte rcapture reply, with no image bytes in the two-minute authorization
window. The command trace contains RCAPTURE only during that wait. It expired
at 14:35:11 and the periodic sweep persisted failure at 14:35:38. The initial
alert and separate follow-up were delivered independently. One other intended
initial recipient was rejected with Meta 131030; contacts were not changed.
The operator did not observe the screen state. Spacing is not a proven fix.

The new `[photo-ingress]` observer closes a diagnostic gap after the pending
capture slot is removed. It counts bytes before framing and emits fixed-schema
header/disposition metadata, including unidentified and replacement connections.
It never records payloads, raw protocol/device identities, addresses, scene
text or credentials, and never writes to a socket. Known other devices are
excluded. Observation lasts through authorization expiry plus 120 seconds;
authorization, decoder acceptance and media storage rules are unchanged.

Each process retains at most 32 recent request observations, 12 connection
aliases and 32 ordinary events per observation, plus a terminal summary. Summary
counters disclose omitted events and untracked chunks/bytes. Timers release
state even without further traffic. An observation can overlap another request;
`pendingRequest=another_request` and `observation_not_capture_correlation` prevent
claiming that an untagged image belongs to the earlier request. No diagnostic
state or capture is replayed on restart. A two-minute post-expiry observation
does not rule out arrivals later than that finite period.

The strict-admin command-coordination endpoint exposes metadata-only observer
readiness and active observation count. Tests cover late images after sweep,
fragmentation, identified/unidentified replacement sockets, identity changes,
unsupported headers, privacy, bounds, clock changes, logging failure, valid
capture preservation and restart without diagnostic replay. No new hardware
success is claimed for these diagnostics before an operator-triggered test.

Diagnostic regression validation: all 1,609 gateway tests passed, with zero
failures or skipped tests. The focused ingress/live-capture/incident/timeline/ops
run passed 62 tests. This validates software behavior, not the camera root cause.

## Completed diagnostic fall and subsequent software correction

The 15:24:20 MUT fall had a single capture at 15:25:55. The watch replied but
no image arrived during authorization or the additional 120-second observation.
The terminal observer counted 63 bytes in two complete frames on the selected
connection, with no photo header, incomplete buffer, untracked byte, suppressed
event, replacement connection or rejection. Actual images/ready analyses: 0/0.
Initial alert delivery and delivered/read follow-up were verified independently.
The observer and temporary sleep helper exited; gateway and ngrok stayed up.

The operator's later correction reports a prior five-photo SOS with the same
screen behavior. Do not promote screen darkness to a cause or require another
awake-screen trial based solely on the failed capture. Historical AnyTracking
evidence also includes an ACK-without-image excerpt and separate hands-off
successes; the missing-image symptom is not unique to Guardian's sequence.

Fall emergency reporting was absent from the dispatcher. The corrected policy
uses separate durable fall deadlines with the existing SOS duration and battery
rules, runs independently of initial alerts and camera completion, and restores
current policy after expiry/restart. A stale evaluation can no longer replace a
newer emergency deadline. The full gateway suite passes 1,616 tests; focused
reporting/coordination/dispatcher tests pass 47. This does not establish a camera
fix. RCAPTURE bytes, session/consent guards, spacing, request deadline and stop on
timeout remain unchanged. No blind retry, prerequisite CR or FTP change is added.
