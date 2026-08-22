# Wi-Fi home-presence detection

| Field | Value |
|---|---|
| Service ID | `wifi-home` |
| Minimum package | Family |
| Current state | Backbone only; disabled |
| Customer-visible | Only after acceptance |
| Protocol surface | `WIFIFENCE` |

This draft establishes matching gateway and Flutter contracts. It does not activate a device command, expose a menu item, or promise the service to customers.

## Safety controls

- store no Wi-Fi password
- hash or minimize network identifiers
- owner-controlled enrollment
- location fallback when confidence is low
- home-status access limited to linked caregivers

## Backend completion

- [ ] enroll supported 2.4 GHz identifiers
- [ ] normalize WIFIFENCE events
- [ ] combine Wi-Fi and location confidence
- [ ] persist bounded home-presence history

## App completion

- [ ] guide 2.4 GHz home enrollment
- [ ] show confidence and last update
- [ ] explain location fallback
- [ ] allow immediate network removal

## Real-device acceptance

- [ ] confirm WIFIFENCE syntax and event format on exact V52 firmware
- [ ] verify identifier privacy at rest
- [ ] test enter leave and router-restart cases
- [ ] test phones with split and combined Wi-Fi SSIDs

The feature flag must remain off until every acceptance gate has evidence attached to this pull request.
