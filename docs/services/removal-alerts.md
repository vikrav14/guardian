# Watch-removal safety alerts

| Field | Value |
|---|---|
| Service ID | `removal-alerts` |
| Minimum package | Family |
| Current state | Implementation complete; disabled pending physical acceptance |
| Customer-visible | Only after acceptance |
| Protocol surface | `REMOVESMS` |

This draft implements a fail-closed shadow path. It does not activate a device
command, expose a menu item, send a customer notification or promise the
service to customers.

Three independent gates default off:

- `REMOVAL_ALERTS_INGEST_ENABLED=false`
- `REMOVAL_ALERTS_DEVICE_MODE=unverified`
- `REMOVAL_ALERTS_CUSTOMER_ENABLED=false`

Flutter additionally compiles the customer read path out unless
`GUARDIAN_REMOVAL_ALERTS_ENABLED=true` is supplied at build time.

## Safety controls

- wearer-visible configuration
- debounced removal events
- configurable quiet periods
- alert deduplication
- privacy-safe event audit

## Backend completion

- [x] accept backend-owned removal detection settings
- [x] normalize protocol alarm bit 20 on alarm and positioning state
- [x] debounce, deduplicate and persist removed/restored state
- [x] route accepted alerts only to verified Family/Care recipients
- [x] retain privacy-safe transition audit evidence
- [ ] implement an authenticated wearer-visible settings workflow

## App completion

- [x] add hidden accepted-state and history models/services
- [x] add Family entitlement and Essential upgrade boundary
- [x] recognize removal alerts in the existing alert history UI
- [ ] expose wearer-visible configuration after acceptance
- [ ] expose accepted removed/restored state after acceptance
- [ ] show false-positive guidance and delivery history after acceptance

## Real-device acceptance

- [ ] confirm REMOVESMS syntax on exact V52 firmware
- [ ] measure wrist-off detection and restore timing
- [ ] test sleep and charging false positives
- [ ] verify only linked caregivers receive alerts

The feature flag must remain off until every acceptance gate has evidence attached to this pull request.

## Transition policy

A single bit-20 observation never creates a customer alert. Guardian records a
candidate state and requires a later tracker-state observation after the
configured debounce window. A clear observation cancels an unconfirmed
removal. Restoration is independently debounced. Quiet periods suppress
customer delivery but still retain the privacy-safe transition audit.

This policy is intentionally conservative until the exact V52 proves whether
bit 20 is a sustained state or a transient alarm flag. If the firmware emits
only one transient alarm, acceptance must adjust the policy using captured
evidence rather than weakening it by assumption.

## Protocol boundary

The incoming V52 tracker-state mapping for bracelet removal is documented at
bit 20 and regression-tested. The exact `REMOVESMS` payload and its firmware
effect are not accepted. Guardian therefore does not send that command from
this implementation.
