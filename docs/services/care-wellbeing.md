# Care wellbeing readings

| Field | Value |
|---|---|
| Service ID | `care-wellbeing` |
| Minimum package | Care |
| Current state | Implemented backbone; exact-device acceptance pending; disabled |
| Customer-visible | No; backend and Flutter release flags default off |
| Confirmed upload surface | `bphrt`, `oxygen` |
| Pilot-only request | `hrtstart,1` (V46/V52 parity guidance; exact V52 response pending) |
| Blocked pending exact packet | `bodytemp`, `bodytemp2`, `BTTIMESET` |

This implementation establishes a complete disabled backend, Firestore and Flutter path. It does not activate a device command, expose a menu item, or promise the service to customers.

The V52 datasheet lists heart rate, blood pressure, blood oxygen and skin temperature. The mixed V46/V48/V52 protocol specifies `bphrt` and `oxygen` uploads. Its separate example labels `hrtstart,1` as V46-only; supplier guidance says V46 and V52 use the same implementation. Guardian therefore supports `hrtstart,1` only through a strict-admin pilot gate until the exact production V52 returns a matching `bphrt` packet. The documents do not establish the V52 temperature upload value shape, so no temperature value is parsed or displayed.

## Safety controls

- non-medical wording
- no diagnosis or emergency clearance
- durable wearer consent controlled by the backend
- measurement quality and freshness labels
- no automatic normal/abnormal or safety classification

## Backend completion

- [x] strict-admin, separately flagged `hrtstart,1` pilot request
- [x] normalize confirmed heart/blood-pressure and SpO2 upload shapes
- [x] reject unconfirmed temperature shapes rather than guessing
- [x] require backend-owned consent before persistence
- [x] make client reads depend on current consent and delete retained readings on revocation
- [x] store source, receipt freshness, quality, displayability and 30-day retention
- [x] deduplicate repeated packets in a bounded receipt window
- [x] provide deterministic Care-only app and WhatsApp reads

## App completion

- [x] keep the request control administrator/pilot-only
- [x] show accepted readings with exact units, receipt time and freshness
- [x] compile customer UI out by default
- [x] show non-medical limitations and human/medical-help guidance

## Real-device acceptance

- [ ] confirm every command and upload shape on exact V52 firmware
- [ ] send `hrtstart,1` and match the watch display to the returned `bphrt` fields
- [ ] take wearer-initiated oxygen readings and capture `oxygen,type,value`
- [ ] compare repeated readings for transport consistency only
- [ ] obtain and capture the exact V52 temperature upload before adding it
- [ ] complete medical-language and privacy review
- [ ] test missing stale implausible and failed measurements

The feature flag must remain off until every acceptance gate has evidence attached to this pull request.

## Pilot flags

All defaults are fail-closed:

```dotenv
CARE_WELLBEING_INGEST_ENABLED=false
CARE_WELLBEING_DEVICE_MODE=unverified
CARE_WELLBEING_CUSTOMER_ENABLED=false
CARE_WELLBEING_REQUEST_ENABLED=false
CARE_WELLBEING_RETENTION_DAYS=30
```

The Flutter panel additionally requires `--dart-define=GUARDIAN_CARE_WELLBEING_ENABLED=true`. Do not set that customer flag during device acceptance.
