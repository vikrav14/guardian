# Guardian Firestore Schema

## Wellness edition access — 14 September 2026

`activityDays.lastObservedAt` and `wellbeingReadings.observedAt` queries must be
bounded by Mauritius calendar timestamps: Essential today, Family today plus six
previous days, and Care selected retained periods. The caller must have a trusted
active subscription and linked device. Wellbeing readings additionally require an
active Care plan and current backend-managed wearer consent. Activity is available
to every active edition. There is no expiring viewer grant or client-side pilot
flag. No client writes or automatic TTL policy are introduced.


Collections used by the GT06 gateway and (later) the Flutter app.

## `users/{uid}`

Firebase Auth UID as document ID.

| Field | Type | Notes |
|-------|------|-------|
| displayName | string | |
| email | string | |
| phone | string | E.164 preferred |
| avatarUrl | string \| null | Firebase Storage download URL for the guardian's profile photo (`guardianAvatars/{uid}/avatar`) |
| role | string | `guardian` \| `admin` |
| linkedImeis | string[] | Devices this user may view/control |
| fcmTokens | string[] | FCM registration tokens for this user's app installs (push alerts) |
| subscription | map \| null | **Deprecated and untrusted.** Legacy `{ tier: 'free'\|'premium', ... }` display data. It must never grant service access. |
| serviceOwnerUid | string | UID whose authoritative Guardian plan this account inherits. Defaults to the same UID for the purchaser. A family relationship must also be verified on the owner's record. |
| memberUids | string[] | Backend-managed normalized family membership used to verify plan inheritance. Keep a display copy in `familyMembers`, but never authorize from that legacy field. |
| emergencyContacts | array | `{ name, phone, whatsapp?, isPrimary? }`; exactly one primary is preferred, with the first valid contact as the legacy fallback |
| familyMembers | array | Backend-managed display list `{ uid, displayName, email? }`; never use it for authorization. |
| createdAt | timestamp | |
| updatedAt | timestamp | |

## `serviceSubscriptions/{serviceOwnerUid}`

Backend-owned source of truth for plan access. Client SDKs may read an applicable record but may never create, update or delete it.

| Field | Type | Notes |
|-------|------|-------|
| version | number | Must be `1`; other/missing versions fail closed. |
| managedBy | string | `guardian_admin` \| `billing` \| `migration`; legacy/client values fail closed. |
| plan | string | `essential` \| `family` \| `care`. Plans inherit upward. |
| status | string | `active` \| `trialing` \| `grace_period` \| `past_due` \| `cancelled`. |
| currentPeriodEnd | timestamp \| null | Optional active boundary; required future boundary for cancelled access. |
| trialEndsAt | timestamp \| null | Required future boundary for trialing access. |
| graceEndsAt | timestamp \| null | Required future boundary for grace/past-due access. |
| updatedAt | timestamp | Backend write time. |

Canonical capabilities and limits are documented in `docs/GUARDIAN_SERVICE_PROMISE_MATRIX.md` and implemented by `gateway/src/entitlements.js`.

## `invites/{code}`

Backend-consumed family invitations. The six-character code is also the
document id so a collision cannot overwrite an existing invitation. Only the
creator may read or delete an invitation; joining clients submit the code to a
separate request and never read or mutate the invitation directly.

| Field | Type | Notes |
|-------|------|-------|
| code | string | 6-char share code |
| createdBy | string | uid |
| createdByName | string | |
| createdByEmail | string \| null | |
| status | string | `pending` \| `accepted` \| `revoked` |
| acceptedBy | string \| null | |
| acceptedByName | string \| null | |
| acceptedAt | timestamp \| null | |
| createdAt | timestamp | |
| expiresAt | timestamp | |

## `familyJoinRequests/{requestId}`

Client-created request for the gateway to verify and complete a family join.
The client may create and read its own request but may never mark it accepted.

| Field | Type | Notes |
|-------|------|-------|
| inviteCode | string | Six-character code supplied by the joining guardian. |
| requestedBy | string | Must equal the authenticated UID that created the request. |
| status | string | Client creates `pending`; gateway writes `accepted` or `rejected`. |
| ownerUid | string \| null | Gateway-verified service owner after processing. |
| inviteId | string \| null | Matched invitation id after processing. |
| reason | string \| null | Deterministic rejection reason. |
| createdAt | timestamp | Client server timestamp. |
| processedAt | timestamp \| null | Gateway completion timestamp. |

On acceptance, one Admin SDK transaction updates the owner's `memberUids`,
both `familyMembers` display lists, the joiner's `serviceOwnerUid` and the
owner's current linked watches, the invitation, and the request. Invitation
payloads are never used as device authorization. The active plan's caregiver
limit is re-evaluated inside that transaction.

Only an active, verified service owner below the plan caregiver limit may
create an invite. Family members can submit a join code but cannot mint new
family authority or invitations on the owner's behalf.

## `devices/{imei}`

Live device state. Document ID = device IMEI (digits only).

