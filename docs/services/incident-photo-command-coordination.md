# Incident photo command coordination

Status on 1 October 2026: observation implemented; scheduling arbitration is
planned, not active. PR #113 remains draft. This work does not establish a fix
for the V52's intermittent capture replies without images.

Validation: all 1,561 gateway tests pass, including write isolation/redaction,
bounded history, other-session observation, timeout persistence, unchanged
downlink bytes, and stopping observation at image arrival. These are software
checks; no new hardware acceptance is claimed.

## Evidence

The 00:33 MUT SOS returned five photos, all with ready AI analyses. Requests
followed preceding saved images by 10.591, 13.573, 10.644 and 11.199 seconds.
The 00:55 fall returned one photo; its second request followed the first saved
image by 13.308 seconds, received a capture reply but no image, and timed out.
The 01:20 fall's first request also received only a capture reply. The supplied
logs do not show another outgoing command inside those failed image waits.
Location reporting resumed after a later CR; that does not prove CR is required
for photography. Fall causes a screen/ringtone alarm, not an outgoing call on
this watch. Display-state dependence remains unproven.

## Timing audit

| Operation | Timing in current code / observed logs |
| --- | --- |
| Normal automatic reporting | Battery bands >=60 / >=30 / >=15 / <15 request 60 / 300 / 600 / 900 seconds |
| SOS override | 30 minutes at 60 seconds (300 for critical battery), then 15 minutes at 300 seconds unless active outing takes priority |
| UPLOAD interval changes | Only when desired and last requested intervals differ; ordinary changes have a 10-minute cooldown, urgent changes bypass it |
| Packet-silence CR | Two expected reporting intervals plus 60 seconds; unknown interval uses 12-minute fallback; then 90-second recovery grace |
| Active-outing stale location CR | Default 150 seconds stale, subsequent checks every 180 seconds; only while outing active |
| Observed reporting burst | Roughly 21 seconds between locations after startup; observation, not guaranteed firmware cadence |
| Camera sequence | Up to five images, minimum 10 seconds after preceding save, 120-second authorization per request, 12-minute incident deadline |
| Backend polls | Photo worker 3 seconds, wellness scheduler 20 seconds, WhatsApp reminder scheduler 60 seconds; these are not command-send frequencies |

The shared downlink sender and direct movement-setting path have no common
photo-busy guard. Wellness has measurement-specific guards; those do not guard
camera capture. Regular incoming telemetry, required ACKs and backend/cloud
work must be distinguished from additional watch commands.

## Implemented observation

`photo-command-timeline.js` observes immediately before writes at every current
gateway source path: normal downlinks (including CR, UPLOAD and wellness),
protocol replies including the wear-capture ACK path, camera capture, movement
settings, and the explicit Wi-Fi fence experiment. It does not wrap sockets,
alter bytes/callbacks/backpressure, schedule commands, retry, or delay writes.

- Before capture: at most 16 writes on the selected socket, within 120 seconds,
  observed since this gateway process started. Earlier/replacement socket
  history is not claimed. Truncated history is marked.
- During capture: at most 48 writes for this watch, including writes on a
  replacement/duplicate session identified as this watch. Additional attempts
  are counted as dropped. Collection ends on image arrival, failure/disconnect,
  or authorization expiry, not after later AI processing.
- Only fixed command/source labels, time offsets, byte counts and a same-session
  flag are kept. Unknown commands become OTHER. Only UPLOAD retains its bounded
  numeric interval; all other arguments are omitted.
- History uses a bounded weak socket map; active observers use per-device
  lookup, not a fleet-wide scan. Observation performs no network I/O. Existing
  terminal diagnostics persist the timeline; no extra per-packet/command writes.
- Metadata describes a write attempt, including attempts that may throw or fail
  asynchronously. It does not prove delivery, device application, interference,
  camera readiness, internal watch work, or external/SIM/supplier commands.
- Missing timeline on an older request/restart means unavailable evidence.
  A new run's initial handoff log may have a partial timeline; inspect the
  terminal result. Truncation prevents claiming a complete command history.

The existing read-only inspector now prints the sanitized timeline:

```powershell
Set-Location 'C:\Users\MSI\repos\guardian\gateway'
node 'C:\Users\MSI\repos\guardian-photo-check\gateway\scripts\inspect-incident-photo.js' --photo '<request UUID from the new incident>'
```

Use the existing configuration directory; updating the checkout does not
replace code already loaded by a running Node gateway. Restart that gateway
once into the updated checkout after verifying no capture is in progress.

## Planned coordination policy

First retain one naturally occurring or supervised trace without changing
scheduling. Then implement a common per-device decision point and typed results
(`sent`, `deferred`, `expired`, `superseded`) rather than reporting success for
an action that has not been sent. This is a separate tested change.

| Work | Required policy |
| --- | --- |
| Incoming SOS/fall, required protocol ACKs, emergency calls and explicit stops | Continue promptly; never wait for camera completion |
| Camera | One authorized request on its original socket; bounded wait; preserve consent, session matching and deadlines |
| Routine wellness start / nonessential settings | Defer or skip with an explicit reason and expiry; a missed wellness slot must not execute late |
| Repeated interval-setting intent | Retain the newest valid intent only; re-evaluate before sending |
| Recovery/location requests | Preserve emergency tracking and reconnection policy; classify deliberately, never blanket-block CR to obtain photos |

Do not queue closures containing stale sessions, credentials or consent. Recheck
authorization, current intent, session, expiry and safety priority before any
deferred action. A gateway restart must not replay ambiguous device actions.
Avoid starvation across all five photos: define the guarded phase precisely and
test between-photo gaps, image arrival, timeout, cancellation and disconnect.
Never assume a deferred stop has taken effect or extend photo authorization.

Automated acceptance must cover overlapping wellness/reporting/settings with
capture; expiry and coalescing; reconnect and duplicate sessions; simultaneous
SOS/fall and required replies; unchanged hardware bytes; and no privacy leaks.
Hardware acceptance then checks normal sleeping-display behavior with a single
controlled fall outside the existing 12-minute incident grouping window, followed
by a repeat and SOS regression. Keep timestamps, actual image counts, AI/gallery
results and WhatsApp delivery evidence separate. An ACK-only failure with no
competing write keeps camera/session/firmware investigation open; it does not
justify an invented wake command or blind retries.
