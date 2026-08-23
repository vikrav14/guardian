# Care wellbeing readings

| Field | Value |
|---|---|
| Service ID | `care-wellbeing` |
| Minimum package | Care |
| Current state | Implemented backbone; exact-device acceptance pending; disabled |
| Customer-visible | No; backend and Flutter release flags default off |
| Confirmed upload surface | `bphrt`, `oxygen` |
| Confirmed scheduled measurement | `hrtstart,300..65535`; `3600` is Guardian's intended hourly interval |
| Confirmed stop | `hrtstart,0` |
| One-time request | `hrtstart,1` is acknowledged but did not start measurement on the pilot V52 |
| Blocked pending exact packet | `bodytemp`, `bodytemp2`, `BTTIMESET` |

This implementation establishes a complete disabled backend, Firestore and Flutter path. It does not activate a device command, expose a menu item, or promise the service to customers.

The V52 datasheet lists heart rate, blood pressure, blood oxygen and skin temperature. The mixed V46/V48/V52 protocol specifies `bphrt` and `oxygen` uploads. Its separate example labels `hrtstart,1` as V46-only. On 23 August 2026 the pilot V52 acknowledged that command but did not start measuring until the wearer pressed the health control. The same watch accepted `hrtstart,300` and produced recurring, consent-gated `bphrt` and `oxygen` uploads without wearer interaction. Guardian therefore uses the scheduled form for the Care pilot, defaults to `3600` seconds, reserves `300` seconds for acceptance testing, and provides `hrtstart,0` as an explicit stop. The documents do not establish the V52 temperature upload value shape, so no temperature value is parsed or displayed.

## Safety controls

- non-medical wording
- no diagnosis or emergency clearance
- durable wearer consent controlled by the backend
- measurement quality and freshness labels
- no automatic normal/abnormal or safety classification

## Backend completion

- [x] strict-admin, separately flagged scheduled measurement and stop controls
- [x] enforce the documented 300-65535 second interval range
- [x] attempt `hrtstart,0` before consent revocation and report failures honestly
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
- [x] match wearer-initiated watch values to returned `bphrt` and `oxygen` fields on one pilot V52
- [x] capture two autonomous measurement cycles under `hrtstart,300`
- [ ] complete a 24-hour `hrtstart,3600` reliability and battery trial
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

## Pilot commands

```powershell
# Intended Care interval: hourly
npm run wellbeing:request -- --imei YOUR_15_DIGIT_IMEI --schedule-seconds 3600

# Acceptance only: five minutes
npm run wellbeing:request -- --imei YOUR_15_DIGIT_IMEI --schedule-seconds 300

# Stop scheduled measurement
npm run wellbeing:request -- --imei YOUR_15_DIGIT_IMEI --stop
```

The app remains customer-hidden. When enabled after acceptance, Guardian Care shows a **Latest wellbeing** card with exact watch estimates, receipt freshness, an explicit stale/missing state, and non-medical wording.
