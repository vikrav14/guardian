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
