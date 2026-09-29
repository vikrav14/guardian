# Connected movement reminder trial

PR #118, requested 28 September 2026. This is a supervised pilot, not a customer
release. Earlier remote Open / 20 reports need re-verification after connected
On did not produce the expected menu display. Local On / 20 persistence is now
observed; local Off normalizes its displayed interval to 0. The connected enable
path is not physically accepted.
The timed inactivity notification, worktime enforcement, movement reset and
reboot persistence remain unverified. Do not turn a transport reply into a
hardware acceptance result.

**Latest review:** the [29 September original-PDF audit](sedentary-source-audit-2026-09-29.md)
confirms the framing but finds no documented sedentary readback or local/remote
menu equivalence. Its midday follow-up records supplier On / 20, two identical
21:00-23:59 worktime requests, replies, and a physical Open / 20 photograph.
The operator reported saving 13:00-14:00, but delivery of that change was not
captured. No sound or on-screen reminder was observed by 13:28. This is
inconclusive; do not repeat a timed trial before confirming delivery of the
intended active hours. Guardian routing was restored with a connected-session
inspection. The app status-load error must be diagnosed; its default Off and
08:00-20:00 display is not watch readback. Cleanup remains unconfirmed. See the
audit for exact evidence and limits; the upper-Save-only plan below is historical.

## Current blocker and local-control result — 29 September 2026

All times below are Mauritius time. Preserve the earlier observations as
historical evidence, not a current pass:

- At 00:28 the app sent Off, worktime 00:30–01:00, then On. Each command received
  a bare reply. The operator reported Close / 0 on the watch.
- A separate app Off yielded reported Close / 20 around 00:37.
- Combined On with worktime 00:30–01:15, sent inside the active window, again
  yielded Close / 0 around 00:40.
- The bounded preload on the original gateway then sent isolated
  `[3G*9705254749*000e*SEDENTARY,1,20]` and
  `[3G*9705254749*000e*SEDENTARY,0,20]`. Actual downlink logs show one session
  and a bare reply for each. The operator reported Close / 0 after both, around
  00:50 and 00:51. Individual downlink lines have no timestamp.
- The supplied physical watch photo at 00:55 directly shows Sedentary Close,
  Interval 0, with Save and Back controls. It establishes the displayed value;
  whether this editing screen reflects the running remote configuration is not
  yet independently established.

Code/evidence review: Guardian already replies to CONFIG with CONFIG,1.
Its ordinary wrapper uses SG while the supplier capture uses 3G; causality is
unproven. The isolated setting frames above match the captured supplier format.
The prior worktime setting was not restored by isolated Off/On, so worktime
influence is not excluded. No arbitrary delay, new command syntax, reset or
firmware change is justified by these observations.

**Local control, reported 01:04–01:05 MUT:** the operator saved Close with
interval 20 on the physical watch, reopened it, and saw Close / 0. They then
saved Open / 20 locally and confirmed that Open / 20 persisted after reopening.
Saving Close / 20 again returned to Close / 0. Final state is locally closed.

This corrects our Off acceptance criterion: Close / 0 is the observed normal
local disabled display on this pilot, not evidence that Off failed or the
interval was corrupted. Earlier transient Close / 20 reports must not be used
to require interval retention when disabled. Do not add an interval-zero wire
command; keep the captured Off body unchanged.

Local Save works, but it does not establish that remote settings use the same
stored fields or that timed inactivity execution works. Remote application is
unverified. Establish it through controlled actual reminder behavior and/or
documented applied-state readback; do not assume this local menu is readback.

Historical supplier comparison plan (attempt captured; see the latest audit
for results and unconfirmed cleanup): verify current Guardian and recorder endpoints,
use the existing pass-through recorder, and save only the AnyTracking upper
Open / 20 control once. Inspect the physical watch after leaving/reopening its
menu without a local Save; record menu, time, and captured frame. Leave lower
active-hour controls unchanged for this setting comparison. Send Off through
AnyTracking once, check closed state (0 is expected from the local control),
then restore Guardian routing and verify fresh telemetry. This checks setting
application only; do not wait for a reminder in the expiring overnight window.
Compare the full captured exchange if AnyTracking succeeds. If it also fails,
retain the evidence for a firmware-specific supplier investigation instead of
guessing another command. The existing active-hour setting remains a possible
influence; this comparison is not proof that it is irrelevant.

