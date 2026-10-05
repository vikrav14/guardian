# Late incident-photo arrival — 2 October 2026

All times below are Mauritius (UTC+4). The observed gateway was `0394eac`,
PID 24396; ngrok PID 10500. This document describes a source change prepared
offline while that gateway continues the passive reporting test. It is not a
hardware acceptance claim for the new policy.

## Evidence

The independent fall at 16:39:53.216 produced three stored images and three
ready AI analyses. Its fourth capture was requested at 16:44:24.120 and its
29-byte acknowledgement arrived at 16:44:24.429. No photo header or partial
buffer appeared during the 120-second grant, which expired at 16:46:24.120.
There was no other outgoing write in that capture's recorded command window.

The late observer saw a photo header at 16:47:31.511 and a complete 4,330-byte
frame at 16:47:31.673 on the original connection, matching the watch header.
Disposition was `no_pending_request`. The frame was not stored, decoded as a
validated fourth JPEG, or passed to AI. It arrived 187.553 seconds after the
request and 67.553 seconds after expiry. The observer ended at 16:48:24.133:
5,033 bytes, 10 chunks, eight frames, one complete photo header, no remaining
buffer, no untracked traffic, suppressed events or logging failures.

The operator confirmed that the watch was left alone around 16:47. There were
no additional capture observations between this fourth request and the frame.
The firmware still supplies no verified request correlation identifier, so
these facts do not prove which capture produced the frame or its capture time.

The outgoing log places an automatic packet-silence CR before the resumed
location packets; the first recorded location receipt is 16:47:29.197, followed
by the photo frame 2.476 seconds later. The CR log has no exact timestamp, so do
not invent one. At a 60-second reporting intent, the existing idle policy waits
180 seconds from last packet before its recovery CR. The request deadline was
120 seconds. No socket replacement was observed. This supports delayed arrival
around recovery, but does not prove that CR caused camera execution or upload.

The separate Photos & AI follow-up for the three saved images was delivered
16:46:57 and read 16:47:01 by one recipient. Other recipient failures are
recorded separately. Initial alerts/call/map access did not await photography.
Earlier ACK-only failures, including one with continued heartbeat traffic,
remain unresolved; this finding must not be generalized to all of them.

## Focused change

- Authorize a new incident request once for at most 240 seconds, capped by the
  original incident deadline. Manual requests retain 120 seconds.
- Keep the same request, original socket, exact command and consent/access
  checks; no retry, mandatory CR, extra recovery or late media acceptance.
- Keep the device camera gate and bounded diagnostics aligned with the grant.
  CR, emergencies, calls, stops and protocol replies remain prompt.
- Keep routine settings' own expiry; waiting for a camera does not renew it.
- Preserve the one-minute gap after each actual save, five-photo ceiling,
  twelve-minute sequence and independent initial/follow-up notifications.
- Existing requests are never reauthorized during restart. The longer
  grant does not prove freshness or unique frame-to-request correlation.

## Offline validation and deployment boundary

A synthetic replay against the old `0394eac` controller and the changed
controller uses the same generated JPEG arriving at 187.553 seconds. Both
send exactly one capture. The old controller has already timed out and stores
nothing; the changed controller stores one photo while still authorized.

Regressions cover the exact expiry boundary, sequence cap, revoked consent,
unlinked account, cancelled subscription, deletion, different socket,
disconnect, old persisted grants after restart, deferred-setting expiry,
required command priority and metadata through the finite late window.
All 87 focused tests and all 1,622 gateway tests passed, with zero failures or
skips. The runtime check at 17:09:28 still reported the original 120-second
limit, confirming that the source changes had not altered the running test.

Four minutes is a fixed incident-photo bound, not a timer calculated from
reporting cadence. Critical-battery safeguards and their longer recovery
thresholds remain unchanged; a delayed or absent image can still time out.

The actual discarded frame cannot be recovered by this change. A new supervised
SOS/fall trial after deliberate deployment is required. Leave the current
gateway and recorder untouched until the bounded reporting observation ends.

## Rollout checkpoint — 2 October, 17:23 MUT

Commit 6bd04fb was loaded in gateway PID 12660 after the previous bounded recorder and sleep helper exited. Runtime reports an incident maximum of 240 seconds and manual maximum of 120 seconds; max five / 60-second spacing / 720-second sequence deadline remain unchanged. HTTP health passed, the watch reconnected, and no pending capture or prior sequence replay was observed. Existing 300-second fall cooldown persisted. Protected configuration hashes and ngrok PID 10500 are unchanged. A new operator-triggered hardware test is prepared, with passive observation bounded to 18:00 MUT. Hardware effectiveness remains unverified.


## Hardware result — 2 October 2026, 17:25 MUT fall

The 6bd04fb gateway granted the second request its complete 240-second window (17:28:37.262 to 17:32:37.262). It received one capture reply and no photo header, image frame or partial image buffer. The additional 120-second metadata observation also received no photo header: final 97 bytes, three frames on the same connection, no closure/replacement, zero untracked bytes, suppressed events or log failures. The capture-period outgoing trace contained RCAPTURE and one required LK reply, with no competing routine setting or CR.

One photo was stored and fully decoded; its AI analysis and authorized gallery were ready. The initial WhatsApp reached one recipient, and the separate Photos & AI follow-up was delivered at 17:33:19 and read at 17:33:26. The other initial recipient retained Meta error 131030; no allowlist/contact changes were made. The recorder and sleep helper exited after all metadata observations ended; gateway/ngrok remain running.

**Outcome: the four-minute candidate did not resolve this failure.** The earlier delayed frame remains evidence for that earlier request, not an explanation of this run. The upstream delay/failure cause remains unknown. No new hardware reliability claim is supported.