| Field | Type | Notes |
|-------|------|-------|
| imei | string | Same as doc id |
| nickname | string \| null | Preferred dashboard name (e.g. "Mimi"); takes priority over relationship |
| relationship | string \| null | Guardian's relationship to the wearer (e.g. "Mum", "Dad", "Grandad") |
| name | string | Legacy friendly label; retained for backwards compatibility |
| avatarUrl | string \| null | Firebase Storage download URL for the wearer's photo (`deviceAvatars/{imei}/avatar`) |
| simNumber | string \| null | Pendant's own SIM phone number (E.164) — used for calls and SMS commands |
| online | boolean | True while TCP session active / recent heartbeat |
| lastHeartbeatAt | timestamp | |
| batteryPercent | number \| null | 0–100 when known |
| batteryUpdatedAt | timestamp \| null | Gateway receipt time of the packet that supplied `batteryPercent`. |
| cellularSignalPercent | number \| null | V52 GSM/cellular signal field, 0–100. This is measured telemetry and is never inferred from `online`. |
| cellularSignalUpdatedAt | timestamp \| null | Gateway receipt time of the packet that supplied `cellularSignalPercent`. |
| stepsRaw | number \| null | Latest raw V52 step counter. Reset/day semantics are not yet accepted; do not present as a daily total. |
| rollCountRaw | number \| null | Latest raw V52 roll counter, retained for diagnostics only until its semantics are accepted. |
| activityUpdatedAt | timestamp \| null | Gateway receipt time of the packet that supplied either raw activity counter. |
| telemetryUpdatedAt | timestamp \| null | Gateway receipt time of the latest packet containing any validated V52 telemetry. |
| speedKmh | number \| null | |
| course | number \| null | Degrees |
| location | map | Latest persisted observation of any source. See below. Never interpret this field without its source and timestamp. |
| accuracySource | string \| null | Legacy top-level mirror of the latest observation source: `gps` \| `wifi` \| `lbs`. |
| lastLocationObservation | map | Self-contained copy of the latest persisted observation, including source, validity, radius and time. |
| lastSatelliteLocation | map \| null | Most recent valid `gps=A` satellite fix. Retained when the watch later reports an indoor `gps=V` fallback. |
| lastApproximateLocation | map \| null | Most recent WiFi/cell-derived observation and its estimated radius. Never overwrites `lastSatelliteLocation`. |
| homeWifiPresence | map \| null | Backend-owned, expiring private Home display evidence. Linked readers only; clients cannot create, change or delete it. See below. |
| lastAlarm | map \| null | `{ type, at, raw }` |
| intelligence | map \| null | Gateway-owned rule-based insights — `{ updatedAt, insights[], topInsight }`. Each insight: `{ id, facts[], inference, confidence (0–100), level ('info'\|'warning'\|'urgent'), suppressBelow }`. |
| firmware | string \| null | |
| fallDetection | map \| null | App-cached V52 request, not confirmed device state (no read-back command exists): `{ enabled, dialMonitorOnFall, sensitivityLevel }`. |
| watchAlertProfile | string \| null | App-cached V52 request, not confirmed device state: `sound` \| `sound_and_vibration` \| `vibration` \| `silent`. The global scene affects medication reminders and other watch alerts. |
| locationReportingIntervalSeconds | number \| null | App-cached V52 request, not confirmed device state (no read-back command exists). Standing GPS-fix upload interval last sent to the pendant via `UPLOAD,<seconds>`. |
| createdAt | timestamp | |
| updatedAt | timestamp | |

The raw `stepsRaw` and `rollCountRaw` fields are diagnostic counters, not
customer activity totals. Accepted daily totals are stored separately under
`activityDays` so Family/Care rules can fail closed without placing a total on
the broadly readable device document.
### `lastHomeWifiDetection` (map) — historical Home display

Backend-owned qualified Home detection, stored atomically alongside a fresh v4
`homeWifiPresence`. Linked readers can read it; the existing client update allowlist
prevents creating, changing or deleting it. It grants no current presence,
tracking priority, geofence transition, alert suppression or SOS location authority.

- `version: 1`, `policy: "last_detected_home_v1"`, `source: "home_wifi"`.
- `observedAt`: original qualified radio source timestamp; never refreshed by heartbeats.
- `qualifiedUntil`: the original valid publication deadline, greater than `observedAt`
  and at most two minutes later. This documents qualification, not ongoing presence.
- `anchor`: verified saved Home `geofenceId`, `label`, `lat`, `lng`, `radiusMeters`.
- `bindingHash`: SHA-256 of the verified Home/owner binding key. It contains no
  router identifier and is not an authorization token. Startup compares it and
  the exact anchor against the current verified binding before restoring history.

A newer accepted GPS fix takes presentation precedence permanently until another
qualified Home detection occurs. Invalid/future GPS and approximate network
observations cannot renew or supersede history. Ordinary radio expiry retains
history; verified binding changes clear incompatible history. Transient binding
read failures cannot renew fresh presence and do not erase the earlier detection.
The app/chat label is **Last detected at Home · age; current presence unconfirmed**.
Older records lacking this field keep their previous fallback behavior.

### `homeWifiPresence` map — private display pilot

Published only when the operator separately enables the display pilot and the
gateway validates repeated router observations plus one active saved Home zone
owned by a linked Family/Care service owner. This is presentation evidence, not
GPS, a network association, an indoor guarantee or a movement event.

| Field | Type | Notes |
| --- | --- | --- |
| version / policy | number / string | New writes: `4` / `enrolled_home_radio_v4`, with Home-radio priority over GPS A/V. Readers accept cached v1/v2/v3 pairs using their original contracts. Other pairs fail closed. |
| pilot / state / source | boolean / string / string | `true` / `matched` / `home_wifi` for v4. Only cached v3 permits `conflict`. |
| conflictReason | string, legacy v3 conflict only | `gps_outside_home` or `gps_boundary_uncertain`. No arbitrary strings. A conflict preserves fresh router evidence but cannot select the Home pin. |
| observedAt | ISO timestamp string | Last qualifying radio observation's source time; never a heartbeat or display write time. |
| expiresAt | ISO timestamp string | Earlier of the two-minute observation lifetime and the at-most-60-second verified Home/plan binding lease. Consumers reject future source time, expired or oversized leases without needing another database event. |
| anchor | map | `{ geofenceId, label: 'Home', lat, lng, radiusMeters }` from the validated saved Home zone. Positive finite radius is required in v2/v3/v4; absent legacy zone radius defaults to 150 m. No raw BSSID, SSID, router fingerprint, key or password. |

Only the independent pilot publisher writes this field, without refreshing
`updatedAt`, raw location, satellite history, battery, connectivity or incident
snapshots. Invalid radio/binding evidence clears it to `null`.

V4 selects the verified saved Home pin regardless of GPS A/V. The runtime uses
the same fresh, bound evidence to hold GPS-derived dwell, journey and geofence
calculations. It seeds a Home baseline without manufacturing arrival alerts.
An open route is preserved at its last measured endpoint with
`closeReason: home_wifi_detected`; no Home coordinate is inserted. After Home
loss/expiry, a fresh GPS fix newer than the last radio observation is required
to resume movement evaluation. Source switching/expiry alone is not departure.
The first resumed route cannot bridge indoor GPS or a pre-Home anchor.
GPS-based intelligence uses the same priority; ordinary app/WhatsApp source
selection agrees. SOS/fall snapshots keep their independent accepted contract.

Cached v1 keeps newer/equal-GPS precedence; v2 retains spatial agreement. V3
conflicts remain unconfirmed references and cannot silently turn into Home.
Those legacy records never activate v4 tracking priority. Only a new validated
v4 publication changes the policy. GPS/heartbeats cannot renew Home timestamps.
The map anchor denotes saved Home proximity, not measured indoor GPS accuracy.
Binding and ownership are rechecked every 30 seconds; changed/invalid bindings
require new repeated observations. Existing device update allowlists prohibit
client evidence forgery; no Firestore rules expansion is required.

### `location` map

