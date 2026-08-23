# Multi-contact SOS routing

| Field | Value |
|---|---|
| Service ID | `sos-contacts` |
| Minimum package | Essential |
| Current state | Backbone only; disabled |
| Customer-visible | Only after acceptance |
| Protocol surface | `SOS1`, `SOS2`, `SOS3` |

This draft establishes matching gateway and Flutter contracts. It does not activate a device command, expose a menu item, or promise the service to customers.

## Safety controls

- one verified primary guardian
- explicit contact ordering
- deduplicate phone numbers
- failed-sync visibility
- full contact-change audit

## Backend completion

- [ ] persist ordered SOS contacts
- [ ] validate and normalize numbers
- [ ] sync SOS1 through SOS3
- [ ] surface per-slot sync status

## App completion

- [ ] edit and reorder SOS contacts
- [ ] show primary and fallback roles
- [ ] show device-sync state
- [ ] link callback behaviour to PR #109

## Real-device acceptance

- [ ] confirm SOS1/SOS2/SOS3 support on exact V52 firmware
- [ ] verify fallback order with controlled test numbers
- [ ] verify coexistence with PR #109 callback alarm mode
- [ ] confirm no unapproved number is written

The feature flag must remain off until every acceptance gate has evidence attached to this pull request.
