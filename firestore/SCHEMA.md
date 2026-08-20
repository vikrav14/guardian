# Guardian Firestore Schema

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
| emergencyContacts | array | `{ name, phone, whatsapp? }` |
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
| lastAlarm | map \| null | `{ type, at, raw }` |
| intelligence | map \| null | Gateway-owned rule-based insights — `{ updatedAt, insights[], topInsight }`. Each insight: `{ id, facts[], inference, confidence (0–100), level ('info'\|'warning'\|'urgent'), suppressBelow }`. |
| firmware | string \| null | |
| fallDetection | map \| null | App-cached V52 request, not confirmed device state (no read-back command exists): `{ enabled, dialMonitorOnFall, sensitivityLevel }`. |
| locationReportingIntervalSeconds | number \| null | App-cached V52 request, not confirmed device state (no read-back command exists). Standing GPS-fix upload interval last sent to the pendant via `UPLOAD,<seconds>`. |
| createdAt | timestamp | |
| updatedAt | timestamp | |

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

## `devices/{imei}/locations/{locationId}`

Optional history (gateway throttles writes — see write gate below).

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
| distanceKm | number | Path length along buffered GPS points |
| polyline | string | Google encoded polyline (precision 5) |
| events | array | Optional inline events, e.g. `{ type: 'geofence_exit', geofenceId, name, at }` |
| pointCount | number | Raw GPS fixes in buffer before compression |
| compressed | boolean | Always `true` for gateway-written docs |
| closeReason | string | Current reasons include `return_to_origin`, `idle`, and `daily_boundary`; `disconnect` may exist on legacy documents only |
| observationAudit | map | Aggregate counts for approximate packets, resolution and acceptance outcomes |
| diagnosticEvents | array | Bounded timestamp-offset timeline of connection, heartbeat, location, fallback, recovery-probe and reporting-policy evidence used by the read-only gap investigator |
| createdAt | timestamp | Write time |

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
| resolved | boolean | Default false |
| resolvedAt | timestamp \| null | |
| notifyStatus | string \| null | `pending` \| `sending` \| `accepted` \| `partial` \| `sent` \| `delivered` \| `failed` \| `skipped`; `accepted` means provider acceptance, not handset delivery |
| notifyDispatch | map \| null | Bounded push count, Meta status and notification-log ID |
| notifyDeliveryUpdatedAt | timestamp \| null | Latest signed provider status update |
| notifiedAt | timestamp \| null | |
| createdAt | timestamp | |

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
| type | string | `set_center_number` \| `set_sos_number` \| `check_status` \| `voice_monitor` \| `ring_to_find` \| `set_fall_detection` \| `set_fall_sensitivity` \| `set_medication_reminder` \| `set_upload_interval`; V52 transport support varies by command and live-session state |
| params | map | Command-specific, e.g. `{ phone }`, `{ slot, phone }`, `{ enabled, dialMonitorOnFall }`, `{ level }`, `{ time, frequency, week, text }`, `{ seconds }` |
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

The gateway keeps a full in-memory GPS stream and writes to Firestore only on meaningful events (Phase 0.5 write gate):

| Trigger | Firestore action |
|---------|------------------|
| Moved ≥ `WRITE_GATE_MIN_METRES` (default 50 m) from last persisted location | Upsert `devices/{imei}.location`; optional history |
| Battery integer change | Upsert `batteryPercent` and its independent receipt timestamp. |
| Persisted V52 heartbeat/location/alarm | Store validated latest cellular signal and raw activity counters without creating extra history writes. |
| SOS / fall / low_battery / geofence enter/exit | Always upsert + alert |
| Heartbeat cap (`WRITE_GATE_HEARTBEAT_MINUTES`, default 5 min) while stationary | Upsert `lastHeartbeatAt`, `online` |
| First GPS fix after TCP connect | Always upsert location |
| Dwell ≥ `DWELL_MIN_MINUTES` (default 10 min) stationary | Write `devices/{imei}/segments/{id}` |
| Active journey closes (idle / geofence exit / day boundary / disconnect) | Write `devices/{imei}/journeys/{id}` (compressed polyline) |
| Login / disconnect | Upsert `online` status; flush dwell + open journey on disconnect |

Geofence evaluation and safety alerts run on **every** valid in-memory GPS fix, even when Firestore writes are skipped. `intelligence` refreshes only on persist or alarm (not every GPS tick).

| GT06 event | Firestore action |
|------------|------------------|
| Login | Upsert `devices/{imei}` (`online: true`) |
| Heartbeat / status | Write gate: battery change or heartbeat cap → update device + refresh `intelligence` |
| GPS / location | Write gate on device doc; journey buffer in memory; location history only on alarm / geofence / first fix / history interval; refresh `intelligence` only on persist |
| Periodic check | Refresh `intelligence` for online devices; create `offline` alert when heartbeat gap exceeds threshold (cooldown applies) |
| SOS / fall / alarm | Always persist + create `alerts/{id}` + notify contacts |
| Disconnect | Flush dwell segment; set `online: false` |

## Security (summary)

- Clients authenticate with Firebase Auth.
- Guardians may **read** `devices` / `alerts` / `geofences` / `medicationReminders` only when `imei` is in `users/{uid}.linkedImeis`.
- Guardians may identify wearers (`nickname`, `relationship`, `avatarUrl`, legacy `name`), write geofences and medication reminders, and resolve alerts for linked devices.
- Wearer photos live in Firebase Storage at `deviceAvatars/{imei}/avatar`; Storage rules restrict access to signed-in guardians linked to that IMEI and enforce image content under 5 MB.
- Gateway uses **Admin SDK** (bypasses rules). See [rules.example](rules.example).