| Field | Type |
|-------|------|
| lat | number |
| lng | number |
| altitude | number \| null |
| recordedAt | timestamp |
| satellites | number \| null |
| source | string \| null | `gps`, `wifi`, or `lbs`. |
| gpsValid | boolean | True only for a protocol `gps=A` satellite fix. |
| accuracyMeters | number \| null | Estimated radius for WiFi/LBS geolocation. Deliberately null for V52 `gps=A`, because the packet proves satellite validity but does not provide a dependable radius. |

`location`, `lastLocationObservation`, `lastSatelliteLocation`, and
`lastApproximateLocation` are complete maps rather than partial merge fragments.
This prevents a WiFi/LBS radius from leaking into a later GPS observation.
During rollout, the gateway performs one compatibility read per device process
before its first new location write so a legacy current GPS location is copied
to `lastSatelliteLocation` before an indoor fallback can replace `location`.

## `wellnessRoutineRequests/{imei}`

Desired daily Wellness times for a linked Care customer. The request is not a
watch command or evidence of a completed measurement. A linked, active Care
subscriber may get, create or replace this one request; list and delete are denied.
Starting Gentle or Balanced also requires current backend-managed wearer
consent. Manual remains available after consent is revoked, while link and plan
checks remain mandatory.

| Field | Type | Notes |
|---|---|---|
| version | number | `2` for editable daily times. |
| routine | string | `manual`, `gentle`, or `balanced`. |
| times | string[] | Exactly 0, 2, or 3 entries respectively. Canonical 24-hour `HH:mm`, ascending and unique, with at least 5 minutes between adjacent slots and between the last slot and the first slot across midnight. |
| timeZone | string | Exactly `Indian/Mauritius`; phone timezone never changes the schedule. |
| requestedBy | string | Must equal the authenticated UID. |
| updatedAt | timestamp | Must be the request's server timestamp (`request.time`). Defines the schedule revision. |

These are the only allowed fields. Rules and gateway validation reject malformed
times, unsorted/duplicate/overlapping slots, other timezones, extra command or
result fields, and forged authority/timestamps. A compatibility request may use
only `{ version: 1, routine: 'manual', requestedBy, updatedAt }` to stop an older
routine. New version-1 Gentle/Balanced writes are denied; existing interval
requests never acquire inferred daily times or restart native intervals.

Daily slots are an application schedule. Saving times does not write a native
watch interval. The gateway rechecks current authorization, operational gates,
request revision, connection, measurement availability, and evidence at the
execution boundary. Missed or blocked slots are skipped without catch-up or
retries. Editing times does not reset the day's attempt count or resurrect a
consumed slot. Manual stops future scheduled checks; it never erases a completed
attempt or implies that an already handed-off watch command was undone.

## `devices/{imei}/wellnessRoutine/current`

Gateway-owned schedule summary. Only the current document is readable by the
linked Care customer; all client writes and collection lists are denied. Consent
revocation does not hide the status needed to request a stop.
No reading values, health classifications, or raw tracker responses belong in
this document.

| Field | Type | Notes |
|---|---|---|
| version | number | `2` for the daily schedule summary. |
| routine, times, timeZone | string, string[], string | Validated current desired schedule; Manual has an empty list. |
| phase, reason | string, string or null | Bounded scheduler state and operational reason; never a claim that a watch measurement succeeded. |
| nextCheckAt | timestamp or null | Next configured future slot, or null for Manual/invalid schedules. Still subject to execution-time checks. |
| lastAttempt | map or null | Latest bounded slot metadata described below, including outcome and reason; contains no reading values. |
| inFlight | boolean | Whether the gateway is awaiting this scheduled sequence's outcome. |
| updatedAt | timestamp | Gateway summary write time. |

Existing native-interval stop/lease bookkeeping may remain in this document
during migration; it is backend-owned operational state. `intervalHours` is
null for daily scheduling. Schedule status, slot outcome and a transport handoff
must never promote device acceptance, wearer confirmation or customer reading
eligibility.

## `devices/{imei}/wellnessScheduleDays/{YYYY-MM-DD}`

Private gateway ledger for one Mauritius calendar day. All client reads, lists,
creates, updates and deletes are denied. The Admin SDK
updates the day and slot claim transactionally before dispatch so restarts,
competing gateway instances, reconnects and schedule edits cannot duplicate a
slot or reset the daily cap.

| Field | Type | Notes |
|---|---|---|
| version | number | `1` for this internal ledger. |
| date | string | Mauritius local day, matching the document ID. |
| attempts | number | Shared count across edits and routine changes. Gentle may claim only below 2 attempts and Balanced only below 3. Slots skipped before an attempt claim do not consume the budget. Every claimed attempt remains consumed, including later preflight failures and ambiguous handoffs. |
| lastAttempt | map | Latest slot metadata, containing no reading values. |
| updatedAt | timestamp | Latest transaction/checkpoint time. |
| expiresAt | timestamp | 30-day retention metadata; no automatic deletion is promised until the corresponding TTL policy is enabled. |

## `devices/{imei}/wellnessScheduleSlots/{YYYY-MM-DD-HHmm}`

Private durable slot claim and outcome. Client access is denied as for the day
ledger. The key is based on local day and configured time, independent of request
revision, so editing or changing routine cannot replay the same slot. The
gateway may copy safe slot metadata into `wellnessRoutine/current.lastAttempt`.

| Field | Type | Notes |
|---|---|---|
| version | number | `1` for the slot ledger. |
| slotId, date, time | string | Stable slot ID, Mauritius day, and canonical `HH:mm`. |
| scheduledAt | timestamp | Exact configured slot time. |
| revision | string | Request `updatedAt` represented as an ISO timestamp. |
| claimedAt, updatedAt | timestamp | Durable claim and latest checkpoint times. |
| phase, outcome | string | Bounded execution/skip state; an optical request handoff is distinct from a measurement result. |
| terminal | boolean | Whether this slot has reached its final scheduler outcome. |
| attemptConsumed | boolean | Whether the slot counts toward the day's cap. Lost/unknown dispatch results are never retried. |
| attemptId | string or null | Internal sequence correlation ID; no raw response or reading value. |
| reason | string or null | Bounded operational skip/block/outcome reason. |
| activeUntil | timestamp or null | Bounded in-flight deadline used to recover an interrupted attempt. |
| startedAt, finishedAt | timestamp, optional | Operational attempt boundaries when known. |
| temperatureRequested | boolean, optional | Whether the conditional temperature stage was requested; never temperature success or a health value. |
| expiresAt | timestamp | 30-day retention metadata, subject to the same TTL policy requirement as the day ledger. |

