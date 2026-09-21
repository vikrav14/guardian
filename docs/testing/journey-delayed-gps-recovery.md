# Delayed GPS and journey durability

## Incident and evidence

The September 14 pilot returned from an outing but the journey screen still
showed only an earlier trip. The gateway logs contained a reconnect followed by
valid satellite reports. A read-only capture of recent Firestore device document
versions recovered 16 distinct GPS observations with original timestamps.
Those timestamps confirmed that the reconnect delivered observations tens of
minutes after they were recorded. The route contains a 24-minute observation gap.
Private coordinates, device identifiers and capture files are not committed.

The Home tracking policy correctly excludes stale GPS from current departure
decisions. Previously there was no independent historical route processor for
those reports. Ordinary movement writes updated the latest device observation
without necessarily retaining a location-history document. Active outings were
also held only in memory, and completed journeys lacked a durable retry outbox.

## Behavior after this change

| Event | Behavior |
| --- | --- |
| GPS packet arrives | Preserve coordinates, source validity and original time in a private local journal before acknowledging a location-only packet. |
| Fresh observation | Existing live Home, geofence, journey and notification policies apply; checkpoint the journey. |
| Delayed or out-of-order observation | Keep it for history. Do not move current location backwards or create retrospective geofence alerts. |
| Burst ends | After at least 60 seconds without newly received pending evidence, attempt history reconstruction on the 30-second retry cycle. |
| Historical route qualifies | Store timestamped satellite segments; preserve gaps and exclude distance across unobserved intervals. Never fabricate a Home return event. |
| GPS overlaps an existing journey | Deduplicate or merge compatible evidence transactionally. Refuse conflicting timestamps, implausible joins, multiple overlapping journeys or extensions across a confirmed return boundary. |
| Firestore is unavailable | Retain the outbox and evidence for retry. GPS intake does not wait for journey uploads. |
| Gateway restarts | Replay the journal and restore unfinished journey state and pending writes. |
| Qualified Home radio returns with only heartbeats | Close the restored live fragment at its last recorded endpoint, then reconcile delayed historical GPS. |
| SOS or another alarm arrives | Bypass the GPS queue and history persistence dependency. |

This change does not enable the separate Wi-Fi walk-recovery experiment,
supplier fence provisioning, or wellness services. Wi-Fi absence and GPS/V
network estimates still cannot establish travel. The existing 50-metre movement
and conservative saved-zone boundary checks remain in the historical path.

## Storage and operations

`JOURNEY_JOURNAL_ENABLED=true` is the default whenever Firestore is enabled.
`JOURNEY_JOURNAL_DIRECTORY` defaults to `gateway/data/journeys`; a container must
mount that directory on persistent storage. The journal uses checksummed,
fsynced append records, atomic snapshot compaction and a single-writer lock.
Private runtime files are ignored by git. Do not delete the directory during an
upgrade or copy a running journal to another active writer.

Processed GPS is retained for seven days. Non-qualifying pending observations
remain available for late corroboration for a week. Outstanding writes are not
discarded. The per-device 25,000-point limit fails explicitly instead of silently
evicting pending evidence. Monitor `[journey-durability]` errors and run:

```powershell
npm run journey:status
```

GPS that the watch never records or never uploads cannot be recovered by the
gateway. Disk loss, full storage, missing source times and incompatible route
overlaps remain explicit operational/review cases; this is not a guarantee of
complete coverage.

## Recover a specific historical window

Run in the configured gateway directory. The existing service account remains
local. The recovery script defaults to read-only preview and accepts original
timestamped evidence from Firestore location history, the local journal, and an
optional device-version capture. It refuses a capture for another device/project
and an overlapping unfinished local journey.

```powershell
$guardianPilotImei = node -e "process.stdout.write(require('./src/config').wifiHomePilotImei)"
node scripts/recover-journey-history.js --imei "$guardianPilotImei" --from 2026-09-14T14:00:00Z --to 2026-09-14T15:13:00Z --capture data/journey-recovery/capture.json
```

Inspect the preview, then repeat with `--apply` to write qualified history.
Repeating an applied recovery is idempotent. Current device location, alerts and
watch commands are not changed. A changed polyline invalidates its previous
Google presentation; the existing app renders the recorded GPS route.

`capture-journey-versions.js` performs bounded, read-only historical document
reads and saves their original observation times. Recent-version availability
depends on Firestore retention; it is not an ongoing replacement for the journal.

## Validation

Gateway regressions cover delayed/out-of-order/duplicate GPS, stationary Home
noise, future or conflicting times, jumps, original-time Home priority, missing
route intervals, crash replay, partial writes, checksums, compaction, exclusive
writers, restart closure, failed-write retries and automatic historical recovery.
The real event dispatcher is exercised with durability enabled, including
current-map protection and SOS independence. Firestore emulator tests exercise
concurrent recovery transactions, stored timestamp types, caregiver readability,
idempotency and denial of client writes/recovery-lock access.

Physical acceptance remains: apply the reviewed capture, confirm the trip and its
gap in the app, then verify the updated gateway across an outing and restart.
