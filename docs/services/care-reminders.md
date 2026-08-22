# Care routines and accessibility reminders

| Field | Value |
|---|---|
| Service ID | `care-reminders` |
| Minimum package | Care |
| Current state | Backbone only; disabled |
| Customer-visible | Only after acceptance |
| Protocol surface | `SEDENTARY`, `REMIND`, `HSW` |

This draft establishes matching gateway and Flutter contracts. It does not activate a device command, expose a menu item, or promise the service to customers.

## Safety controls

- Care-plan entitlement
- wearer-visible schedules
- quiet hours and rate limits
- caregiver change audit
- no claim that reminders prove adherence

## Backend completion

- [ ] model sedentary and clock reminder schedules
- [ ] validate firmware schedule limits
- [ ] sync commands with per-item state
- [ ] record delivery without inferring acknowledgement

## App completion

- [ ] configure routines and quiet hours
- [ ] show watch-sync state
- [ ] provide accessible clock options
- [ ] separate delivered from acknowledged

## Real-device acceptance

- [ ] confirm SEDENTARY REMIND and HSW syntax on exact V52 firmware
- [ ] verify display audio and vibration behaviour
- [ ] test overlapping reminders and reboots
- [ ] confirm the UI never invents acknowledgements

The feature flag must remain off until every acceptance gate has evidence attached to this pull request.
