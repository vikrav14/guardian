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

This branch includes the shared wearing-evidence dependency from #119. It
consumes receipt-time `wearEvidence` instead of interpreting a clear bit-20
alarm as worn. See [the shared contract and passive test](wearing-data-quality.md).
Raw alarms, heartbeats and unverified wearing bits cannot restore status or
create a customer removal alert. The exact-device wearing mapping requires its
own acceptance and allowlist, in addition to all removal service gates.

The shared observer first confirms fresh worn/removed evidence over 60 seconds.
The notification policy then applies the configured removal/restore debounce
(default 60 seconds), quiet periods, customer gate and Family/Care routing.
One contradictory observation immediately makes the data-quality status
unknown. An unconfirmed period does not manufacture a restoration or duplicate
an already confirmed removal. Current app state expires locally after the
underlying evidence expires, even without another Firestore update.

Removal persistence and notification delivery run outside the GPS/SOS queue.
Pending observations are bounded/coalesced; slow writes may delay confirmation
but cannot block the physical alarm path. Before delivery, an obsolete removed
transition is suppressed if the latest wearing evidence is expired, unknown
or worn. Raw bit-20 alarms cannot bypass the qualified notification policy.

## Protocol boundary

The incoming V52 bit-20 removal alarm remains documented and regression-tested.
It does not establish positive wearing/restoration. Bit-3 polarity and continuous
behaviour still need exact-watch acceptance. The `REMOVESMS` payload/effect are
not accepted and no command is sent by this implementation.

## Remaining release work

- Complete the passive on-wrist/table/charging/restore/reconnect captures.
- Verify accepted status and notification timing on this exact firmware.
- Finish the wearer-visible configuration flow and delivery/retry acceptance.
- Keep this PR draft and all customer flags off until these gates pass.
