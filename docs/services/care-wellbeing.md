# Wellness watch readings

> **14 September 2026 implementation update:** the shared Wellness edition design
> supersedes older Care-only/Family-only reading access described below. Essential
> gets today, Family seven days, and Care retained history. All device/customer
> acceptance gates remain off by default. See
> [the current edition contract](../design/wellness-editions-2026-09-14.md).


| Field | Value |
|---|---|
| Service ID | `care-wellbeing` |
| Minimum package | Essential (today); Family (7 days); Care (retained history) |
| Current state | Implemented backbone; exact-device acceptance pending; disabled |
| Customer-visible | No; backend and Flutter release flags default off |
| Confirmed upload surface | `bphrt`, `oxygen` |
| Confirmed scheduled measurement | `hrtstart,300..65535`; `3600` is Guardian's intended hourly interval |
| Confirmed stop | `hrtstart,0` |
| One-time request | `hrtstart,1` is acknowledged but did not start measurement on the pilot V52 |
| Private pilot temperature | `btemp2,1,<two-decimal Celsius value>` matched a wearer-initiated wrist result on 15 September; first field meaning and other variants remain unverified |
| Documented private temperature controls | BT=2: `bodytemp2` single; `bodytemp,0/1,1..12` cycle in hours; exact-watch command acceptance pending |
| Blocked timing mode | `BTTIMESET` (TM=1, separate from BT=2 cycles) |

For the observed `btemp2` variant, follow the [private payload capture runbook](../testing/temperature-payload-pilot-2026-09-15.md).

This implementation establishes a complete disabled backend, Firestore and Flutter path. It does not activate a device command, expose a menu item, or promise the service to customers.

The V52 datasheet lists heart rate, blood pressure, blood oxygen and skin temperature. The mixed V46/V48/V52 protocol specifies `bphrt` and `oxygen` uploads. Its separate example labels `hrtstart,1` as V46-only. On 23 August 2026 the pilot V52 acknowledged that command but did not start measuring until the wearer pressed the health control. The same watch accepted `hrtstart,300` and produced recurring, consent-gated `bphrt` and `oxygen` uploads without wearer interaction. Guardian therefore uses the scheduled form for the Care pilot, defaults to `3600` seconds, reserves `300` seconds for acceptance testing, and provides `hrtstart,0` as an explicit stop. The documents do not establish the V52 temperature upload value shape. The 15 September capture and watch comparison now support one narrow private-preview variant; they do not establish its clinical accuracy or a temperature downlink.

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
- [x] store source, receipt freshness, quality, displayability and retention with active-Care review
- [x] deduplicate repeated packets in a bounded receipt window
- [x] provide calendar-bounded app reads for all editions and basic Family/Care WhatsApp reads

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
- [x] capture and compare one wearer-initiated `btemp2,1,<value>` wrist-temperature upload for private preview
- [ ] validate additional temperature variants, failures, ACK semantics and sensor reliability before customer acceptance
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

The app remains customer-hidden. When enabled after acceptance, all active editions share the **Wellness** dashboard with individual reading freshness, explicit stale/missing states and non-medical wording. Essential includes today; Family includes today and six preceding Mauritius calendar days; Care can browse available retained history. Skin temperature remains unavailable outside the separately authorized private preview.

## Private temperature preview

With wellbeing ingestion enabled, only `WIFI_HOME_PILOT_IMEI` may store the
observed `btemp2` variant. Prefix `1` is preserved as `sourceVariant`, not used as
wearing, success or measurement-mode evidence. Exactly two arguments are required;
the second must have two decimal places and pass broad transport bounds above
zero and at most 60 Celsius. These are rejection bounds, not clinical thresholds.
Other commands, prefixes, encodings and error/sentinel shapes remain unsupported.

Every stored temperature record is `privatePreviewOnly: true`, `displayable: false`
and `deviceMode: unverified`, even if general wellbeing acceptance is enabled.
Current consent, existing retention and the expiring viewer grant still apply.
The dashboard and dated history show the watch estimate with its receipt time;
receipt is not proof of measurement time. No temperature requests, automatic
schedules, customer reports or alerts are enabled. See the
[capture/import runbook](../testing/temperature-payload-pilot-2026-09-15.md).

For the current read-only pilot check and remaining physical tests, see
[the resumed acceptance handoff](../testing/wellness-resume-2026-09-14.md).


## Wearing data quality (2026-09-14)

New readings require fresh, exact-device-accepted wearing evidence as well as
consent, accepted measurement mode and customer enablement before display.
Each reading stores its receipt-time `wearEvidence`, `wearQualified` and
`wearReason`; unverified/off-wrist uploads stay private and cannot enter customer
analytics. Receipt time is not a proven measurement time. Equal values in the
same two-minute bucket are deduplicated only within the same wearing period,
so an excluded off-wrist upload cannot suppress a subsequent qualified upload.
The Wellness card shows current wearing status on every edition, expires it
locally and retains earlier qualified readings with their original age.
See [the shared wearing contract and passive test](wearing-data-quality.md).
No hardware schedule is changed or automatically stopped/restarted by this work.

**15 September routine update:** the private controller now offers Manual,
Gentle (12h) and Balanced (8h), requiring fresh accepted wearing evidence and
current-session CONFIG BT:2 before any automatic start. This supersedes the
earlier capture-only/downlink limitation for the documented BT=2 pilot commands.
The separate strict-admin single-temperature test does not promote wearing or
measurement acceptance. See [commands, safeguards and remaining watch tests](../testing/wellness-routines-2026-09-15.md).
