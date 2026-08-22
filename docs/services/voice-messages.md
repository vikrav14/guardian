# Family voice messages

| Field | Value |
|---|---|
| Service ID | `voice-messages` |
| Minimum package | Family |
| Current state | Backbone only; disabled |
| Customer-visible | Only after acceptance |
| Protocol surface | `TK`, `AMR` |

This draft establishes matching gateway and Flutter contracts. It does not activate a device command, expose a menu item, or promise the service to customers.

## Safety controls

- approved caregivers only
- bounded clip duration and size
- malware-safe media handling
- private expiring storage
- data-usage disclosure

## Backend completion

- [ ] ingest supported watch audio format
- [ ] transcode only when required
- [ ] store clips privately with expiry
- [ ] deliver authenticated metadata and playback URLs

## App completion

- [ ] record and send bounded voice clips
- [ ] play received watch messages
- [ ] show delivery and expiry state
- [ ] show mobile-data disclosure

## Real-device acceptance

- [ ] confirm exact V52 uplink and downlink framing
- [ ] validate codec and maximum payload on real hardware
- [ ] measure data consumption
- [ ] verify expired media cannot be fetched

The feature flag must remain off until every acceptance gate has evidence attached to this pull request.
