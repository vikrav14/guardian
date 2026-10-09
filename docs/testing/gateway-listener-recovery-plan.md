# Gateway listener recovery plan

Status: parked draft; implementation pending.
Recorded: 21 September 2026.
Baseline inspected: main at 4386b0d7e47798fbc4f4d30190d888ae8b0b3301.

This draft records the recovery defect and a reviewable implementation plan.
It does not change gateway runtime behavior or claim recovery is fixed.
Watch feature acceptance remains the current priority; PR #118 is separately
paused while waiting for supplier clarification.

## Observed failure

During the 21 September Windows pilot, the gateway logged:

```text
[commands] watcher failed A backoff operation is already in progress.
[family] join watcher failed A backoff operation is already in progress.
[notify] alert watcher failed A backoff operation is already in progress.
```

The watch socket's last data time was 10:40:30.940 UTC. It logged an
ECONNRESET at 11:46:22.484 UTC, followed by a new connection at
11:46:46.463 UTC. Device identification and telemetry subsequently resumed.

The gap is consistent with an interruption, but these logs do not establish
whether PC sleep, a network outage, or another cause triggered it. The TCP
reconnection is separate from Firestore listener health. No controlled
reproduction or proof of lost/duplicated queue work has been collected.

## Code findings

- `gateway/src/firestore.js`: `startPendingAlertWatcher` and
  `startPendingCommandWatcher` keep unsubscribe handles and reject additional
  starts while a handle is present. Their snapshot error callbacks only log.
- `gateway/src/family-membership.js`: `startPendingFamilyJoinWatcher` uses the same
  guarded-start pattern and logs snapshot errors without restoring a listener.
- A terminal listener failure therefore has no application recovery path and
  leaves a handle that prevents the guarded start from attaching again.
- Firestore documents that a listener receives no further events after its
  error callback: [Handle listen errors](https://firebase.google.com/docs/firestore/query-data/listen#handle_listen_errors).

Pending command processing, alert queue processing, and family join processing
may remain unavailable even after watch TCP traffic resumes. This finding
does not establish that every alert delivery path failed; direct alert
dispatch and queued retry processing must be assessed separately.

## Proposed implementation

- [ ] Introduce a shared listener lifecycle with at most one active subscription
      and one pending retry per watcher.
- [ ] Clear terminated subscription state and restart retryable failures using
      exponential backoff with jitter and a capped delay.
- [ ] Surface non-retryable permission, authentication, and query failures
      without a rapid or indefinite retry loop.
- [ ] Handle synchronous attachment failures, overlapping callbacks, repeated
      starts, and obsolete callbacks from prior subscriptions.
- [ ] Cancel retry timers and active subscriptions during explicit stop/shutdown.
- [ ] Expose per-watcher state and useful last error/retry timestamps through
      existing operational health reporting without exposing personal data.
- [ ] Preserve existing authorization and queue expiry rules.
- [ ] Audit snapshot replay and existing notification/command idempotency so
      reattachment does not introduce duplicate sends or stale command execution.

## Verification before this draft becomes ready

- [ ] Deterministic tests: a failed listener reattaches after the expected delay.
- [ ] Repeated failures back off; simultaneous starts cannot duplicate listeners.
- [ ] Stop during a pending retry prevents later reattachment.
- [ ] Late callbacks from a prior listener cannot overwrite the active state.
- [ ] Permanent errors remain visible and do not spin.
- [ ] Pending queue work resumes after reattachment, with replay and expiry
      behavior checked for both commands and notifications.
- [ ] Family join processing resumes without duplicate membership side effects.
- [ ] Run affected gateway tests, then the required CI checks.
- [ ] Controlled Windows interruption/resume test confirms all three watchers
      recover independently of watch TCP reconnection.
- [ ] Record recovery timing, remaining limitations, and operator diagnostics.

Do not merge this planning-only draft as a completed recovery fix. Resume its
implementation after the current watch feature work, without combining the
supplier-dependent PR #118 changes into this branch.
