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
| fallDetection | map \| null | App-cached request, not confirmed device state (no read-back command exists): `{ enabled, dialMonitorOnFall, sensitivityLevel }`. V46/V48/V52 only. |
| locationReportingIntervalSeconds | number \| null | App-cached request, not confirmed device state (no read-back command exists). Standing GPS-fix upload interval last sent to the pendant via `UPLOAD,<seconds>`. V46/V48/V52 only. |
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

Closed when: geofence exit, idle ≥ `JOURNEY_IDLE_MINUTES` (default 15) after last movement, daily boundary (midnight), or TCP disconnect.

| Field | Type | Notes |
|-------|------|-------|
| startAt | timestamp | Journey start |
| endAt | timestamp | Journey end |
| distanceKm | number | Path length along buffered GPS points |
| polyline | string | Google encoded polyline (precision 5) |
| events | array | Optional inline events, e.g. `{ type: 'geofence_exit', geofenceId, name, at }` |
| pointCount | number | Raw GPS fixes in buffer before compression |
| compressed | boolean | Always `true` for gateway-written docs |
| closeReason | string | `idle` \| `geofence_exit` \| `daily_boundary` \| `disconnect` |
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
| payload | map | Raw / extra fields |
| resolved | boolean | Default false |
| resolvedAt | timestamp \| null | |
| notifyStatus | string \| null | `pending` \| `sending` \| `sent` \| `failed` \| `skipped` |
| notifiedAt | timestamp \| null | |
| createdAt | timestamp | |

## `deviceCommands/{commandId}`

App-originated downlink commands the gateway delivers to the pendant, either by SMS (V28C) or over the live TCP session (V46/V48/V52 -- no SMS equivalent exists for these; see `gateway/src/commands.js`).

| Field | Type | Notes |
|-------|------|-------|
| imei | string | Target device |
| type | string | `set_center_number` \| `set_sos_number` \| `check_status` \| `voice_monitor` \| `ring_to_find` (SMS; last two unverified against V28C specifically) \| `set_fall_detection` \| `set_fall_sensitivity` \| `set_medication_reminder` \| `set_upload_interval` (TCP downlink, V46/V48/V52 only -- requires a live session) |
| params | map | Command-specific, e.g. `{ phone }`, `{ slot, phone }`, `{ enabled, dialMonitorOnFall }`, `{ level }`, `{ time, frequency, week, text }`, `{ seconds }` |
| status | string | `pending` \| `sending` \| `sent` \| `failed` |
| result | map \| null | `{ text, channel, simNumber?, result }` once sent |
| error | string \| null | |
| createdBy | string | uid |
| createdAt | timestamp | |
| completedAt | timestamp \| null | |

## `medicationReminders/{reminderId}`

App-side record of what's been scheduled, since the device has no "list my reminders" query command -- this is what the app displays/edits; saving or deleting also enqueues a matching `deviceCommands` entry (`set_medication_reminder`) so the pendant itself stays in sync. V46/V48/V52 only.

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
| lastSentAt | timestamp \| null | Last successful guardian reminder delivery. |
| deliveryStatus | string | `pending` \| `sent` \| `failed`; channel delivery, not wearer acknowledgement. |
| lastDelivery | map \| null | Last channel/provider outcome without message contents. |
| lastDeliveryError | string \| null | Bounded operational error. |
| acknowledgementStatus | string | Currently `not_supported`; must not be presented as acknowledged. |

## `notificationLogs/{logId}`

Gateway fan-out audit trail (SMS/WhatsApp attempts).

| Field | Type | Notes |
|-------|------|-------|
| imei | string | |
| alertType | string | |
| message | string | |
| contactCount | number | |
| results | array | Per-contact channel results |
| createdAt | timestamp | |

## Gateway write map

The gateway keeps a full in-memory GPS stream and writes to Firestore only on meaningful events (Phase 0.5 write gate):

| Trigger | Firestore action |
|---------|------------------|
| Moved ≥ `WRITE_GATE_MIN_METRES` (default 50 m) from last persisted location | Upsert `devices/{imei}.location`; optional history |
| Battery integer change | Upsert `batteryPercent` |
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
