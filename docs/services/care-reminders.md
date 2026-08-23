# Care routines and accessibility reminders

| Field | Value |
|---|---|
| Service ID | `care-reminders` |
| Minimum package | Care |
| Current state | Software policy implemented; device sync disabled |
| Customer-visible | No |
| Protocol surface | `SEDENTARY`, `REMIND`, `HSW` |
| Accepted V52 reminder commands | None |

This draft builds the safe software boundary for Care routines without activating a V52 command, exposing a customer menu, or claiming that a reminder proves adherence.

## Implemented software boundary

- canonical validation for reminder kind, label, local time and weekdays
- Mauritius timezone semantics (`Indian/Mauritius`)
- quiet-hour evaluation including overnight windows
- explicit backend-only / blocked-unverified / sent / failed sync states
- delivery evidence kept separate from wearer acknowledgement
- acknowledgement support fixed to unavailable until a real signal exists
- Flutter schedule presentation model
- Flutter customer read surface compiled out by default with `GUARDIAN_CARE_REMINDERS_ENABLED=false`
- Flutter write/change path deliberately throws until audited backend processing is implemented and accepted
- service contracts now customer-hidden with no accepted protocol command

## Safety controls

- Guardian Care entitlement remains required
- schedules must be wearer-visible when customer activation eventually occurs
- quiet hours and rate limits remain mandatory
- caregiver changes require immutable backend audit evidence before writes can be exposed
- no claim that reminders prove medication use, activity, acknowledgement or adherence
- no `SEDENTARY`, `REMIND`, `HSW` or other reminder payload may be guessed from a command name

## Protocol boundary

The repository recognizes `SEDENTARY`, `REMIND` and `HSW` as server-to-watch protocol surfaces, but Guardian does not yet have accepted syntax and semantics for the production V52. They therefore remain non-dispatchable.

`TAKEPILLS` has a separate documented builder in the existing command layer. That evidence does not prove that `SEDENTARY`, `REMIND` or `HSW` share its fields, schedule limits, display behaviour or acknowledgement semantics.

## Still required before customer activation

### Backend and authorization

- [ ] add backend-owned create/update/delete request processing with immutable caregiver audit
- [ ] add Care-only Firestore reads for canonical schedules and deny direct client writes
- [ ] add per-item idempotency/rate limits and safe retry state
- [ ] add an explicit default-off gateway feature flag and accepted-device-mode gate before any dispatch path exists

### App

- [x] hidden schedule/read model
- [x] watch-sync state wording
- [x] separate delivered from acknowledged
- [ ] accessible configuration UI after backend request/audit path exists
- [ ] wearer-facing schedule visibility/product acceptance

### Real-device acceptance

- [ ] obtain exact V52 syntax/field definitions for `SEDENTARY`, `REMIND` and `HSW`
- [ ] confirm command limits and accepted time/day encodings
- [ ] verify display, sound and vibration behaviour on the exact production firmware
- [ ] verify enable/change/delete behaviour and reboot persistence
- [ ] test overlapping reminders, quiet-hour boundaries and reconnects
- [ ] prove whether any wearer acknowledgement signal actually exists; otherwise keep acknowledgement unavailable
- [ ] repeat on a second production-equivalent V52

## Current release rule

Keep the feature customer-hidden and do not add these commands to the generic `deviceCommands` dispatcher. No watch reminder command should be sent from this PR until exact-device evidence establishes a safe payload and explicit acceptance is attached.
