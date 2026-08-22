# Watch-removal safety alerts

| Field | Value |
|---|---|
| Service ID | `removal-alerts` |
| Minimum package | Family |
| Current state | Backbone only; disabled |
| Customer-visible | Only after acceptance |
| Protocol surface | `REMOVESMS` |

This draft establishes matching gateway and Flutter contracts. It does not activate a device command, expose a menu item, or promise the service to customers.

## Safety controls

- wearer-visible configuration
- debounced removal events
- configurable quiet periods
- alert deduplication
- privacy-safe event audit

## Backend completion

- [ ] manage removal detection settings
- [ ] normalize protocol alarm bit 20
- [ ] deduplicate and persist events
- [ ] route alerts by verified plan and caregiver

## App completion

- [ ] configure removal alerts
- [ ] show removal and restored states
- [ ] explain false-positive handling
- [ ] show alert delivery history

## Real-device acceptance

- [ ] confirm REMOVESMS syntax on exact V52 firmware
- [ ] measure wrist-off detection and restore timing
- [ ] test sleep and charging false positives
- [ ] verify only linked caregivers receive alerts

The feature flag must remain off until every acceptance gate has evidence attached to this pull request.
