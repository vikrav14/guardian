# Steps and daily activity

| Field | Value |
|---|---|
| Service ID | `activity-steps` |
| Minimum package | Family |
| Current state | Implementation complete; disabled pending physical acceptance |
| Customer-visible | Only after acceptance |
| Protocol surface | passive `LK`/position step field; optional `PEDO`, `WALKTIME` configuration |

The backend and app surfaces are implemented, but both release gates default to
off. The gateway sends no pedometer command, the app compiles without the card,
and WhatsApp does not advertise or expose this feature until acceptance is
recorded.

## What the V52 documentation establishes

- `LK,steps,rolls,battery` passively carries the raw step counter.
- Full positioning packets also carry the raw step value at field index 13.
- `PEDO,1|0` enables or disables step counting; its acknowledgement is `PEDO`.
- `WALKTIME,...` configures three counting windows; its acknowledgement is
  `WALKTIME`.

Neither `PEDO` nor `WALKTIME` uploads a total. Guardian aggregates the passive
counter already received in normal watch traffic. The commands are not sent by
this implementation.

## Safety controls

- wearer-controlled activity visibility
- timezone-aware day boundaries
- counter-reset detection
- no medical claims
- fixed, configurable retention
- stale and implausible counters fail closed

## Completed backend

- [x] normalize raw counters from existing V52 events
- [x] aggregate steps by Mauritius local day
- [x] reject stale packets and detect resets and implausible jumps
- [x] persist bounded `activityDays` records without per-packet history writes
- [x] enforce linked-watch and Family/Care reads in Firestore rules
- [x] serve deterministic today/seven-day WhatsApp summaries without an LLM

## Completed app

- [x] show the accepted daily total and seven-day bars
- [x] show last-sync and unavailable states
- [x] lock Essential to a Family upgrade boundary
- [x] explain estimate and non-medical status

Active minutes, calories, distance and clinical interpretations are not present
in the documented V52 counter and are deliberately not derived or advertised.

## Release gates

Three independent gates prevent accidental exposure:

1. `ACTIVITY_STEPS_INGEST_ENABLED=false` prevents daily aggregation.
2. `ACTIVITY_STEPS_COUNTER_MODE=unverified` makes every stored day
   non-displayable even if shadow ingestion is enabled.
3. `ACTIVITY_STEPS_CUSTOMER_ENABLED=false` blocks WhatsApp reads, while the
   Flutter build flag `GUARDIAN_ACTIVITY_STEPS_ENABLED=false` omits the app card.

Shadow collection may begin by enabling ingestion while keeping the other
three values unchanged. After acceptance, set the counter mode to
`daily_reset`, validate stored days, and only then enable the two customer
surfaces.

## Real-device acceptance

- [ ] confirm raw `LK` and position counters on the exact V52 firmware
- [ ] determine midnight, reboot and PEDO-off reset semantics
- [ ] confirm `PEDO`/`WALKTIME` only if Guardian needs to change watch defaults
- [ ] compare watch counters against controlled walks
- [ ] test midnight timezone and reboot resets
- [ ] measure battery and data impact

The customer flags must remain off until every acceptance gate has evidence
attached to this pull request. A backend write, command acknowledgement or unit
test is not physical counter acceptance.
