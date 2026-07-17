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
| fcmTokens | string[] | FCM registration tokens for this user's app installs (push alerts) |
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
| notifyStatus | string \| null | `pending` \| `sending` \| `sent` \| `failed` \| `skipped` |
| notifiedAt | timestamp \| null | |
| createdAt | timestamp | |

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

| GT06 event | Firestore action |
|------------|------------------|
| Login | Upsert `devices/{imei}` (`online: true`) |
| GPS / location | Update `devices/{imei}.location`, evaluate **Firestore geofences**, create enter/exit alerts |
| Heartbeat / status | Update `lastHeartbeatAt`, `batteryPercent`, `online: true` |
| SOS / fall / alarm | Create `alerts/{id}` + set `devices/{imei}.lastAlarm` + notify contacts |
| Disconnect | Set `online: false` (best-effort) |

## Security (summary)

- Clients authenticate with Firebase Auth.
- Guardians may **read** `devices` / `alerts` / `geofences` only when `imei` is in `users/{uid}.linkedImeis`.
- Guardians may **rename** devices (`name`), write geofences, and resolve alerts for linked devices.
- Gateway uses **Admin SDK** (bypasses rules). See [rules.example](rules.example).