The gateway also retains `dailyLastAttempt`, `dailyActiveSlot` and
`dailyActiveUntil` in its current routine state for recovery and status. These
fields are not client-writable. A lost response or interrupted process never
creates an automatic retry or invents a successful measurement.

## `devices/{imei}/activityDays/{localDate}`

Gateway-owned daily activity. Linked users with an active edition may read
records within their active Wellness edition window: Essential today, Family
seven local calendar days, Care available retained history. Clients cannot write.

| Field | Type | Notes |
|---|---|---|
| schemaVersion | number | `2` for observed-increase accounting; legacy `daily_reset` records remain version `1`. |
| imei, localDate, timeZone | string | Parent watch, local YYYY-MM-DD and configured IANA timezone. |
| aggregation | string | `observed_delta` for v2. |
| counterMode | string | `unverified`, accepted `observed_delta`, or legacy accepted `daily_reset`. |
| recordedSteps, observedDeltaSteps | number | V2 sum of accepted increases assigned to this day, starting from zero at its first observation. |
| displayable | boolean | True for customer-enabled observed-delta estimates without an anomaly. |
| reportedSteps | number or null | V2 customer projection of recordedSteps; null while disabled or anomalous. |
| firstRaw, lastRaw | number | Observed raw counter values, not daily totals. |
| firstObservedAt, lastObservedAt | timestamp | Receipt interval endpoints. |
| sampleCount | number | Observations represented in persisted accounting; unchanged packets are throttled. |
| resetCount, confirmedResetCount | number | Counter-decrease candidates and confirmed new baselines. No reset total is inferred. |
| anomalyCount, gapCount | number | Implausible increases and observation gaps over 30 minutes. |
| unallocatedSteps | number | Positive increase seen across a day boundary or long gap, recorded on the arrival-day diagnostic but excluded from either daily total. |
| coverage, coverageReasons | string, array | `partial`, with reasons such as monitoring_started, counter_discontinuity or cross_midnight_unallocated. Never proves full-day coverage/inactivity. |
| lastIntervalReason | string | Latest accounting decision. |
| quality | string | V2 unverified or partial; legacy records may contain reset_recovered/anomalous. |
| expiresAt, updatedAt | timestamp | Retention deadline and last persistence. |

## `devices/{imei}/activityState/counter`

Backend-only durable v2 counter baseline. Stores accepted `lastRaw`, `baselineAt`,
`baselineLocalDate`, latest received raw/time/source, last device timestamp where
available, segment number, pending discontinuity, mode and intervalSequence.
One Firestore transaction commits this state, the day and any diagnostic interval.
Receipt/device timestamp replay checks make retry idempotent across gateway
restarts and concurrent instances. This is one bounded document per watch,
retained with the device rather than expiring at a day boundary.

## `devices/{imei}/activityIntervals/{slot}`

Backend-only ring of at most 256 recent diagnostic intervals per watch, with a
seven-day expiry handled by gateway cleanup. Each contains rawBefore/rawAfter,
receipt-time from/to, source/deviceObservedAt when supplied, local dates,
acceptedSteps, unallocatedSteps, segment and reason. Slots may be overwritten;
this is recent diagnostic evidence, not promised complete hourly history.
Unchanged heartbeat history is not written. Daily aggregates have their own
retention and do not disappear when diagnostic intervals expire.

No counter field is copied into current location, journeys, emergency alerts,
active minutes, calories, distance or medical conclusions.

## `devices/{imei}/locations/{locationId}`

Optional history (gateway throttles writes — see write gate below).

## `devices/{imei}/wellbeingReadings/{readingId}`

Short-retention, backend-owned V52 wellbeing estimates. These records are
sensitive. Clients can read them only when linked to the watch, holding an active
Guardian Care subscription and current wearer consent. The app shows transport-
valid unverified values as estimates; wearing is never inferred from a successful
upload.

| Field | Type | Notes |
|-------|------|-------|
| schemaVersion | number | `1` |
| imei | string | Device IMEI |
| metricSet | string | `spo2` \| `heart_rate_blood_pressure` \| `skin_temperature` |
| values | map | Confirmed packet fields only: oxygen, heart/BP, or `skinTemperatureCelsius` for the supported `btemp2` variant. |
| measurementType | string \| null | Vendor oxygen type field, retained without interpretation |
| source | string | `v52_upload` |
| sourceCommand | string | `oxygen` \| `bphrt` \| `btemp2` |
| observedAt | timestamp | Gateway receipt time; the packets do not supply a measurement timestamp |
| receivedAt | timestamp | Same receipt evidence as `observedAt` |
| quality | string | `transport_valid_unverified` \| `device_accepted` |
| deviceMode | string | `unverified` \| `accepted` |
| sourceVariant | string, optional | `1` for the supported `btemp2` response shape. |
| displayable | boolean | True when the gateway customer-data switch is enabled; this does not confirm wearing. |
| expiresAt | timestamp | Retention deadline, 30 days by default |

These values are watch estimates, not medical measurements. No schema field
labels a reading normal, abnormal, safe or unsafe.

## `wellbeingConsents/{imei}`

Backend-only durable wearer-consent authority. Client rules deny every read and
write. Ingestion fails closed unless `version == 1`, `status == granted`,
`managedBy` is trusted, `wearerAcknowledgedAt` exists, and the record is neither
revoked nor expired. The same current-consent predicate gates customer reads;
revocation also deletes the device's retained wellbeing readings.

| Field | Type |
|-------|------|
| lat | number |
| lng | number |
| altitude | number \| null |
| satellites | number \| null |
| speedKmh | number \| null |
| accuracySource | string \| null |
| source | string \| null |
| gpsValid | boolean |
| accuracyMeters | number \| null |
| recordedAt | timestamp |

History is appended only when the gateway write gate passes (same rules as device doc location updates, or when history interval elapses on a heartbeat-cap persist). Client reads are plan-aware: Essential may read only records from the most recent seven rolling days; Family and Care may read retained history subject to the published retention/fair-use policy. Flutter also constrains calendar selection, but Firestore rules are authoritative.

## `devices/{imei}/segments/{segmentId}`

Merged dwell periods for Journey view. Gateway writes when the device stays stationary (< 1 km/h or < 50 m movement) for at least `DWELL_MIN_MINUTES` (default 10).

| Field | Type | Notes |
|-------|------|-------|
| type | string | `dwell` |
| placeName | string \| null | Optional label |
| geofenceId | string \| null | Safe zone id when inside a geofence |
| from | timestamp | Dwell start |
| to | timestamp | Dwell end |
| centerLat | number | Centroid latitude |
| centerLng | number | Centroid longitude |
| createdAt | timestamp | Write time |