The separate pilot checkout has no copied .env. To restore normal operation,
stop the temporary gateway and explicitly use the original configured directory:

```powershell
Set-Location C:\Users\MSI\repos\guardian\gateway
Remove-Item Env:GUARDIAN_SEDENTARY_FRAME_TRIAL_PROTOCOL_ID -ErrorAction SilentlyContinue
npm start
```

Do not use plain npm start inside guardian-movement-pilot/gateway; its launcher
needs the original environment via --env as documented below. Startup failure
there is not evidence that the original Firebase configuration is missing.

## What is connected

Watch settings → Wellness → Movement reminders has a supervised Save path.
The Flutter pilot defines one IMEI. The gateway independently requires one
explicit Firebase UID/IMEI pair, a linked device, verified family membership when
applicable, and a trusted active Family or Care subscription. This operator
exception does not change Jesh's Family plan or expose the Care feature to other
Family users. Default customer and Care preview gates remain unchanged.

The app sends a Firebase ID token to GET/POST `/app/movement-reminders?imei=...`.
There is no admin key in Flutter and no dev-open authentication fallback. Server
state and per-request audit live in `movementReminderSettings` and
`movementReminderRequests`. Existing default-deny Firestore rules keep both
collections inaccessible to clients; the authenticated gateway is the only path.
No rule deployment is needed to run this pilot with those rules.

Save On sends, in sequence:

1. `SEDENTARY,0,20`
2. `SEDENTARYWORKTIME,<HH:MM>-<HH:MM>,-`
3. `SEDENTARY,1,20`

Each uses the captured 3G prefix and lowercase four-digit hex length, with a
same-session bare-reply wait before the next step. The worktime reply no longer
gets acknowledged back. Save Off sends only `SEDENTARY,0,20`; it leaves worktime
unchanged. One same-day window of at least 25 minutes, no weekday/overnight
semantics, and only the observed 20-minute interval are supported in the trial.
Arbitrary window values are test inputs, not accepted hardware claims.

The generic command builder and emergency paths are unchanged. This sender is
scoped to the pilot endpoint. Do not also load the temporary framing preload.

## Failure semantics

- Opening, editing, Refresh, restart and reconnect never send a command.
- A UUID and expected version are claimed transactionally before a send.
  Concurrent or replayed requests never dispatch twice. A new request must use
  the current version; a different payload cannot reuse an old UUID.
- The gateway refuses zero/multiple/stale/mismatched sessions. It never transfers
  an in-progress operation to another socket. It rechecks authorization before
  each step and audits each attempted step before writing it.
- An 8-second reply timeout stops the sequence. There is no automatic retry or
  offline queue. A lost HTTP response requires read-only Refresh. A crashed
  operation expires to Unconfirmed after 60 seconds; enable cannot be repeated
  until an explicit Off request is processed.
- “Watch replied — check the watch” records reply evidence only. The selected
  toggle is requested state. Actual menu state and reminder execution stay
  unverified; the app cannot read these back or prove that the wearer moved.
- Audit failure after a possible write remains uncertain and does not cause a
  resend. Earlier partial steps remain recorded. Inspect the physical menu.

## Windows setup without changing the photo checkout

Keep ngrok running. Stop the existing gateway with Ctrl+C first; only one
gateway may listen on 9000/9001. The photo/WhatsApp PR stays unchanged.

In PowerShell:

