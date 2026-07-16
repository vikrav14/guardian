# Guardian Firestore Schema

Collections used by the GT06 gateway and (later) the Flutter app.

## `users/{uid}`

Firebase Auth UID as document ID.

| Field | Type | Notes |
|-------|------|-------|
| displayName | string | |
| email | string | |
| phone | string | E.164 preferred |
| role | string | `guardian` \| `admin` |
| linkedImeis | string[] | Devices this user may view/control |
| emergencyContacts | array | `{ name, phone, whatsapp? }` |
| createdAt | timestamp | |
| updatedAt | timestamp | |

## `devices/{imei}`

Live device state. Document ID = device IMEI (digits only).

| Field | Type | Notes |
|-------|------|-------|
| imei | string | Same as doc id |
| name | string | Friendly label (e.g. "Dad's pendant") |
| online | boolean | True while TCP session active / recent heartbeat |
| lastHeartbeatAt | timestamp | |
| batteryPercent | number \| null | 0–100 when known |
| speedKmh | number \| null | |
| course | number \| null | Degrees |
| location | map | See below |
| accuracySource | string \| null | `gps` \| `wifi` \| `lbs` |
| lastAlarm | map \| null | `{ type, at, raw }` |
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

Optional history (gateway may throttle writes).

| Field | Type |
|-------|------|
| lat | number |
| lng | number |
| speedKmh | number \| null |
| accuracySource | string \| null |
| recordedAt | timestamp |

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
| createdAt | timestamp | |

## Gateway write map

| GT06 event | Firestore action |
|------------|------------------|
| Login | Upsert `devices/{imei}` (`online: true`) |
| GPS / location | Update `devices/{imei}.location`, `accuracySource`, `speedKmh` |
| Heartbeat / status | Update `lastHeartbeatAt`, `batteryPercent`, `online: true` |
| SOS / fall / alarm | Create `alerts/{id}` + set `devices/{imei}.lastAlarm` |
| Disconnect | Set `online: false` (best-effort) |

## Security (summary)

- Clients authenticate with Firebase Auth.
- Guardians may **read** `devices` / `alerts` / `geofences` only when `imei` is in `users/{uid}.linkedImeis`.
- Guardians may **write** geofences and resolve alerts for linked devices.
- Gateway uses **Admin SDK** (bypasses rules). See [rules.example](rules.example).
