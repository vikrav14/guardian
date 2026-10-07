# V52 missing-photo differential investigation — 2 October 2026

Times in this note are Mauritius (UTC+4). This is a diagnostic checkpoint, not a hardware acceptance or camera-fix claim. Private captures, identifiers and environment values remain outside Git.

## Evidence compared

A read-only metadata query at 17:47:32 examined 75 retained capture authorizations (250-record limit not reached); all record an actual command handoff. Forty-eight retain saved-image hashes. These are retained records, not a complete lifetime denominator. Old media may already have expired.

Four non-trial SOS incidents each produced five distinct, fully pixel-decoded images: 30 September at 20:50 and 21:54, 1 October at 00:33, and 2 October at 14:05. A separate 28 September 15:48 incident is explicitly a trial and is not counted among those four. This confirms repeated hardware capability without establishing present reliability.

Today's 20 requests in that snapshot include 13 saved images and seven `image_timeout` failures. Six requests have a recorded UD protocol reply within 30 seconds before the camera request; all six saved an image. The other 14 split seven saved / seven failed. This is a small, post-hoc correlation. Successful LK-only and no-recent-CR cases are counterexamples to any claim that a CR or location packet is a universal photo prerequisite. Command lookback is bounded and is not a complete radio trace.

Twelve successful first-image headers arrived roughly 4.7–6.3 seconds after their requests; one arrived after 28.795 seconds. All seven failures have a prompt capture reply but zero photo headers inside their grants. Receipt/ACK does not prove camera execution.

The operator clarified that fall alerts make a short sound (approximately ten seconds), with no phone call. SOS initiates a call that the operator cancels. Thus an ongoing fall call is unsupported as the explanation; the local SOS cancellation is a difference worth retaining in the comparison. Screen darkness was also reported during a successful SOS, so it is not an established cause.

## Boundary established by the latest failures

The 17:25:55 fall produced one stored image and ready AI. Its second request at 17:28:37.262 received a reply after 233 ms and failed at its full 240-second grant. The extra 120-second observation ended at 17:34:37.264 with 97 received bytes in three complete frames, zero photo headers/buffered bytes, no connection close/replacement, and zero untracked bytes, suppressed events or logging failures. Outgoing capture-period entries were RCAPTURE and one required LK reply, with no competing routine command.

This rules out JPEG decoding, storage, AI or gallery rejection of an image at the instrumented gateway boundary during that window. It does not distinguish camera execution failure, firmware upload scheduling or a problem upstream of that boundary. The four-minute candidate did not fix this test.

The earlier fourth request at 16:44:24.120 was different: a complete matching frame arrived at 16:47:31.673, 187.553 seconds later and outside its old 120-second grant. It was discarded without decoding/storage. An ordinary automatic CR and location traffic preceded it; the CR line did not contain an exact timestamp. The operator said the watch was left alone. The frame lacks a trustworthy request correlation identifier and its device timestamp was not retained. It cannot establish that CR caused the arrival, or whether capture or upload had been delayed.

## Independently reproduced recovery gap

`sessions.js` uses a 180-second packet-silence threshold for a 60-second expected reporting interval. Every received chunk refreshes activity. Separate location-staleness recovery runs only for `outingActive`; the adaptive reporter does not pass an emergency lease to that mechanism.

An offline fake-clock/fake-socket reproduction ran the actual session module for 12 minutes, with a 60-second expected interval and a heartbeat every 156 seconds. With no outing, no location marker and no recovery probe appeared; the socket stayed open. With an outing lease, the same schedule produced exactly one location-stale probe at 150 seconds. Neither case sent a real command.

This explains how requested emergency reporting can coexist with heartbeat-only traffic. It is not proof of a camera cause, nor evidence that the interval command was applied by the watch. The session location marker is populated after geolocation processing, so it is not a complete raw UD packet counter. Do not introduce a repeated CR loop or make photography depend on GPS to address this gap.

