# Daily Wellness times — 17 September 2026

This replaces the earlier native 12-hour / 8-hour routine selection with
gateway-controlled daily clock times. The routine is available to linked Family
and Care customers with active consent; it has no viewer grant or Flutter pilot flag. It
does not enable alerts or positive wearing detection.

| Routine | Daily slots | Initial suggestions |
|---|---:|---|
| Manual | 0 | None |
| Gentle rhythm | 2 | 08:00, 20:00 |
| Balanced rhythm | 3 | 08:00, 14:00, 20:00 |

The user can edit every time. Times use `Indian/Mauritius` (UTC+04:00), explicitly
shown in the app, independently of the caregiver's phone timezone. Slots must be
distinct, sorted and at least five minutes apart, including across midnight.
Selecting a routine saves preferences; it does not immediately take a reading.
Changes apply to future slots. Manual stops future gateway requests and requests
cleanup of any tracked native intervals.

## Execution

At a due slot, the gateway checks authorization, consent, one live watch session,
diagnostic quarantine and competing measurements. It atomically claims a durable
slot before requesting `hrtstart,1`. Only usable heart/BP **and** oxygen uploads
within the bounded optical window permit one uppercase `BODYTEMP2` request.
The schedule revision, authorization and original session are checked again
before the temperature command. Missing, unusable or late optical readings skip
temperature. There is no automatic retry of an uncertain command handoff.

Scheduled requests record position `unknown`, with basis `scheduled`. Neither
nonzero readings nor successful temperature follow-up establish wrist contact.
The confirmed tabletop counterexample remains relevant; sensor-up storage advice
does not turn this availability filter into wearing detection. Existing reading
quality labeling and estimate wording remain in force.

The 20-second gateway poll has a one-minute start window. Offline or missed slots
are recorded as skipped and are never replayed on reconnect. A slot key is its
Mauritius date and clock time, independent of request revision. Durable claims,
a gateway lease, daily attempt budgets and a five-minute slot reservation prevent
duplicate execution on polls, edits or restart. Gentle permits at most two claimed
attempts that local day; Balanced permits three. Skips before an attempt claim do
not consume that budget; a claimed dispatch remains consumed even if its later
preflight fails. Editing times does not replenish the day's budget.

If the gateway restarts during a claimed check, it records an interrupted/unknown
result and does not resend. The app shows the next selected slot and last attempt
outcome; "readings received" describes observed uploads, not verified measurement
accuracy. Each returned metric retains its own timestamp.

## Migration and operation

Version-1 Gentle/Balanced preferences require choosing times and applying them in
the updated app. They are not silently converted or started. The native routine
controller is retained for stop reconciliation only. Tracked possible native
cycles are stopped before new daily execution; partial or offline cleanup blocks
the new sequence. Stop handoff is not proof the firmware applied a setting.
Strict-admin interval-start commands for this schedule are rejected to prevent an
untracked native cycle from overlapping the daily schedule. Explicit stops and
supervised one-shot diagnostics remain available.

A durable removed-watch temperature diagnostic quarantine blocks scheduled
checks. Return to Manual and finish the supervised worn-trial cleanup before
applying the routine again; scheduled execution never clears that marker itself.

Deploy `firestore/rules.example`, restart the updated gateway with
`WELLNESS_ROUTINE_ENABLED=true` and the existing request/ingestion configuration.
No Flutter launch flag is required. Keep the
gateway host awake and ngrok connected for scheduled slots. No new index is
required. Day/slot ledgers contain operational metadata only and declare a
30-day `expiresAt`; Firestore TTL must be configured separately for deletion.

## Evidence and remaining checks

The supervised one-shot sequence has physical positive and sensor-up skip
evidence from 17 September. This daily scheduler is a new execution path: verify
one future user-selected slot and its displayed result after rollout. Daily
cadence, long-run reliability and battery impact still require field observation.
Software tests cover local-date boundaries, validation, idempotence, missed and
offline slots, daily limits, restart reservations, changed authorization and
schedule edits during measurement. Firestore and Flutter gates cover permissions
and editable-time controls. No exact-device acceptance flags are changed.

PRs #119 and #120 track the remaining hardware/data-quality work. Wiki sync is
pending because the connected GitHub tools do not expose Wiki editing.
