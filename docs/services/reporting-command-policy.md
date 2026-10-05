# Reporting and command policy

Implementation checkpoint: 5 October 2026, integration branch
`feat/guardian-command-coordination` (Home Wi-Fi #141 + incident photos #113).

The fixed normal baseline was loaded into the combined gateway on 5 October at
15:10 MUT using the preserved environment. A reconnect handed off `UPLOAD,600`
at 15:11. This confirms command handoff, not measured ten-minute packet cadence.
The change is local to the integration checkout; it has not been merged to main.
All 1,653 gateway tests and 10 watch-preferences tests passed; Flutter analysis
reported no issues. Revised app settings text is not yet deployed/installed.

## Location reporting

`UPLOAD` controls ordinary watch location uploads. It does not set heartbeats,
movement reminders, wellness times or the temporary `CR` locating burst.
The supplier's [RF-V52 user guide, page 2](https://ireachfar.com/wp-content/uploads/2023/07/User-Guide-RF-V52-Smart-GPS-Watch-U.pdf)
recommends a ten-minute normal interval and temporary faster urgent locating.

| Context | Normal battery | Below 15% | End condition |
| --- | --- | --- | --- |
| Normal automatic reporting | 600 seconds | 600 seconds | Current policy; no battery tiers |
| SOS or fall | 60 seconds | 300 seconds | 30 minutes after alarm receipt |
| Emergency cooldown | 300 seconds | 300 seconds | Next 15 minutes |
| Active outing | 60 seconds | 300 seconds | 15 minutes after last accepted journey movement, or confirmed return |
| Explicit urgent locate (`CR`) | Supplier temporary burst | Same protocol command | Firmware-bounded burst; does not overwrite `UPLOAD` intent |

Normal automatic reporting uses 600 seconds at every battery level, including
unknown battery. The former normal 60/300/600/900-second battery ladder on
`main`, and the integration branch's remaining 900-second critical-battery
exception, are removed. The app settings no longer advertise those tiers.
The below-15% safeguard only limits temporary faster emergency/outing reporting.
Null must not coerce to 0% and incorrectly select that safeguard.
Active SOS/fall outranks outing, which outranks
emergency cooldown. Existing manual preferences remain explicit; manual mode
cannot suppress either emergency. Returning from a temporary interval recomputes current battery,
manual preference, emergency deadlines and journey evidence, rather than restoring
an old interval from a closure.

A 15-second reconciliation worker reads current state for connected devices.
Deadlines survive process restart; heartbeat receipt does not renew an outing.
Fresh accepted movement renews its bounded lease. Reconnect reasserts the
current setting once, unless telemetry already handed it off on that session.
Command handoff is not firmware readback or measured upload cadence.

Fall previously lacked an emergency reporting override. Both alarm types now
start reporting independently at receipt, before geolocation completes. Separate
durable fall deadlines preserve compatibility with existing SOS deadlines. An
older reporting evaluation cannot overwrite a newer alarm's lease, and late
processing cannot renew an expired event. Neither this correction nor the
additional reporting traffic is a proven fix for an acknowledged capture that
produces no incoming image. Camera requests do not depend on an UPLOAD reply
or require a preceding CR.

Packet silence allows two applied upload intervals plus 60 seconds, then one
CR and 90 seconds of grace. Policy evaluation cannot reset packet age. Location
recovery during an outing waits at least the applied interval plus 60 seconds
(minimum 150 seconds), sends at most one CR per fresh fix, and stops at lease
expiry. Continued heartbeats alone cannot maintain a repeated-CR loop.

Departure still needs actual location/geofence evidence. At ten-minute normal
reporting, discovery can wait for the next report and route-start detail can be
sparse. Faster reporting starts after accepted departure/movement evidence; it
does not invent an earlier departure. Current journey confirmation and route
provenance rules are preserved.

## Home freshness

Enrollment is saved network configuration, not proof of current presence.
The Wi-Fi work retains three matching observations with at most 60 seconds
between them and a 120-second evidence expiry. This implementation does not
relax those values or initiate locating to keep a Home badge visible.

Ten-minute reports alone cannot sustain this current-Home proof. Home can be
confirmed during sufficiently close genuine observations, then expire. A last
detection remains historical evidence. Missing/expired evidence is not a
departure alarm. This limitation is intentional and must remain visible in
product wording and hardware acceptance.

## Shared command admission

`command-coordinator.js` protects only the interval from camera handoff to
complete image ingress, failure, disconnect or the originally granted deadline:
120 seconds for manual captures, up to 240 seconds for newly authorized
incident captures, also capped by the incident's existing sequence deadline.
Image Storage writes and AI analysis do not hold the device gate. Camera
authorization, exact session selection, consent, incident deadline and the
incident photo policy remain in the existing snapshot/incident code. The one
automatic photo plus one-hour guardian-request workflow is documented in
[incident-photo-window.md](incident-photo-window.md); its activation remains
gated on approved WhatsApp contracts. Until then, the existing five-photo
sequential runtime policy stays active.

| Source | Decision during camera wait |
| --- | --- |
| Protocol replies (`server`/wear ACK transport) | Prompt; no camera delay |
| SOS/fall/outing reporting, CR recovery or explicit locating | Prompt; camera is not a blanket tracking block |
| CALL, MONITOR, FIND, explicit supported stops | Prompt after their existing authorization |
| Automatic normal reporting/restoration | Defer, persist reason, recompute current policy on next worker pass |
| Firestore device settings | Defer within original 120-second request lifetime; retain newest authorized intent per setting |
| Wellness daily slot | Skip with `camera_busy`; existing scheduled-slot expiry still applies |
| Manual wellness, HTTP/admin/assistant/provisioning commands | Reject/skip with `camera_busy`; no blind replay |
| Movement settings | `not_sent` with `camera_busy`; retain versioned requested settings, require a new explicit action |
| Native Wi-Fi-fence experiment | Reject before its one-shot handoff; no automatic retry |

All normal TCP writes use the gate; the movement and experimental fence direct
transports also consult it. Generic downlink actions require exactly one live
socket, avoiding duplicate action fan-out after reconnect. Protocol replies
remain attached to their incoming socket.

The deferred dispatcher stores intent identifiers, not frames, credentials or
old socket closures. Before handoff it re-reads the request, current linkage and
applicable subscription, deadline, session and newest-setting record. The
backend-only `deviceCommandIntents` revision survives a newer stop completing,
so an older deferred enable cannot reappear afterwards. Invalid/newer requests
do not supersede a valid intent. A full bounded candidate batch is rejected
with `command_queue_capacity` rather than selecting an older setting from an
incomplete set.

Calls/stops can dispatch directly from the Firestore observer without waiting
behind routine reconciliation. The transactional claim prevents duplicates.
The retry timer polls only while requests remain; an empty queue relies on the
Firestore observer and does not add a permanent two-second empty-query loop.
On restart, ambiguous `sending` actions become failed/unconfirmed and are not
resent; deferred requests from the earlier process fail with
`gateway_restarted`. Reconnect does not move a partly handed-off action to a
new session. Safe automatic reporting is recomputed independently.

## Photos and WhatsApp

The initial SOS/fall notification and its call/map buttons remain independent
of photos and AI. SOS/fall reporting also runs independently of initial alert
delivery. The separate Photos & AI follow-up is unchanged. Maximum five
sequential photos, at least sixty seconds after the previous saved image,
up to 240-second incident capture authorization and twelve-minute incident
deadline apply. Manual captures retain 120 seconds. A deadline is granted once;
ACKs, recovery, timeout and restart never extend it or revive an expired grant.
There is no mandatory CR-before-photo and no automatic retry of an ambiguous
capture. An ACK is not an image; an image is not ready AI; API acceptance of a
WhatsApp message is not confirmed recipient delivery.

The first photo has no added spacing delay. The 2 October follow-up spacing
change preserves fresh-session checks and the existing incident deadline;
it does not add inactivity-triggered photography or claim camera reliability.
The strict-admin photo worker status exposes the active spacing policy so a
running process can be distinguished from edited files awaiting restart.

The longer incident window addresses the 2 October late-arrival evidence:
a complete frame arrived 187.553 seconds after a request, following the existing
packet-silence recovery. The former 120-second capture deadline expired before
the 180-second recovery threshold at a requested 60-second reporting interval.
It does not add CR commands or change recovery/reporting timers, and it cannot
guarantee an image, identify its exact capture time or explain every earlier
failure. See [late-arrival investigation](../testing/incident-photo-late-arrival-2026-10-02.md).
This source change requires a deliberate deployment after the current passive
test; a gateway still running `0394eac` retains its original 120-second grants.

## Operational continuity

`gateway/scripts/start-combined-gateway.js --environment <private-json>` loads
an explicitly preserved runtime environment and refuses a launch missing the
combined incident activation or absolute existing journey-journal path. Launch
from the established gateway working directory so existing `.env` and relative
Firebase credentials remain valid. Never commit the private JSON.

The read-only strict-admin `/ops/command-coordination` route reports current
session ages, applied-intent interval, outing lease and camera deadline with
the existing photo-worker status. It does not send a command.

The Windows acceptance launcher and hardware evidence are tracked in
`docs/testing/reporting-coordination-2026-10-02.md`. Validate actual reporting,
Home freshness, independent fall and SOS separately before calling the whole
hardware behavior accepted.


## Main integration, 5 October 2026

PR #113 retains PR #146's durable newest-setting watermarks and transactional
queue transitions. Manual intent is a separate app preference; deferred rows
are rejected when mode or intent changes, including when the live reporting
callback is installed. The policy worker does not write an earlier reporting
mode over a newer app selection. PR #141 Home enrollment and PR #144 medication
transport use the same integrated gateway without changing their pilot gates.
