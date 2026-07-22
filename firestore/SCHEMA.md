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
| subscription | map \| null | `{ tier: 'free'\|'premium', status, renewsAt }` — entitlement display only; no payment provider is wired up, so this is client-writable today. Move ownership to a backend (Cloud Function / webhook from whatever payment provider is chosen) once real billing exists, the same way `devices` telemetry is gateway-owned. |
| emergencyContacts | array | `{ name, phone, whatsapp? }` |
| familyMembers | array | `{ uid, displayName, email? }` guardians who shared access |
| createdAt | timestamp | |
| updatedAt | timestamp | |

## `invites/{inviteId}`

Family invite codes.

| Field | Type | Notes |
|-------|------|-------|
| code | string | 6-char share code |
| createdBy | string | uid |
| createdByName | string | |
| createdByEmail | string \| null | |
| linkedImeis | string[] | Snapshot of inviter devices at create time |
| status | string | `pending` \| `accepted` \| `revoked` |
| acceptedBy | string \| null | |
| acceptedByName | string \| null | |
| acceptedAt | timestamp \| null | |
| createdAt | timestamp | |
| expiresAt | timestamp | |

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
| location | map | See below |
| accuracySource | string \| null | `gps` \| `wifi` \| `lbs` |
| lastAlarm | map \| null | `{ type, at, raw }` |
| intelligence | map \| null | Gateway-owned rule-based insights — `{ updatedAt, insights[], topInsight }`. Each insight: `{ id, facts[], inference, confidence (0–100), level ('info'\|'warning'\|'urgent'), suppressBelow }`. |
| firmware | string \| null | |
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

## `devices/{imei}/locations/{locationId}`

Optional history (gateway throttles writes — see write gate below).

| Field | Type |
|-------|------|
| lat | number |
| lng | number |
| speedKmh | number \| null |
| accuracySource | string \| null |
| recordedAt | timestamp |

History is appended only when the gateway write gate passes (same rules as device doc location updates, or when history interval elapses on a heartbeat-cap persist).

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

App-originated downlink commands the gateway sends to the pendant by SMS (see `gateway/src/commands.js`).

| Field | Type | Notes |
|-------|------|-------|
| imei | string | Target device |
| type | string | `set_center_number` \| `set_sos_number` \| `check_status` \| `voice_monitor` \| `ring_to_find` (last two unverified against this exact device -- see commands.js) |
| params | map | Command-specific, e.g. `{ phone }` or `{ slot, phone }` |
| status | string | `pending` \| `sending` \| `sent` \| `failed` |
| result | map \| null | `{ text, simNumber, result }` once sent |
| error | string \| null | |
| createdBy | string | uid |
| createdAt | timestamp | |
| completedAt | timestamp \| null | |

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
- Guardians may **read** `devices` / `alerts` / `geofences` only when `imei` is in `users/{uid}.linkedImeis`.
- Guardians may identify wearers (`nickname`, `relationship`, `avatarUrl`, legacy `name`), write geofences, and resolve alerts for linked devices.
- Wearer photos live in Firebase Storage at `deviceAvatars/{imei}/avatar`; Storage rules restrict access to signed-in guardians linked to that IMEI and enforce image content under 5 MB.
- Gateway uses **Admin SDK** (bypasses rules). See [rules.example](rules.example).