## `devices/{imei}/journeys/{journeyId}`

Compressed movement segments for Journey route replay. Gateway accumulates GPS in memory during active travel and writes **one document per closed journey** (polyline-encoded route) instead of hundreds of raw location points.

Closed by an outing boundary such as confirmed return to its origin, an eligible
idle boundary for a journey without a safe-zone origin, or the daily boundary.
A TCP disconnect is diagnostic evidence and does not split an outing.

| Field | Type | Notes |
|-------|------|-------|
| startAt | timestamp | Journey start |
| endAt | timestamp | Journey end |
| distanceKm | number | Sum of consecutive valid GPS edges; excludes Wi-Fi/LBS edges and tracking gaps over five minutes. Older stored totals are recomputed on customer reads. |
| polyline | string | Google encoded polyline (precision 5) |
| events | array | Optional inline events, e.g. `{ type: 'geofence_exit', geofenceId, name, at }` |
| pointCount | number | Raw buffered observations before compression, including approximate observations retained during a GPS journey |
| evidenceVersion | number | Version 3 stores aligned per-point source evidence and route-start anchoring |
| pointEvidence | array | One entry per polyline point: source, gpsValid, offsetMs and optional quality metadata; a network estimate is never valid movement evidence |
| routeStartAnchored | boolean | Whether a safe-zone departure has a retained inside-origin GPS anchor; required for customer-facing confirmed-return outings |
| routeCoverage | map | GPS/approximate counts and tracking gaps; structureReliable is false for mixed-source routes |
| compressed | boolean | Always `true` for gateway-written docs |
| closeReason | string | Current reasons include `return_to_origin`, `idle`, and `daily_boundary`; `disconnect` may exist on legacy documents only |
| observationAudit | map | Aggregate counts for approximate packets, resolution and acceptance outcomes |
| diagnosticEvents | array | Bounded timestamp-offset timeline of connection, heartbeat, location, fallback, recovery-probe and reporting-policy evidence used by the read-only gap investigator |
| createdAt | timestamp | Write time |

Journey creation and boundary confirmation require valid satellite observations.
Provider Wi-Fi/LBS estimates remain observations, even if their estimated radius
lies outside a safe zone. Existing records without at least two valid GPS points
and aligned version-3 source evidence are excluded from customer trip counts,
distance totals and replay selection; raw documents are retained for diagnostics.
The existing minimum-distance and anchored-return rules still apply. See
[`journey-source-validation.md`](../docs/services/journey-source-validation.md).

### `devices/{imei}/journeys/{journeyId}/presentations/google_v1`

Optional, renewable display enrichment. This document never replaces the
parent journey's `polyline`, point evidence, distance, timestamps, safe-zone
boundaries, or stop facts. It may contain Google-aligned GPS sections, purple
Google route estimates between reliable fixes, and nearby-place labels for
detected stops.

| Field | Type | Notes |
|-------|------|-------|
| version | number | Presentation contract version; currently `1` |
| journeyStartAt | timestamp | Duplicated solely for history authorization |
| generatedAt | timestamp | Provider lookup time |
| expiresAt | timestamp | Must be configured as a Firestore TTL field for the `presentations` collection group |
| attribution | string | `Google Maps` |
| segments | array | `{ source: 'gps'|'google', polyline, fromPointIndex, toPointIndex, fromOffsetMs, toOffsetMs, ... }` |
| stopPlaces | array | Expiring `{ stopId, pointStartIndex, pointEndIndex, placeId, label, displayName, primaryType, distanceMeters, provider }` |
| coverage | map | Counts of GPS, Google and unresolved presentation sections |

`expiresAt` is set 28 days after generation, leaving deletion headroom below
Google Maps Platform's 30-day cache limit. Only Place IDs are suitable for
long-term retention; the complete presentation document is therefore removed
by TTL. When missing or expired, Flutter falls back to the parent journey's
unaltered GPS evidence.

## `geofences/{geofenceId}`

| Field | Type | Notes |
|-------|------|-------|
| imei | string | Target device |
| name | string | e.g. "Home" |
| active | boolean | |
| center | map | `{ lat, lng }` |
| radiusMeters | number | |
| wifiSsid | string \| null | Home WiFi safe-zone |
| createdBy | string | uid |
| createdAt | timestamp | |
| updatedAt | timestamp | |

## `alerts/{alertId}`

| Field | Type | Notes |
|-------|------|-------|
| imei | string | |
| type | string | `sos` \| `fall` \| `geofence_exit` \| `geofence_enter` \| `low_battery` \| `offline` \| `other` |
| severity | string | `info` \| `warning` \| `critical` |
| message | string | Human-readable |
| payload | map | Raw / extra fields. V52 fall alerts include immutable `locationSnapshot`; see below. |
| sosLocationSnapshot | map \| null | Backend-only frozen primary/secondary location evidence for physical V52 SOS; see below. |
| resolved | boolean | Default false |
| resolvedAt | timestamp \| null | |
| notifyStatus | string \| null | `pending` \| `sending` \| `accepted` \| `partial` \| `sent` \| `delivered` \| `failed` \| `skipped`; `accepted` means provider acceptance, not handset delivery |
| notifyDispatch | map \| null | Bounded push count, Meta status and notification-log ID |
| notifyDeliveryUpdatedAt | timestamp \| null | Latest signed provider status update |
| notifiedAt | timestamp \| null | |
| createdAt | timestamp | |

### Physical SOS `sosLocationSnapshot`

The gateway captures this top-level field at physical SOS receipt, before
notification work. It is **not** stored in the client-writable `payload` map.
The existing alerts create allowlist rejects this field from clients, and the
update allowlist permits only resolution fields. Read access remains linked
watch access. No rules relaxation or new index is required.

| Field | Type | Notes |
|-------|------|-------|
| version | number | `1` |
| policy | string | `map_retained_satellite_v1` |
| capturedAt | timestamp | Gateway receipt time, not a claim of the exact physical button-press time. |
| state | string | `fresh`, `last_known`, or `unavailable`; retained GPS is always `last_known`. |
| reason | string | Selection/freshness reason, including `retained_satellite` and `source_unconfirmed`. |
| ageSeconds | number \| null | Primary observation age relative to receipt; readers recompute it from the frozen timestamps. |
| retainedSatellite | boolean | The primary pin uses retained satellite evidence rather than the latest approximate observation. |
| location | map \| null | Copied `{ lat, lng, source, gpsValid, accuracyMeters, recordedAt, placeLabel }`. GPS accuracy is null, never inherited from WiFi/LBS. |
| latestObservation | map \| null | Separate copied observation with its own time, source and radius. Can be secondary network evidence. |