## Prepared diagnostic changes

These changes are metadata only and are not loaded in the running `6bd04fb` process:

- Classify complete frames into a fixed set: heartbeat, location, alarm, bare lowercase capture reply, photo, other or unclassified. Retain bounded per-connection counts and last times; emit only the first non-photo frame of each kind.
- Retain actual inbound/outbound protocol prefix and declared-length consistency. These are observations of bytes handed to or read from the socket, not watch-side delivery acknowledgements.
- Retain a validated image header clock label as `deviceWallTimeUnverified`, including on late rejected complete frames. It has no UTC suffix and must not be presented as verified capture time. No image bytes, device identity, radio data or arbitrary command arguments are retained by this addition.
- Existing authorization, command coordination, acceptance, deadlines, event bounds and late-observation limits remain in effect. No new command, retry or image acceptance path is introduced.

The supplier communication example explicitly uses an SG LK reply for incoming 3G LK. Prefix difference alone therefore does not justify changing the ACK format. No invented image ACK, power command, FTP reconfiguration or mandatory CR-before-photo is supported by the evidence.

Validation: 70 focused tests and the complete 1,626-test gateway suite passed, with no failures or skips. Coverage includes exact bare replies, invalid clock labels, privacy, bounded heartbeat volume, late headers, frame length metadata and existing TCP/authorization/coordination regressions.

## Proposed next controlled test — not armed

The operator is travelling. No active test or rollout should occur during that travel. The preceding observation was explicitly passive; agree the following one-off locating intervention with the operator once settled before issuing it. It is an experiment, not a proposed production prerequisite.

1. Preflight current code/process/configuration and ensure the previous incident, capture, follow-up and late observation are terminal. Preserve private environment and original working directory. Deliberately roll out the metadata-only diagnostics, verify workers/flags, connection and no replay. Start a bounded passive recorder.
2. The operator triggers one watch-only fall test themselves. Do not instruct a person to fall, fabricate an incident, create an extra capture or ask for screen manipulation. Record initial alert independently.
3. If a follow-up capture is ACKed but still has no photo after about 90 seconds, inspect the actual request state. Only consider a single documented CR locating pulse if that same capture remains authorized and waiting, with at least 90 seconds left, consent/link/entitlement still valid, one unambiguous unchanged active session, sufficient battery and no simultaneous reconnect/recovery ambiguity. Recheck immediately before acting. If an image starts, a request expires, or any prerequisite fails, skip the pulse.
4. Record a durable local consumed marker before attempting the one pulse; an ambiguous send result consumes the experiment rather than permitting a repeat. Use the existing authenticated, coordinated path. Do not send another RCAPTURE, extend the grant, alter settings or automatically retry CR. Record any independently scheduled commands separately.
5. Compare the exact CR handoff with new location packets and any image header. A subsequent image is evidence of an association, not proof of a firmware cause; the device clock label is supporting unverified data. An image without a pulse is also informative. No image by expiry remains a failure. Preserve the full late-observation grace and then stop the recorder.

Before any production recovery change, evaluate a bounded emergency-location recovery budget that survives reconnect/restart, expires with the current emergency, respects critical battery, and does not replenish from heartbeat or stale Home evidence. A camera timeout must not itself schedule a blind retry or an unbounded wake loop. This policy is not implemented in this diagnostic change.

## Preserved contracts and remaining limitations

Initial alert and call/map access remain independent of photos/AI. Photos remain sequential, at most five, with at least 60 seconds after each save, new incident grants up to 240 seconds capped by the fixed 720-second sequence deadline, and 120-second manual grants. Old grants remain expired. Recipient-specific Meta 131030 results remain separate from camera results.

No supplier message was sent. No configuration, contacts, allowlists, saved Wi-Fi evidence, gateway/ngrok process or watch settings were changed during this differential audit. The prior recorder/helper are stopped and heartbeat paused. Root cause and enduring photo reliability remain unresolved.
