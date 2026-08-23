# Answer and scene controls

| Field | Value |
|---|---|
| Service ID | `watch-modes` |
| Minimum package | Family |
| Current state | Backbone only; disabled |
| Customer-visible | Only after acceptance |
| Protocol surface | `profile`, `APPLOCK` |

This draft establishes matching gateway and Flutter contracts. It does not activate a device command, expose a menu item, or promise the service to customers.

## Safety controls

- explicit caregiver authorization
- safe default ring mode
- time-bounded silent mode
- wearer-visible state
- audit every remote change

## Backend completion

- [ ] model supported answer and scene modes
- [ ] validate mode transitions
- [ ] dispatch supported profile commands
- [ ] restore safe defaults after expiry

## App completion

- [ ] show current watch mode
- [ ] offer firmware-supported choices only
- [ ] confirm silent-mode changes
- [ ] show sync and expiry state

## Real-device acceptance

- [ ] confirm profile and APPLOCK semantics on exact V52 firmware
- [ ] verify inbound-call answer behaviour
- [ ] verify ring vibrate and silent results
- [ ] prove safe recovery after reboot and timeout

The feature flag must remain off until every acceptance gate has evidence attached to this pull request.