The primary pin follows the existing Flutter map's retained-GPS policy, tested
in both languages against `docs/testing/sos-location-selection.json`. Very old
or unknown-age GPS remains historical and explicitly says the current position
is unconfirmed; there is no promise that the wearer is still there. Newer
approximate evidence is retained and disclosed separately. Freshness alone
does not imply positional precision.

Post-receipt coordinates and malformed/null/blank/out-of-range coordinates are
excluded. A missing device observation timestamp stays unknown; completion of
a network geolocation lookup does not invent a timestamp. Body, template state,
map button and notification-log location text use this snapshot. Battery and
connection status may still reflect the notification-time device record.

Legacy/app-created SOS alerts without a valid backend snapshot still notify,
but fail closed to the no-location template. Do not retroactively fill their
location from a newer device document. Existing sent messages are not edited
or resent. Fall snapshot semantics and raw tracking data are unchanged.

See `docs/services/sos-location.md` for the physical QA checklist and limits.

### Fall `payload.locationSnapshot`

The gateway freezes this map when it persists a V52 `fall` alert. Notification
retries and later device movement must read this snapshot, never the mutable
`devices/{imei}.location` value. Legacy fall alerts without a versioned
snapshot are treated as location unavailable.

| Field | Type | Notes |
|-------|------|-------|
| version | number | Currently `1` |
| capturedAt | timestamp | Gateway event time used to classify freshness |
| state | string | `fresh` \| `last_known` \| `unavailable` |
| reason | string \| null | Bounded location-policy reason |
| ageSeconds | number \| null | Age at the event, not at notification retry time |
| retainedSatellite | boolean | True when the existing indoor-retention policy selected the recent satellite fix |
| location | map \| null | Frozen `{ lat, lng, altitude, recordedAt, placeLabel, source, gpsValid, accuracyMeters }`; satellite accuracy remains null when V52 did not supply it |

## `contextNewsEvents/{eventId}`

Observe-only, backend-owned Défi Media RSS facts. Stable source ids and content
hashes make article ingestion restart-safe. Records include `publishedAt`,
`actionableUntil`, classification/place mentions, `firstObservedAt`,
`lastChangedAt`, `observeOnly=true`, and `deliverySent=false`. Clients cannot
write these documents.

## `contextNewsMatches/{matchId}`

Observe-only exposure evidence keyed from source event plus `serviceOwnerUid`.
It combines all `impactedImeis` in the same service family and is created once,
so repeated RSS polls and gateway restarts cannot manufacture a second match.
It records only current-proximity or active-journey-approach evidence;
`deliveryEligible=false` and `deliverySent=false` are mandatory in this phase.

## `deviceCommands/{commandId}`

App-originated V52 commands delivered through the model-supported carrier SMS
configuration path or the live TCP session; see `gateway/src/commands.js`.

| Field | Type | Notes |
|-------|------|-------|
| imei | string | Target device |
| type | string | Client-eligible types: `set_center_number` \| `set_sos_number` \| `check_status` \| `voice_monitor` \| `ring_to_find` \| `set_fall_alarm` \| `set_fall_detection` \| `set_fall_sensitivity` \| `set_medication_reminder` \| `set_watch_alert_profile` \| `set_upload_interval`. Administrator-only `set_alarm_mode` is queued by guarded operator tooling. `set_phonebook_contact` is rejected by Firestore rules and the generic gateway dispatcher; PHBX uses the strict administrator provisioning endpoint. |
| params | map | Command-specific, e.g. `{ phone }`, `{ slot, phone }`, administrator-only `{ mode }`, `{ enabled }` for the separate V52 fall-alert switch, `{ enabled, dialMonitorOnFall }`, `{ level }`, `{ time, frequency, week, text }`, `{ mode: 1..4 }` for the V52 alert scene, `{ seconds }`. Alert modes: `1` sound + vibration, `2` sound, `3` vibration, `4` silent. |
| status | string | `pending` \| `sending` \| `sent` \| `failed` |
| result | map \| null | `{ text, channel, simNumber?, result }` once sent |
| error | string \| null | |
| createdBy | string | uid |
| createdAt | timestamp | |
| completedAt | timestamp \| null | |

## `medicationReminders/{reminderId}`

App-side record of what's been scheduled, since the V52 has no "list my
reminders" query command. This is what the app displays/edits; saving or
deleting also enqueues a matching `deviceCommands` entry
(`set_medication_reminder`) so the watch stays in sync.

| Field | Type | Notes |
|-------|------|-------|
| imei | string | Target device |
| time | string | `HH:MM`, 24-hour |
| frequency | number | `1` (once) \| `2` (daily) \| `3` (weekly) |
| week | string \| null | 7-digit Sun->Sat on/off mask, only when frequency is 3 |
| text | string | Plain reminder text (device stores hex-UTF16 encoded, gateway handles the conversion) |
| enabled | boolean | |
| createdBy | string | uid |
| createdAt | timestamp | |
| updatedAt | timestamp | |
| deviceCommandId | string \| null | Most recent V52 sync command for this reminder. |
| deviceSyncStatus | string | `pending` \| `sent` \| `failed` \| `unknown`; transport status only. |
| deviceSyncError | string \| null | Bounded V52 transport error, if the command failed. |
| deviceSyncedAt | timestamp \| null | Last successful command handoff to the gateway transport. |
| deletedAt | timestamp \| null | Tombstone time; the app hides the reminder while the off command is delivered. |
| lastSentAt | timestamp \| null | Last accepted guardian reminder send, used to prevent duplicate scheduling. |
| deliveryStatus | string | `pending` \| `accepted` \| `sent` \| `delivered` \| `read` \| `failed`; separate from wearer acknowledgement. |
| lastDelivery | map \| null | Meta provider outcome, `wamid`, status timestamps and bounded errors without message contents. |
| lastDeliveryError | string \| null | Bounded operational error. |
| acknowledgementStatus | string | Currently `not_supported`; must not be presented as acknowledged. |

## `notificationLogs/{logId}`

Gateway fan-out audit trail (optional carrier SMS and Meta WhatsApp attempts).

