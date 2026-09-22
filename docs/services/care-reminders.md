# Care routines and accessibility reminders

| Field | Value |
|---|---|
| Service ID | `care-reminders` |
| Minimum package | Care |
| Current state | Software path implemented; device sync disabled |
| Customer-visible | No |
| Protocol surface | `SEDENTARY`, `REMIND`, `HSW` |
| Accepted V52 reminder commands | Full release acceptance incomplete; partial pilot results recorded below |

PR #118 now focuses on the remaining `SEDENTARY`, `REMIND` and `HSW` work.
Wellness routines (#120/#127) and Family/Care medication reminders using
`TAKEPILLS` (#131) already reached main; they are not outstanding in this PR.

The Care-only automatic scheduling boundary remains disabled and hidden.
An explicit operator CLI supports REMIND once/off, HSW on/off and a fixed
26-minute SEDENTARY on/off trial. All preview by default. REMIND once-only
sound/visible clearing and local SEDENTARY speech were observed; remote
SEDENTARY and HSW execution remain unverified.

[Jett's reply received 22 September](../testing/care-reminder-supplier-reply-2026-09-22.md)
defines sedentary inactivity/minutes/switch polarity and HSW off/on.

See [supplier evidence, Windows trial and closure checklist](../testing/care-reminder-command-acceptance.md).

## Implemented software boundary

- canonical validation for reminder kind, label, local time and weekdays
- Mauritius timezone semantics (`Indian/Mauritius`)
- quiet-hour evaluation including overnight windows
- explicit backend-only / blocked-unverified / sent / failed sync states
- delivery evidence kept separate from wearer acknowledgement
- acknowledgement support fixed to unavailable until a real signal exists
- Care-only, linked-device backend authorization
- inherited family access requires backend-managed `memberUids`
- audited `careReminderRequests` -> `careReminderSchedules` processing
- immutable `careReminderAudit` evidence with `deviceCommandSent: false`
- direct client writes to canonical schedules and audit records denied
- Firestore emulator coverage for Care, Family, unlinked and requester-spoofing boundaries
- backend request watcher integrated into the existing reminder scheduler, but gated off by default
- Flutter schedule presentation model
- Flutter customer reads compiled out by default with `GUARDIAN_CARE_REMINDERS_ENABLED=false`
- Flutter write/change path remains unavailable until customer/product acceptance

## Default-off release gates

```dotenv
CARE_REMINDERS_REQUESTS_ENABLED=false
CARE_REMINDERS_DEVICE_MODE=unverified
CARE_REMINDERS_CUSTOMER_ENABLED=false
```

Flutter remains compiled out by default:

```text
GUARDIAN_CARE_REMINDERS_ENABLED=false
```

`CARE_REMINDERS_DEVICE_MODE=accepted` by itself does not start request processing or expose customers. The request watcher requires its own explicit gate. No automatic or customer dispatcher is enabled. The isolated operator trial can send the bounded commands with --send; REMIND additionally requires explicit three-clock replacement confirmation.

## Firestore ownership

### `careReminderRequests/{requestId}`

A signed-in, linked Guardian Care user may enqueue a narrowly shaped `pending` request for their own identity. Clients cannot update or delete it after creation.

### `careReminderSchedules/{scheduleId}`

Canonical backend-owned schedule state. Eligible linked Care members may read records belonging to their effective service owner. All client writes are denied.

### `careReminderAudit/{requestId}`

Immutable backend-owned caregiver-change evidence. Eligible linked Care members may read their family records. All client writes are denied.

## Safety controls

- Guardian Care entitlement is required
- schedules must be wearer-visible when customer activation eventually occurs
- quiet hours remain part of the canonical schedule model
- caregiver changes produce backend audit evidence before canonical state changes
- no claim that reminders prove medication use, activity, acknowledgement or adherence
- no `SEDENTARY`, `REMIND`, `HSW` or other reminder payload may be guessed from a command name
- the existing medication reminder scheduler remains a separate service path

## Protocol boundary

The supplier protocol defines `REMIND` clocks and the example confirms three
slots. The operator trial supports one once-only clock and disabling all three
slots. Jett now defines SEDENTARY 1 as on, 0 as off and 26 as minutes of no
detected movement, producing sound. The first remote trial retains 26 on/off;
no arbitrary wire range is assumed. HSW,0 is off and HSW,1 is on, with speech
trigger and reboot persistence still unknown. Full acceptance remains incomplete.

`TAKEPILLS` has a separate documented builder in the existing command layer. That evidence does not prove that `SEDENTARY`, `REMIND` or `HSW` share its fields, schedule limits, display behaviour or acknowledgement semantics.

## Software acceptance status

- [x] canonical schedule policy
- [x] Care/link authorization policy
- [x] backend request processor and immutable audit shape
- [x] request watcher startup wiring behind a default-off gate
- [x] Care-only Firestore reads and denied direct client writes
- [x] Firestore emulator authorization tests
- [x] default-off gateway runtime gates
- [x] hidden Flutter read/presentation model
- [x] release-gate regression tests preventing device dispatch
- [ ] full GitHub gateway, Firestore and Flutter release gates on the final software head

## Still required before customer activation

### App / product

- [ ] accessible configuration UI only after privacy/security/product approval
- [ ] wearer-facing schedule visibility/product acceptance
- [ ] customer feature flags enabled in a later reviewed PR

### Real-device acceptance

- [x] retrieve supplier command examples and document evidence gaps
- [x] implement preview-first operator `REMIND` once/off trial with tests
- [x] supplier defines SEDENTARY switch/minutes/inactivity and HSW off/on
- [ ] verify remote SEDENTARY on/off and HSW speech trigger/effective disable
- [ ] confirm command limits and accepted time/day encodings
- [ ] verify display, sound and vibration behaviour on the exact production firmware
- [ ] verify enable/change/delete behaviour and reboot persistence
- [ ] test overlapping reminders, quiet-hour boundaries and reconnects
- [ ] prove whether any wearer acknowledgement signal actually exists; otherwise keep acknowledgement unavailable
- [ ] repeat on a second production-equivalent V52

## Current release rule

Keep the feature customer-hidden and do not add these commands to the generic `deviceCommands` dispatcher. Only the bounded operator trial may send with --send. REMIND still requires three-clock replacement confirmation. HSW on/off and fixed-26-minute SEDENTARY on/off use the supplier definitions; legacy example actions remain preview-only. Socket handoff is separate from physical acceptance. Product rollout requires the remaining acceptance checklist.
