# Predictive pilot (experimental, local evaluation only)

This opt-in observer builds on PR #140's managed family access checks. It reads
one explicitly configured owner's watch and selected Home boundary. It writes
only private local files. It is not connected to the Guardian app, gateway
startup, WhatsApp, notifications, watch commands, or model providers.

## What is being evaluated

* **Afternoon Home return window:** the first GPS-confirmed return after noon
  in Mauritius, learned from at least six prior comparable days (weekday or
  weekend) within 56 days. The empirical 10th–90th percentile range receives
  15 minutes of padding. This is a routine baseline, not a live travel ETA.
  Prediction requires fresh GPS showing the watch outside Home, a fresh
  heartbeat, a window under three hours wide and at least 30 minutes lead time.
* **Battery reaching 15%:** a range from recent discharge rates, requiring at
  least four distinct observations over 90 minutes, three distinct levels and
  a five-point drop. Charging/rebounds or gaps over 45 minutes reset learning.
  Forecasts stop at a 12-hour horizon. This never predicts shutdown time.

There is at most one forecast per target per Mauritius day, with no new forecast
while the previous one is pending. Forecasts and their evidence timestamps are
frozen at issue time. Later observations score them separately. No route points
are inferred, no missing journeys are filled, and predictions never become facts.
No training is performed on future outcomes. These are simple statistical
baselines; there are no paid AI calls or language-model explanations in this pilot.

Arrival labels require v3 journey boundary evidence, an anchored departure,
valid GPS on both departure and return, and the configured Home ID. Approximate
Wi-Fi/LBS endpoints, idle closures and incomplete routes are excluded. History
is limited to the latest 120 journeys; a 121st result withholds arrival prediction
because history was truncated. Home boundary changes invalidate old learning.
Sparse history will legitimately produce no forecast.

Battery learning uses `batteryUpdatedAt` only, never heartbeat freshness as a
substitute. Repeated timestamps do not count as new observations. A threshold
crossing is evaluated as an interval between samples: overlapping the prediction
boundary makes the result inconclusive. Charging and missing data are also
inconclusive, not successful predictions. No confirmed return is inconclusive,
not proof that the wearer did not arrive. Arrival history refreshes daily, so
arrival evaluation may lag until the following day.

## Run a bounded pilot

Install gateway dependencies with `npm ci`. Create a private JSON configuration
outside the repository with the following fields (replace placeholders):

```json
{
  "projectId": "your-firebase-project",
  "imei": "000000000000000",
  "uid": "managed-service-owner-uid",
  "ownerUid": "managed-service-owner-uid",
  "homeZoneId": "explicit-home-geofence-document-id",
  "startedAt": "2026-10-08T16:00:00Z",
  "endsAt": "2026-10-22T16:00:00Z",
  "outputDirectory": "C:/private/guardian-predictive-pilot"
}
```

Only the canonical managed owner with active Family/Care AI entitlement and
location/history permissions can run this pilot. Access is checked before and
after every observation; revocation clears locally held samples, forecasts and
history on the next poll. The owner UID must match the config. A changed grant
or Home boundary resets the pilot's learned state. Credentials must belong to
the explicitly configured project. This is an operator CLI, not a client API:
protect service credentials and private output with the host's access controls.

Set `GOOGLE_APPLICATION_CREDENTIALS` to the absolute path of the existing project
service-account file, then run from `gateway/`:

```text
node scripts/predictive-pilot.js --config C:/private/pilot.json --once
node scripts/predictive-pilot.js --config C:/private/pilot.json --watch
```

The first command records one observation and exits; the second repeats every
10 minutes, with a maximum configured duration of 14 days. It must run separately
from the gateway. Stop its process to end early; do not stop the gateway. A lock
prevents two observers sharing the same state. Restart with the same config and
output directory to preserve learning and read reservations. Never delete state
to reset a budget. A corrupt or mismatched state fails closed. A stale lock is
released only after confirming its PID no longer exists.

The laptop and internet must be available. This observer does not install a
Windows startup task, survive shutdown, or recover battery readings that arrived
while it was off. It logs observation gaps. After restart, the JSON/text report's
last successful observation exposes freshness. Private files contain behavioral
timestamps and battery levels: keep them local and remove when evaluation ends.
No coordinates, wearer names, IMEIs or UIDs are included in the report/state;
the separate private configuration contains the watch/owner IDs.

## Cost and evaluation

There are **zero paid model calls**. Each poll reserves up to four document reads;
once per Mauritius day the journey query pessimistically reserves 121 more.
At a 10-minute interval, a normal full day reserves at most **697 document reads**.
The hard cap is **800 reserved reads per Mauritius day**, persisted before each
network request, including failed requests. A 14-day interval can touch 15
calendar dates; the absolute cap is therefore 12,000 reservations. Reservations
are a conservative application control, not a Firebase bill or universal cloud
cost guarantee. Existing Firestore, network and storage pricing still applies;
no exact rupee figure or free-tier guarantee is claimed. Setup reads are outside
the observer budget. No external routing, Maps or geocoding API is used.

`report.txt` and `report.json` show withheld reasons, eligible history, sample
counts, issued/pending/scored/inconclusive outcomes, window hit rate among scored
outcomes, arrival error, read reservations and observation freshness. `state.json`
is the restart checkpoint. Check that freshness advances while the process is
running. Do not interpret unit-test performance as real-world accuracy.

Review after 14 days: report coverage, typical interval width, lead time, all
inconclusive cases and actual scored results. Require at least ten scored
forecasts per target across multiple discharge cycles/outing days before even
considering an alerting trial. This minimum is a review gate, not proof of
reliability. If evidence is insufficient, leave predictions withheld and decide
whether to run a separately authorized longer evaluation. User-facing alerts,
paid models and a hosted worker require a separate product decision.