| Field | Type | Notes |
|-------|------|-------|
| imei | string | |
| alertType | string | |
| message | string | |
| contactCount | number | |
| results | array | Per-contact channel results |
| alertId | string \| null | Alert whose fan-out produced this log |
| metaMessageIds | string[] | Meta `wamid` values used to join signed delivery webhooks |
| deliveryStatus | string | Aggregate `not_requested` \| `accepted` \| `partial` \| `delivered` \| `failed` |
| deliverySummary | map | Aggregate Meta accepted/delivered/failed counts |
| deliveryUpdatedAt | timestamp \| null | Latest Meta status timestamp |
| createdAt | timestamp | |

## `metaDeliveryEvents/{eventId}`

Immutable, redacted Meta webhook receipts keyed by a hash of message ID,
status, and provider timestamp. These retain delivery evidence even for a
controlled smoke message that was not created by an alert or reminder.

| Field | Type | Notes |
|-------|------|-------|
| messageId | string | Meta `wamid`; no access token or message body |
| status | string | `sent` \| `delivered` \| `read` \| `failed` \| `deleted` |
| recipientId | string \| null | Meta recipient identifier |
| phoneNumberId | string \| null | Configured Meta sender asset |
| occurredAt | timestamp | Provider event time |
| errors | array | Bounded sanitized provider errors |

## `contextEvents/{eventId}`

Optional gateway-only audit documents for normalized official context facts.
The initial Mauritius CAP integration writes these only when
`CONTEXT_CAP_PERSIST_EVENTS=true`. They are observe-only and cannot themselves
trigger a WhatsApp send. IDs are stable hashes of the source plus the source
alert identifier, so updates merge into the same document.

| Field | Type | Notes |
|-------|------|-------|
| version | number | Normalized source-record version; currently `1` |
| id | string | Stable namespaced event ID, e.g. `mu-mms-en:{identifier}` |
| documentId | string | Stable Firestore-safe hash used as the document ID |
| externalId | string | CAP authority identifier |
| source | map | Bounded `{ id, name, authority, countryCode, feedUrl }` |
| sourceUrl | string | Trusted full CAP document URL |
| status | string | Normalized CAP status; only `actual` is eligible |
| messageType | string | Normalized CAP message type, including `alert`, `update`, `cancel` |
| active | boolean | True only while actual, non-cancelled, effective and unexpired |
| inactiveReason | string \| null | `cancelled`, `cancelled_by_reference`, `superseded_by_update`, `outside_effective_window`, `removed_from_authoritative_feed`, or status reason |
| eventType | string | Guardian-normalized event type, e.g. `heavy_rain`, `cyclone`, `strong_wind` |
| headline | string | Bounded official headline |
| description | string | Bounded official description |
| instruction | string | Bounded official instruction |
| urgency | string | Normalized CAP urgency |
| severity | string | Normalized CAP severity |
| certainty | string | Normalized CAP certainty |
| areas | array | CAP area descriptions, polygons, circles and geocodes |
| sentAt | string \| null | ISO CAP sent time |
| effectiveAt | string \| null | ISO effective/onset time |
| expiresAt | string \| null | ISO expiry; missing expiry fails closed |
| contentHash | string | SHA-256 used for source-level deduplication |
| observedAt | string | ISO time the gateway most recently observed this fact |
| observeOnly | boolean | Always true in this phase |
| deliverySent | boolean | Always false in this phase |

`contextObservations/{observationId}` may optionally contain per-device shadow
decisions when `CONTEXT_PERSIST_OBSERVATIONS=true`. CAP-triggered observations
use source `official_cap_update`, include only bounded alert summaries, and are
idempotent per device/source/hour.

## Gateway write map

### Diagnostic-only `photoTrialImports/{importId}`

Created only by the explicit `gateway/scripts/photo-trial-firebase.js` pilot;
never by gateway startup. Client reads/writes are denied by existing unmatched
path rules. This is separate from production `safetySnapshotRequests` and
does not create a customer-visible photo or satisfy its authorization policy.
The JPEG is a private Storage object, not a Firestore field. No public URL or
download token is recorded. `importId` hashes IMEI, linked requester UID and
image SHA-256 to prevent repeat uploads of the same trial image.

| Field | Type | Meaning |
| --- | --- | --- |
| version | number | `1` |
| imei / protocolId | string | Exact trial device identities |
| requestedBy | string | Verified linked Firebase user UID |
| source | string | `ftp_trial_operator_import` |
| sha256 / bytes / width / height | string / number | Validated JPEG properties |
| validation | string | `pillow_full_decode`; full decode repeated before import |
| receivedAt / importedAt / updatedAt | timestamp | Transfer receipt and processing times; not proven camera capture time |
| consentConfirmed | boolean | Operator confirmed this test-photo import |
| state | string | `uploading`, `stored`, `failed_cleaned`, `cleanup_required`, `deleted` |
| bucket / objectPath | string / nullable string | Private bucket and `privatePhotoTrials/{imei}/{importId}.jpg`; path cleared on deletion |
| generation | string or null | Storage generation for conditional deletion, when known |
| remoteCaptureVerified / requestCorrelationVerified / customerVisible | boolean | Always `false` in this pilot |
| automaticExpiry | boolean | `false`; no TTL or deletion scheduler is installed |
| cleanupRequiredAfterTrial | boolean | Explicit cleanup required; cleared by successful deletion |
| deletedAt | timestamp | Live-object deletion completed or object was already absent |

Deletion keeps the audit record. Storage provider soft-delete/versioning may
retain copies under bucket policy. A failed import records cleanup uncertainty;
it must not be reported as a successful rollback. See
[the trial runbook](../docs/testing/photo-ftp-trial.md).

### Runtime writes

The gateway keeps a full in-memory GPS stream and writes to Firestore only on meaningful events (Phase 0.5 write gate):

| Trigger | Firestore action |
|---------|------------------|
| Moved ≥ `WRITE_GATE_MIN_METRES` (default 50 m) from last persisted location | Upsert `devices/{imei}.location`; optional history |
| Battery integer change | Upsert `batteryPercent` and its independent receipt timestamp. |
| Persisted V52 heartbeat/location/alarm | Store validated latest cellular signal and raw activity counters without creating extra history writes. |
| Passive V52 step observation while activity ingestion is enabled | Upsert one protected local-day `activityDays` document; duplicate counters are throttled and no customer total is exposed in `unverified` mode. |
| SOS / fall / low_battery / geofence enter/exit | Always upsert + alert |
| Heartbeat cap (`WRITE_GATE_HEARTBEAT_MINUTES`, default 5 min) while stationary | Upsert `lastHeartbeatAt`, `online` |
| First GPS fix after TCP connect | Always upsert location |
| Dwell ≥ `DWELL_MIN_MINUTES` (default 10 min) stationary | Write `devices/{imei}/segments/{id}` |
| Active journey closes (idle / geofence exit / day boundary / disconnect) | Write `devices/{imei}/journeys/{id}` (compressed polyline) |
| Login / disconnect | Upsert `online` status; flush dwell; preserve the active outing checkpoint |