```powershell
Set-Location C:\Users\MSI\repos\guardian
git fetch origin feat/v52-care-reminders
if ($LASTEXITCODE -ne 0) { throw 'Fetch failed.' }
git worktree add --detach ..\guardian-movement-pilot origin/feat/v52-care-reminders
if ($LASTEXITCODE -ne 0) { throw 'Worktree creation failed. Share the output.' }
Set-Location ..\guardian-movement-pilot\gateway
npm ci
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
node scripts/start-movement-reminder-pilot.js --imei 861397052547492 --env C:\Users\MSI\repos\guardian\gateway\.env
```

The launcher reads the original gateway .env and resolves its relative paths
there. It selects a unique linked service owner, verifies service access, then
sets the pilot pair only in that gateway process. It does not copy credentials,
change a subscription, deploy a site, or send commands on startup. If there is
not exactly one owner, it stops; use `--uid <Firebase UID>` only after identifying
the signed-in linked account. Close any old temporary-preload gateway.

In another PowerShell window, launch this branch's local app:

```powershell
$ErrorActionPreference = 'Stop'
$movementEndpoints = (Invoke-RestMethod 'http://127.0.0.1:4040/api/endpoints').endpoints
$movementHttps = @($movementEndpoints | Where-Object {
    $_.url -like 'https://*' -and
    $_.upstream.url -match '^https?://(?:localhost|127\.0\.0\.1):9001/?$'
})
if ($movementHttps.Count -ne 1) { throw 'Expected one HTTPS gateway endpoint.' }
Set-Location C:\Users\MSI\repos\guardian-movement-pilot\apps\mobile
flutter run -d chrome "--dart-define=GUARDIAN_GATEWAY_URL=$($movementHttps[0].url)" --dart-define=GUARDIAN_MOVEMENT_REMINDER_PILOT_IMEI=861397052547492
```

Sign in with the linked service owner's usual account. Open Watch settings →
Wellness → Movement reminders. This local build is not the deployed photo app.
The gateway launcher uses the Care branch while the supervised trial runs;
photo/WhatsApp rollout acceptance is outside this test.

## First physical trial

1. Confirm watch clock matches Mauritius time and menu starts closed (Close / 0 on this pilot).
2. Choose one active window containing the **next 30 minutes**. Do not run a
   20-minute test against the earlier 21:00–23:59 window across midnight. After
   midnight, for example, use 00:05–01:00 only if the current clock fits it.
3. Select On and Save once. Record the displayed menu, exact watch time and
   active hours submitted. Neither a bare reply nor the local menu alone proves
   whether the remote setting was applied. For the next comparison, use the
   supplier baseline described in the audit before repeating Guardian trials.
4. Keep the watch worn during ordinary seated inactivity for 20–25 minutes.
   Note any movement, sound, vibration, displayed text and exact time. Do not
   send extra On commands during this observation. No alarm after 25 minutes
   is an inconclusive/failed reminder test, not permission to claim it works.
5. Select Off and Save once. Physically check the closed state and record the time; Close / 0 is
   normal for the local disabled display on this pilot.
   If the outcome is uncertain, inspect first; do not repeatedly tap Save.
6. Share the three observations: enable menu, actual reminder or no reminder,
   disable menu. We then record evidence and plan the remaining schedule/reset
   checks. Do not mark the full feature accepted from the menu test alone.

When finished, leave the watch closed, stop this gateway with Ctrl+C, then
run `npm start` from `C:\Users\MSI\repos\guardian\gateway` to restore the
normal gateway. Keep the Guardian TCP tunnel at its current endpoint. A restart
does not itself turn a watch setting off.

## Verification and rollout

Gateway unit tests cover access, exact frames, real decoded replies, identity,
timeout, partial failure, audit failure and no retry. Firestore emulator tests
cover contention, idempotency, crash recovery and blocked client writes. Flutter
tests cover Save, pending/error/refresh behavior, pilot visibility and layout.
Synthetic screenshots use a fake client and do not contact a watch.

Leave the PR draft and all customer rollout switches off until physical
acceptance is recorded. No sound/vibration result has been fabricated by these
software tests. A broader edition decision, durable readback, or production
rollout is a separate change.
