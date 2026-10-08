# SOS camera and readings timing — 8 October 2026

All times are Mauritius (UTC+4). Identifiers, recipients, payloads, credentials
and health values are omitted from this report.

## Observed sequence

| Time | Observation |
| --- | --- |
| 21:58:01 | Physical watch SOS received. |
| 21:58:04 | Alert stored. |
| 21:58:18 | Initial owner WhatsApp delivered; read at 21:58:24. |
| 21:58:25 | Replacement watch TCP connection opened. |
| 22:00:01 | One `rcapture` request authorized and written. |
| 22:00:02 | Exact command echo received; execution unconfirmed. |
| 22:00:35 | Older pre-SOS socket closed. Capture socket remained alive. |
| 22:00:42 | Routine reconciliation resent `UPLOAD,60` during capture. |
| 22:03:01 | Readings job expired at its old five-minute start limit with `incident_photo_pending`; no sensor request was sent. |
| 22:04:01 | Four-minute camera authorization expired (`image_timeout`). |
| 22:04:26 | Approved vitals template delivered to owner, all four metrics unavailable. |
| 22:05:42 | A complete 3,222-byte photo frame arrived on the capture socket, matching the watch header. Rejected as `no_pending_request`. |
| 22:06:01 | Bounded late observer ended with that socket still alive. |

The operator reports ending the SOS call quickly and leaving the watch untouched,
including near 22:05. A long call or manual wake-up is therefore unsupported as
the explanation for this test.

## What the evidence establishes

Approximately two minutes elapsed between SOS and camera command. The enabled
SOS readiness guard requires non-alarm telemetry received at least 30 seconds
after SOS and fresh within 30 seconds on an eligible socket. The early replacement
connection heartbeat was around SOS+24 seconds and could not satisfy that guard;
later qualifying telemetry coincided with dispatch around SOS+120 seconds.
This passive guard is not proof of camera readiness. It remains unchanged.

The complete photo frame arrived approximately 5 minutes 41 seconds after the
capture command, about 101 seconds after expiration. An early echo and continued
heartbeats did not establish camera completion. Rejection preceded JPEG decoding,
storage and analysis, so this test establishes neither image validity nor actual
capture time. The embedded device timestamp is unverified. V52 has no echoed
capture request ID; matching socket and device provide correlation, not unique
proof that this frame belongs to that request.

The old reading deadline was incompatible with photo-first ordering: dispatching
a four-minute photo wait at SOS+2 minutes allowed that wait to run until minute
six, after readings had already expired.

Routine reporting reconciliation incorrectly inherited emergency bypass from the
persisted SOS lease, allowing a settings write 41 seconds into capture. This is a
coordination defect, **not a proven cause** of the camera delay. Earlier four-minute
ACK-only failures also occurred without competing settings writes; see the
[2 October evidence](incident-photo-late-arrival-2026-10-02.md).

The initial and follow-up messages reached the owner. A separate existing contact
was rejected with provider code 131030; delivery to every contact is unproven.

## Software correction and remaining acceptance

New reading jobs may start optics before minute seven, preserving the same
nine-minute result deadline. Every stage needs a full two-minute response window,
rechecked after asynchronous preparation. Temperature is skipped if it cannot fit;
usable optical results remain. Persisted legacy deadlines are not extended.

Only a new SOS/fall handoff bypasses the camera gate for reporting. Reconciliation,
outing and cooldown settings defer and recompute after release. The camera window
remains four minutes; expired media is rejected. No blind capture retry, firmware
wake command or historical measurement replay is introduced.

Regressions model photo timeout at minute six followed by fresh readings, partial
completion, budget exhaustion during temperature preparation, legacy job restart
and camera-gated reconciliation. Privacy tests verify clients cannot forge
collection markers or access private readings/reservations.

A new operator-triggered SOS test is required. Record photo and sensor timing
without touching or waking the watch. Timer expiration cannot prove the watch has
stopped camera work. If delays persist, provide the vendor the bounded command
and connection timeline instead of treating an echo as successful execution or
repeatedly extending the window. This investigation triggered no new live SOS.

## Validation

- Main-based branch: all 1,819 gateway tests and all 115 Firestore emulator tests
  passed; `git diff --check` passed.
- Candidate containing the current local release plus the four timing changes:
  1,882 gateway tests passed, one existing journey test failed. The same
  `journey-builder.test.js` stale-origin assertion fails on the unchanged local
  release. It is unrelated to these four files; the main-based branch passes it.
- The isolated candidate includes the current release's other integrations;
  deploying the timing fix must preserve them rather than replace the whole
  local release with the main-based branch.

## Pilot deployment

At 23:00 Mauritius time, the four tested timing files from implementation commit
`099ad49` were overlaid onto the existing local release after fresh, empty camera,
voice, incident and measurement queue checks. Only the verified gateway process
was restarted. The private configuration hash and ngrok addresses were preserved;
both gateway listeners, HTTP health and journey writer lock passed verification.
The separate predictive observer remained running.

At 23:01, one reconnected watch session and a fresh heartbeat were observed;
photo and readings gates, current consent and authorized owner delivery remained
enabled. No pending measurement job or active sequence existed. This verifies
deployment and reconnect, not successful capture or sensor readings. PR #159
remains a draft and has not been merged into main.

## Operator-triggered retest — 23:05–23:09 MUT

The operator triggered one new watch SOS after idle/connection checks. A separate
read-only observer excluded the earlier alarm and stopped after verified owner
delivery. No observer command, alarm replay or historical reading was sent.

| Time | Retest result |
| --- | --- |
| 23:05:40.596 | Physical SOS received. |
| 23:05:55 | Initial owner WhatsApp delivered, about 14 seconds after receipt. |
| 23:06:45 | One camera command handed off, about 65 seconds after SOS. |
| 23:06:54.049 | Complete matching image frame arrived, about 8.5 seconds after capture began. |
| 23:06:57.331 | Decoded image stored successfully; AI analysis subsequently reached ready. |
| 23:07:42 | Photo complete; readings queued with `watch_offline`. Runtime showed two connections for the watch and refused ambiguous measurement dispatch. |
| 23:08:16.079 | Fresh optical sequence started after connection ambiguity cleared. |
| 23:08:57.916–58.070 | Usable heart/BP and oxygen uploads received, about 42 seconds after request. |
| 23:08:58.515 | One uppercase temperature command handed off. |
| 23:09:20.554 | Usable temperature upload received, about 22 seconds after request. |
| 23:09:21.967 | Incident readings completed with all three metric groups (four displayed metrics). |
| 23:09:29.080 | Incident snapshot frozen for the follow-up. |
| 23:09:38 | Approved vitals template delivered to owner; read at 23:09:42. |

The full follow-up took approximately 3 minutes 57 seconds from SOS. Each saved
reading's request/receipt timestamp belongs after this new SOS. Values remain
unverified watch estimates with receipt-time/session correlation, not measured
clinical accuracy or confirmed wearing.

The capture command timeline contains one write during the approximately
8.5-second wait: RCAPTURE itself. No competing interval-setting write or camera
retry occurred. This is one successful live photo/measurement/delivery run; it
does not prove the removed reporting interference caused the earlier delay, nor
does it exercise the new minute-six timeout admission path (covered in software
regressions). The major residual delay was overlapping old/new TCP connections:
the unique-session measurement guard delayed vitals until about SOS+2m35s.

The separate contact's existing provider 131030 rejection remains; this is an
owner-delivery pass, not an all-recipient pass. Gateway and ngrok remained running
throughout. No new code or settings were changed during the retest.
