# Shared watch command coordination

This integration supplies the shared gateway dependency of merged PR #144.
It extracts command admission and bounded settings dispatch from the combined
Wi-Fi/photo checkout, without importing its pending photo or reporting policy.

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

PR #113 must use this singleton for `beginCapture`, matching `finishCapture` and
disconnect handling. Its photo controller, access checks, image ingest, AI and
WhatsApp lifecycle are not present in this main-only extraction; simulated
leases test the contract here. Real capture lifecycle coverage remains in that
feature's integration tests. This work is not a proven fix for missing images.

PR #141 and the combined checkout's supplier-aligned 600-second reporting,
emergency lease/restoration worker and Wi-Fi changes remain separate. This PR
does not change main's existing battery bands or introduce an automatic replay
timer. Do not replace the running combined gateway with a main-only checkout
until the remaining features have been integrated and validated together.

Validation includes the full gateway suite and Firestore emulator suite, plus
cross-transport admission, emergency/stop priority, duplicate/replaced sessions,
expiry and access revocation, latest physical setting, obsolete manual interval,
ambiguous write/restart, timeout, snapshot wakeup and stale-worker regressions.
No real watch command, gateway restart or configuration change is needed for
these software tests. The existing restricted medication pilot gates remain.
