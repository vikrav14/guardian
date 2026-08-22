# Care wellbeing readings

| Field | Value |
|---|---|
| Service ID | `care-wellbeing` |
| Minimum package | Care |
| Current state | Backbone only; disabled |
| Customer-visible | Only after acceptance |
| Protocol surface | `hrtstart`, `oxygen`, `bodytemp`, `bodytemp2`, `BTTIMESET` |

This draft establishes matching gateway and Flutter contracts. It does not activate a device command, expose a menu item, or promise the service to customers.

## Safety controls

- wellness-only wording
- no diagnosis or emergency clearance
- explicit wearer consent
- measurement quality and freshness labels
- clinically unsafe values trigger human-check guidance

## Backend completion

- [ ] authorize on-demand measurements
- [ ] normalize heart blood pressure SpO2 and temperature uploads
- [ ] store source quality and freshness
- [ ] produce bounded trends without diagnostic interpretation

## App completion

- [ ] request supported measurements
- [ ] show quality freshness and device limitations
- [ ] display trends with non-medical disclosure
- [ ] direct concerning situations to appropriate human help

## Real-device acceptance

- [ ] confirm every command and upload shape on exact V52 firmware
- [ ] compare repeated readings for consistency only
- [ ] complete medical-language and privacy review
- [ ] test missing stale implausible and failed measurements

The feature flag must remain off until every acceptance gate has evidence attached to this pull request.
