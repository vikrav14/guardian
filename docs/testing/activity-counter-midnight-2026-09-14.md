# Daily counter ledger and Mauritius midnight acceptance

## Decision and protocol evidence

On 14 September the operator counted 98 steps. Both the watch display and gateway
counter increased by 98. This comparison passes; the operator declined additional
repeat walks. The different absolute totals do not establish daily/reset semantics.

The supplied V46/V48/V52 Communication Protocol describes PEDO on/off and WALKTIME
counting windows (pages 8–9, sections 27, 30–31), RESET as device restart and FACTORY
as factory restore (page 11, sections 42–43). The Communication Example page 1
configures counting windows and enables PEDO. Neither supplies a clear-steps
command or an explicit counter-midnight rule. Original source provenance is
recorded in the supplier-validation ledger. No nightly device reset is used.

## Implemented accounting

- Unverified ingestion now computes schema-v2 `recordedSteps` from observed
  increases; the first raw value becomes a baseline, never today's total.
- A backend-only counter document persists across dates and restarts. Firestore
  transactions atomically commit baseline, daily aggregate and diagnostic interval.
- A new local-date document starts when the first fresh report arrives after
  midnight. No watch report means no fabricated zero-day or inactivity claim.
- Stable raw 20,000 before and after midnight establishes a zero new-day total;
  a later raw 20,098 contributes 98. Old-day totals remain stored.
- An increase spanning midnight is recorded as `cross_midnight_unallocated`;
  it is not assigned wholly to either date or evenly divided as a fact.
- Gaps over 30 minutes retain positive increases as unallocated. Identical values
  after a long gap also mark missing coverage, not confirmed inactivity.
- A decrease starts a pending reset. A second compatible low reading establishes
  a new baseline. Both raw values remain diagnostic evidence; neither is credited
  as a reset total. Earlier recorded steps survive. A return to the old range is
  treated as a rebound and cannot manufacture steps. Spikes also require a new
  stable baseline. Movement during ambiguous reset intervals can remain uncounted.
- Timestamped old/future uploads are rejected. Duplicate timestamped observations
  and receipt replays cannot consume or reset the baseline. LK has no source time,
  so receipt intervals and partial-coverage qualifications remain necessary.
- Customer activation is separate: `unverified` keeps reportedSteps null and
  displayable false; accepted `observed_delta` plus explicit customer enablement
  exposes recordedSteps with **Partial day** in app and WhatsApp. No flags change
  automatically. Legacy physically accepted `daily_reset` remains supported.
- During migration, the first v2 report starts a new partial-day baseline. Old v1
  raw values are not backfilled into accepted totals. Previous dates stay stored.
- Daily records retain their existing edition/retention policy. Raw diagnostics
  use at most 256 interval slots per watch and expire after seven days. This is
  bounded recent evidence; complete hourly history and weekly reports are follow-ups.
- Timestamped historical GPS exclusion and independent GPS/SOS dispatch remain.

## Tonight's field test: 14–15 September, Indian/Mauritius

Use the combined `feat/v52-care-wellbeing` branch containing both #119 and #120.
Keep the existing ingestion enabled, counter mode unverified and customer flags
off. Pull the update and restart the gateway once **before** the test. Keep it
running through midnight. The check below only reads Firestore and optionally
saves a local redacted JSON file under ignored `gateway/data/activity-checks`.

Run in `C:\Users\MSI\repos\guardian\gateway`:

```powershell
npm run activity:check -- --save=baseline
```

Wait for a fresh report and verify `persistedGatewayState.schemaVersion: 2`.
Its persisted mode/time show the aggregation state actually written by the
gateway; configurationSource still distinguishes the CLI environment.

At approximately 23:50–23:55 MUT, note the watch's displayed steps and time, stay
seated across midnight, and save:

```powershell
npm run activity:check -- --save=before-midnight
```

After midnight, around 00:02–00:05, note the watch count again and save:

```powershell
npm run activity:check -- --save=after-midnight
```

Wait for the first post-midnight watch upload if today's record is absent. If the
counter drops, wait for pendingDiscontinuity to clear after another compatible
upload. Record what the watch actually did; do not force its counter to zero.

Then take a small counted walk, wait for its upload, and save:

```powershell
npm run activity:check -- --save=after-walk
```

Pass evidence: previous date remains, new date is 2026-09-15, running raw total
does not become today's steps, and the post-baseline increase matches the actual
walk. Ambiguous boundary/reset intervals must be labelled and excluded as designed.
After these captures, restart only the gateway and save `--save=after-gateway-restart`;
the first subsequent upload must preserve the total without double counting.
Watch reboot is a separate later check, not part of tonight's midnight window.

Attach the saved redacted snapshots and the on-watch before/after counts to the
private field-test conversation. Midnight and real-device reboot remain pending
until measured; software tests alone do not complete physical acceptance.
