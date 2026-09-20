# Steps and daily activity

> **20 September 2026 implementation update:** the shared Wellness edition design
> exposes recorded step increases as explicitly labelled estimates. Essential gets
> today, Family seven days, and Care retained history. Midnight/reset semantics and
> wearing remain unconfirmed. See
> [the current edition contract](../design/wellness-editions-2026-09-14.md).


| Field | Value |
|---|---|
| Service ID | `activity-steps` |
| Minimum package | Essential (today); Family (7 days); Care (retained history) |
| Current state | Implementation complete; observed estimates enabled; physical acceptance still pending |
| Customer-visible | Observed estimates with Partial day and unconfirmed-wearing wording |
| Protocol surface | passive `LK`/position step field; optional `PEDO`, `WALKTIME` configuration |

The backend and app surfaces are implemented. The gateway passively aggregates
counter increases and exposes them as recorded estimates; it sends no pedometer
command. The app and deterministic WhatsApp surface retain Partial day and
unconfirmed-wearing wording. This does not claim proven midnight/reset semantics
or that the watch was worn during an interval.

## What the V52 documentation establishes

- `LK,steps,rolls,battery` passively carries the raw step counter.
- Full positioning packets also carry the raw step value at field index 13.
- `PEDO,1|0` enables or disables step counting; its acknowledgement is `PEDO`.
- `WALKTIME,...` configures three counting windows; its acknowledgement is
  `WALKTIME`.

Neither `PEDO` nor `WALKTIME` uploads a total. Guardian aggregates the passive
counter already received in normal watch traffic. The passive pipeline never
sends these commands automatically. A strict-admin technician workflow is
available because the first live Guardian V52 presented an inactive pedometer.

## Provision a new watch

With the gateway running and the watch online, a technician may explicitly run:

```bash
npm run activity:provision -- --imei YOUR_DEVICE_IMEI --enable
```

The dedicated endpoint applies the documented full-day sheet
`00:00-23:59,00:00-00:00,00:00-00:00` before `PEDO,1`. It requires
`ADMIN_API_KEY`, records an audit event and returns no arbitrary downlink
surface. A successful response means socket handoff only; the technician must
still confirm that the watch's Steps screen activates and passive telemetry
matches it. Disabling requires the explicit `--disable` flag and preserves the
stored time sheet.

## Safety controls

- wearer-controlled activity visibility
- timezone-aware day boundaries
- counter-reset detection
- no medical claims
- bounded retention with active-Care review for accepted history
- stale and implausible counters fail closed

## Completed backend

- [x] normalize raw counters from existing V52 events
- [x] aggregate steps by Mauritius local day
- [x] reject stale packets and detect resets and implausible jumps
- [x] persist daily records, a durable counter baseline and at most 256 recent diagnostic intervals per watch
- [x] enforce linked-watch, consent and edition date windows in Firestore rules
- [x] serve deterministic today/seven-day WhatsApp summaries without an LLM
- [x] provide strict-admin, audited new-watch pedometer provisioning

## Completed app

- [x] show today's accepted total, Family seven-day bars and Care retained history
- [x] show last-sync and unavailable states
- [x] include today's Wellness dashboard in Essential and gate older dates by edition
- [x] explain estimate and non-medical status

Active minutes, calories, distance and clinical interpretations are not present
in the documented V52 counter and are deliberately not derived or advertised.

## Release gates

Backend and app gates prevent accidental exposure:

1. `ACTIVITY_STEPS_INGEST_ENABLED=true` enables passive aggregation.
2. `ACTIVITY_STEPS_COUNTER_MODE=observed_delta` publishes recorded increases
   as partial-day estimates without treating them as a proven daily total.
3. `ACTIVITY_STEPS_CUSTOMER_ENABLED=true` publishes the bounded estimate to
   entitled app/WhatsApp surfaces.
4. The Flutter build flag `GUARDIAN_ACTIVITY_STEPS_ENABLED=false` still omits
   the app card when an operator explicitly disables the feature.

Shadow collection may begin by enabling ingestion while keeping the other
three values unchanged. In `unverified` mode, schema-v2 daily `recordedSteps`
now sums observed increases using a persistent cross-day baseline. Customer
`reportedSteps` stays null. After exact-device acceptance, `observed_delta`
supports customer totals labelled **Partial day**, with separate customer flags.
The legacy `daily_reset` mode remains available only for firmware whose daily
reset behaviour has independently been proven; do not select it for this pilot.

See [the counter ledger and midnight test](../testing/activity-counter-midnight-2026-09-14.md)
for reset handling, boundary uncertainty, migration and the read-only capture command.

## Real-device acceptance

- [x] confirm raw `LK` counter on the first Guardian V52 firmware
- [ ] determine midnight, reboot and PEDO-off reset semantics
- [x] confirm the documented full-day `WALKTIME` plus `PEDO,1` activates the first Guardian V52
- [ ] repeat controlled-walk accuracy across longer walks and another V52
- [ ] test midnight timezone and reboot resets
- [ ] measure battery and data impact

Customer display is enabled for the estimate mode, but the feature remains
Partial until the exact-device midnight, reboot, controlled-walk and battery
evidence is complete. A backend write, command acknowledgement or unit test is
not physical counter acceptance.


## Historical QA handoff — counter accuracy and merge block

The 14 September operator-confirmed 98-step walk supersedes the repeat-walk
request below for this checkpoint. Actual count, watch increase and uploaded
increase all matched 98. Do not request the declined repeat walks again.
Midnight and reboot semantics remain separate checks.

The first pilot observations are useful but not a controlled accuracy result:

- a prior controlled 100-step walk produced a backend delta of 99;
- a later watch-display increase included carrying the watch outdoors for GPS
  acceptance, so it cannot be classified as stationary false-step inflation;
- one short carry back indoors increased the display by more than the operator's
  estimated walking steps, but hand carrying, delayed counter updates and
  pickup/put-down motion were not isolated.

QA must complete and attach all of the following before merge:

- [ ] 30-minute flat, untouched indoor stationary test;
- [ ] 30-minute flat, untouched outdoor stationary test;
- [ ] at least three 100-step walks with the watch worn normally;
- [ ] a longer measured walk;
- [ ] compare the on-watch value with Guardian's passive raw value after allowing
      for delayed updates;
- [ ] midnight rollover;
- [ ] watch reboot and gateway restart as separate cases;
- [ ] document acceptable tolerance and obtain product acceptance.

Until QA signs off, keep the counter mode `unverified`, keep every customer
surface disabled, do not advertise activity accuracy and do not merge this PR.