Geofence evaluation and safety alerts run on fresh live GPS fixes even when Firestore writes are skipped. Delayed and out-of-order fixes are retained for historical journey recovery and do not create retrospective alerts. `intelligence` refreshes only on persist or alarm (not every GPS tick).

| GT06 event | Firestore action |
|------------|------------------|
| Login | Upsert `devices/{imei}` (`online: true`) |
| Heartbeat / status | Write gate: battery change or heartbeat cap → update device + refresh `intelligence` |
| GPS / location | Durable local GPS evidence and journey checkpoint; write gate on live device doc; optional location-history writes; delayed GPS recovered into journeys using original timestamps |
| Periodic check | Refresh `intelligence` for online devices; create `offline` alert when heartbeat gap exceeds threshold (cooldown applies) |
| SOS / fall / alarm | Always persist + create `alerts/{id}` + notify contacts |
| Disconnect | Flush dwell segment; set `online: false` |

## Security (summary)

`journeyRecoveryLocks/{deviceDayHash}` stores a transaction revision and update
timestamp for idempotent history recovery. It is backend-only; no client rule
grants read or write access. Recovered journeys use the existing caregiver
authorization and history entitlements. Runtime journals are private local files,
not a client-accessible Firestore collection.

- Clients authenticate with Firebase Auth.
- Guardians may **read** `devices` / `alerts` / `geofences` / `medicationReminders` only when `imei` is in `users/{uid}.linkedImeis`.
- Guardians may identify wearers (`nickname`, `relationship`, `avatarUrl`, legacy `name`), write geofences and medication reminders, and resolve alerts for linked devices.
- Wearer photos live in Firebase Storage at `deviceAvatars/{imei}/avatar`; Storage rules restrict access to signed-in guardians linked to that IMEI and enforce image content under 5 MB.
- Gateway uses **Admin SDK** (bypasses rules). See [rules.example](rules.example).


### Wearing quality alongside activity and Wellness

- `devices/{imei}/wearStatus/current`: backend-only writes; safe versioned state,
  reason, exact-device acceptance, observation/expiry and gateway update times.
  Linked members on any active edition may read. Clients must expire status.
  Optional `lastRemovalReportedAt` is the device observation time of the newest
  fresh AL removal report. It survives zero-bit packets, disconnection and
  restart. This is historical event information, never present wearing proof.
- `devices/{imei}/wearChecks/current`: a linked member on any active edition may
  save/read the latest **manual family observation**. Exact fields: `version: 1`,
  `state: worn|removed`, `observedAt` (client timestamp), `recordedAt` (server
  timestamp), `recordedBy` (authenticated UID). An online transaction and rules
  require an observation within 60 seconds of server time and prevent an older
  observation replacing a newer check. No list/delete or additional fields.
  This document never qualifies wearing, activity or Wellness readings.
- `devices/{imei}/wearDiagnostics/current`: backend-only, at most 120 raw status
  samples, running gateway mode. Never expose raw bits through customer rules.
- Activity v2 keeps diagnostic `recordedSteps` and separately aggregates
  `wearQualifiedSteps`, `wearExcludedSteps`, `lastWearQualifiedAt` and
  `wearQualityVersion: 1`. Customer `reportedSteps` is qualified partial coverage;
  raw-counter receipt times do not refresh the accepted total's age.
- New wellbeing records include `wearQualityVersion: 1`, receipt-time
  `wearEvidence`, `wearQualified`, `wearReason`, and
  `timeBasis: gateway_receipt_not_measurement_time`. `displayable` additionally
  requires eligible wearing proof. Missing evidence stays private. Historical
  diagnostic records are not retroactively made qualified.


### Live Safety snapshot path (25 September 2026)

The app now uses authenticated `/api/safety-snapshots` gateway routes. It does
not enqueue the historical backend-only `safetySnapshotRequests` workflow.
That watcher is no longer started by the reminder scheduler.

- `safetySnapshotAuthorizations/{UUID}`: server-owned request, requester,
  service owner, IMEI, explicit consent/purpose, `state` (`dispatching`,
  `waiting_for_image`, `receiving`, `available`, `failed`, `deleted`, `expired`),
  two-minute authorization deadline and 24-hour media access deadline.
- `safetySnapshotDeviceLocks/{imei}`: server-only last request time and request
  ID. A Firestore transaction serializes all guardians/gateway workers and
  enforces a durable per-watch 15-minute cooldown.
- `safetySnapshotAudit/{UUID}` is immutable creation evidence. Its backend-only
  `events` subcollection records command handoff, receipt, view and deletion.
- `mediaPath` is a deterministic private Storage key:
  `privateSafetySnapshots/{serviceOwnerUid}/{imei}/{UUID}.jpg`. No Firebase
  download token or public URL is created. Direct client Storage access is
  denied; the gateway verifies current membership/plan for each image request.
- Receipt metadata includes byte size, dimensions, SHA-256, raw device timestamp,
  `validation: full_pixel_decode`, `correlation: same_session_request_window`
  and `requestCorrelationVerified: false`. `receivedAt` is gateway time, not a
  verified capture timestamp. There is no verified on-wire request identifier.
- Optional `receiveDiagnostics` (version 1) accompanies terminal receive states:
  fixed-size traffic/frame/rejection counters, relative arrival times, buffered
  byte counts, image-header flags and a fixed failure-stage label. It contains
  no raw frames, image data or credentials, and is not exposed in the app HTTP
  list. Packet observation is in memory only; no per-packet Firestore writes.
  Missing diagnostics (older requests or a restarted gateway) mean unavailable
  evidence, not zero traffic. See `docs/testing/photo-app-trial.md` for fields.
  Decoder failures additionally carry a fixed `decodeError`, numeric/boolean
  `decodeDetails`, and a `rejectedFrameCapture` outcome. The optional rejected
  frame is an operator-selected local diagnostic file, never a Firestore field
  or public Storage object, and is not managed by app media-expiry cleanup.
- `cleanupPending` and `uploadLeaseUntil` retain interrupted/deferred deletion
  work. The gateway denies expired/deleted access immediately, then deletes
  objects while running and after restart. It never resends capture commands.
- Composite indexes cover the owner/device gallery and bounded timeout/expiry
  sweeps. Images and raw protocol frames are never Firestore document fields.
