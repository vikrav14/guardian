# Steps and daily activity

| Field | Value |
|---|---|
| Service ID | `activity-steps` |
| Minimum package | Family |
| Current state | Backbone only; disabled |
| Customer-visible | Only after acceptance |
| Protocol surface | `PEDO`, `WALKTIME` |

This draft establishes matching gateway and Flutter contracts. It does not activate a device command, expose a menu item, or promise the service to customers.

## Safety controls

- wearer-controlled activity visibility
- timezone-aware day boundaries
- counter-reset detection
- no medical claims
- bounded retention by plan

## Backend completion

- [ ] normalize pedometer uploads
- [ ] aggregate steps and active minutes by local day
- [ ] detect resets and implausible jumps
- [ ] serve privacy-filtered daily and weekly summaries

## App completion

- [ ] show steps and active-time cards
- [ ] show last sync and data gaps
- [ ] provide day and week views
- [ ] explain estimates and non-medical status

## Real-device acceptance

- [ ] confirm PEDO and WALKTIME payloads on exact V52 firmware
- [ ] compare watch counters against controlled walks
- [ ] test midnight timezone and reboot resets
- [ ] measure battery and data impact

The feature flag must remain off until every acceptance gate has evidence attached to this pull request.
