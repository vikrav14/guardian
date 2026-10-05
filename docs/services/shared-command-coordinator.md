# Shared watch command coordination

This integration supplies the shared gateway dependency of merged PR #144.
PR #113 now connects the photo lifecycle and reporting reconciler to this same
singleton; PR #141 supplies Home Wi-Fi setup alongside it.

## What uses it

| Path | Behaviour during an authorized camera wait |
|---|---|
| Managed medication settings | Existing 25-second bounded wait; recheck access, lease and exact session before the binary write. Off stays prompt. |
| Firestore `deviceCommands` | Routine settings defer until the original 120-second deadline. Newest valid physical-setting intent wins; calls, finding and explicit stops have a prompt path. |
| General TCP downlink | One live session only; conflicting routine commands return `camera_busy`. Includes HTTP/admin/assistant commands, reconnect setup and recovery. |
| Movement settings / single-router trial | Recheck the same gate before their direct socket write; the trial is not consumed by a skipped attempt. |
| Wellness | External starts fail clearly and scheduled work records the existing skipped/blocked outcome. Stops remain available. |
| Adaptive reporting | Active SOS/outing reporting remains prompt. A blocked routine evaluation changes no applied interval; a later evaluation recomputes current policy. |
| Protocol replies | Required replies stay on the incoming socket immediately. They are never deferred. |

The coordinator stores only an in-memory device/request/socket/deadline lease,
not frames, credentials or a callback to replay. Expiry, matching completion
and session disconnect release it. A camera lease cannot exceed 240 seconds or
its caller's earlier authorization deadline. CR is never blanket-blocked to
protect photography. No new locating pulse, photo retry or watch command syntax
is introduced.

## Persisted settings and restart

`deviceCommandIntents` holds backend-only newest-setting watermarks. Completed
stops continue to supersede older enables, including across a gateway restart.
Legacy medication ordering uses the actual frequency-derived watch slot rather
than the app reminder ID. Managed voice reminders retain their separate durable
slot registry and idempotency rules from PR #144.

The queue rechecks linkage, applicable subscription, expiry, current session and
newest intent after asynchronous work and immediately before handoff. A deferred
manual upload interval is rejected if the app has selected automatic reporting
or a different interval in the meantime. A single-field query is bounded to 100
rows; a saturated batch fails explicitly instead of choosing from an incomplete
set. The poller sleeps when no work remains and preserves snapshot wakeups.

Transitions to deferred/terminal states are transactional so a stale worker
cannot move an already-sent action back into the queue. `sending` is recorded
before transport handoff. Ambiguous writes end without automatic retry; after
restart, old `sending` and `deferred` rows fail explicitly. Unattempted, authorized
pending work may still run within its original deadline. A duplicate live session
never results in a broadcast. `sent` means handoff, not receipt or physical effect.

The guarded Admin SDK `queue-v52-alarm-mode` route remains supported. Clients
still cannot queue that command or read/reset the ordering watermarks. PHBX and
watch-answer administration are not opened through the generic queue.

## Integration boundary and validation

PR #113 uses this singleton for `beginCapture`, matching `finishCapture` and
session disconnect. Real controller tests cover receipt, timeout and disconnect
alongside simulated leases for the other transports. Coordination is not a
proven fix for missing watch images.

The integrated automatic reporting policy uses a 600-second normal baseline,
bounded SOS/fall and outing leases, critical-battery safeguards for temporary
faster reporting, and restoration from current policy after expiry/reconnect.
A queued manual setting must still match current manual intent; switching to
automatic or choosing another interval invalidates it. The app persists manual
intent separately from emergency handoff values. Saved Home Wi-Fi enrollment
never extends current Home evidence or creates a repeated CR loop.

Code integration does not replace the running pilot process or turn on pending
Meta contracts. One automatic photo plus the one-hour guardian request window
remains behind `INCIDENT_PHOTO_GUARDIAN_WINDOW_APPROVED`, false by default.
Enable it only after exact Utility template approval and a controlled rollout.

Validation includes the full gateway suite and Firestore emulator suite, plus
cross-transport admission, emergency/stop priority, duplicate/replaced sessions,
expiry and access revocation, latest physical setting, obsolete manual interval,
ambiguous write/restart, timeout, snapshot wakeup and stale-worker regressions.
No real watch command, gateway restart or configuration change is needed for
these software tests. The existing restricted medication pilot gates remain.
