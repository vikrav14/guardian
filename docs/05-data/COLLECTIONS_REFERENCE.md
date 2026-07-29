# Firestore Collections Reference

**Last updated**: 2026-07-29

Complete reference for every Firestore collection used by Guardian. Each collection entry includes field definitions, example documents, security rules, and creation/update lifecycle.

**Source of truth**: This document is derived from `firestore/SCHEMA.md` and `firestore/rules.example`. If schema or rules change, update this reference.

---

## Table of Contents

1. [users/{uid}](#usersuid) — Guardian profiles and access control
2. [devices/{imei}](#devicesimei) — Live device state and telemetry
3. [devices/{imei}/locations/{locationId}](#devicesimeicationslocationsid) — Location history
4. [devices/{imei}/segments/{segmentId}](#devicesimeisegmentssegmentid) — Dwell periods (journey view)
5. [devices/{imei}/journeys/{journeyId}](#devicesimeijourneysjourneyid) — Movement routes (encoded)
6. [geofences/{geofenceId}](#geofencesgeofenceid) — Safe zones (GPS + WiFi)
7. [alerts/{alertId}](#alertsalertid) — Events: SOS, fall, geofence, offline
8. [deviceCommands/{commandId}](#devicecommandcommandid) — App→device downlink queue
9. [medicationReminders/{reminderId}](#medicationremindersreminderid) — Device-synced reminders
10. [invites/{inviteId}](#invitesinviteid) — Family access sharing
11. [notificationLogs/{logId}](#notificationlogslogid) — SMS/WhatsApp audit trail

---

## users/{uid}

**Document ID**: Firebase Auth UID

### Purpose
Guardian profile: contact info, device access list, emergency contacts, family members, subscription.

### Fields

| Field | Type | Mutable | Details |
|-------|------|--------|---------|
| **displayName** | `string` | Client | Guardian's name (e.g., "Alice") |
| **email** | `string` | Client | Email address |
| **phone** | `string` | Client | E.164 format (e.g., `+2304123456`) |
| **avatarUrl** | `string \| null` | Client | Firebase Storage URL (`guardianAvatars/{uid}/avatar`); max 2048 chars; validated in security rules |
| **role** | `string` | Gateway only | `guardian` \| `admin` (future use) |
| **linkedImeis** | `string[]` | Gateway | Device IMEI list this user may access; appended by gateway on invite acceptance or manual link |
| **fcmTokens** | `string[]` | App only | Firebase Cloud Messaging tokens for push alerts; one per app install |
| **subscription** | `{ tier, status, renewsAt }` | Client | Subscription entitlement (display-only; no real payment provider yet). `tier`: `free` \| `premium` |
| **emergencyContacts** | `array` | Client | Contact list: `{ name: string, phone: string, whatsapp?: boolean }` |
| **familyMembers** | `array` | Client | Family circle: `{ uid: string, displayName: string, email?: string }`. **Note**: bug #62 — acceptor appends self here, but inviter is never updated with acceptor |
| **createdAt** | `timestamp` | System | Document creation time (server-set) |
| **updatedAt** | `timestamp` | System | Last modification (server-set on each update) |

### Example Document

```json
{
  "displayName": "Alice",
  "email": "alice@example.com",
  "phone": "+23040123456",
  "avatarUrl": "https://firebasestorage.googleapis.com/v0/b/.../guardianAvatars/xyz123/avatar",
  "role": "guardian",
  "linkedImeis": ["358123456789012", "358123456789013"],
  "fcmTokens": [
    "dz123:APA91bHZ1_Y2w...",
    "ios-token-example-..."
  ],
  "subscription": {
    "tier": "premium",
    "status": "active",
    "renewsAt": "2026-08-15T12:00:00Z"
  },
  "emergencyContacts": [
    {
      "name": "Mom",
      "phone": "+23041111111",
      "whatsapp": true
    },
    {
      "name": "Dad",
      "phone": "+23041111112"
    }
  ],
  "familyMembers": [
    {
      "uid": "other_uid_456",
      "displayName": "Bob",
      "email": "bob@example.com"
    }
  ],
  "createdAt": "2026-01-15T10:30:00Z",
  "updatedAt": "2026-07-20T14:45:32Z"
}
```

### Creation & Updates

| Trigger | Writer | Action |
|---------|--------|--------|
| **User sign-up** | Client (Flutter auth UI) | Create doc with `displayName`, `email`, `phone`, `emergencyContacts`, `createdAt`, `updatedAt` |
| **Profile edit** | Client (Settings screen) | Update `displayName`, `phone`, `email`, `avatarUrl`, `emergencyContacts`, `updatedAt` |
| **Device link** | Gateway (via invite accept) | Append IMEI to `linkedImeis`, update `updatedAt` |
| **FCM token register** | App (on app launch) | Append token to `fcmTokens` |
| **Family invite accept** | Client | Append acceptor uid/name to `familyMembers` (inviter's doc only; inviter not added to acceptor's list) |

### Security Rules

**Read**: Authenticated user may read only their own doc (`uid == request.auth.uid`)

**Create**: Authenticated user may create their own doc on first sign-up

**Update**:
- User may update own profile fields: `displayName`, `phone`, `email`, `avatarUrl`, `emergencyContacts`, `familyMembers`, `updatedAt`
- User may append to `familyMembers` only if adding themselves (invite acceptance via `selfJoiningFamilyCircle` rule)
- Avatar URL must be ≤ 2048 chars or null

**Delete**: Not allowed

### Indexes

No composite indexes required for this collection.

---

## devices/{imei}

**Document ID**: Device IMEI (digits only, normalized)

### Purpose
Live device state, telemetry snapshot, and client-writable metadata (wearer identity, fall detection cache).

### Fields

| Field | Type | Mutable | Details |
|-------|------|--------|---------|
| **imei** | `string` | Gateway only | Normalized IMEI (same as doc ID) |
| **nickname** | `string \| null` | Client | Preferred display name (e.g., "Mimi"); overrides `relationship` in UI |
| **relationship** | `string \| null` | Client | Wearer relation (e.g., "Grandad", "Sister") |
| **name** | `string` | Client | Legacy label; retained for backward compatibility |
| **avatarUrl** | `string \| null` | Client | Firebase Storage URL (`deviceAvatars/{imei}/avatar`) for wearer photo |
| **simNumber** | `string \| null` | Client | Pendant's own SIM phone (E.164, e.g., `+23041234567`); used for calls and SMS commands |
| **online** | `boolean` | Gateway only | True while TCP session active or recent heartbeat; set to false on disconnect or offline alert |
| **lastHeartbeatAt** | `timestamp` | Gateway only | Last gateway contact (login, GPS, or heartbeat) |
| **batteryPercent** | `number \| null` | Gateway only | Battery 0–100; null if unknown |
| **speedKmh** | `number \| null` | Gateway only | Current speed from GPS |
| **course** | `number \| null` | Gateway only | Heading in degrees (0–359) |
| **location** | `map` | Gateway only | Latest GPS fix (see [location map](#location-map) below) |
| **accuracySource** | `string \| null` | Gateway only | `gps` \| `wifi` \| `lbs` (LBS = cell tower fallback) |
| **lastAlarm** | `map \| null` | Gateway only | Most recent alarm: `{ type: string, at: timestamp, raw: string }` (e.g., SOS, fall, low battery) |
| **intelligence** | `map \| null` | Gateway only | Rule-based insights (see [intelligence map](#intelligence-map) below); refreshed on persist or alarm |
| **firmware** | `string \| null` | Gateway only | Reported firmware version (e.g., "v1.2.3") |
| **fallDetection** | `map \| null` | Client (cache) | Client-writable request cache: `{ enabled: boolean, dialMonitorOnFall: boolean, sensitivityLevel: number }`. **Not confirmed device state** (no read-back command exists). V46/V48/V52 only. |
| **locationReportingIntervalSeconds** | `number \| null` | Client (cache) | Cached GPS upload interval (seconds) requested via `UPLOAD` command. **Not confirmed device state.** V46/V48/V52 only. |
| **createdAt** | `timestamp` | System | First device login |
| **updatedAt** | `timestamp` | System | Last modification |

#### location map

| Field | Type | Details |
|-------|------|---------|
| **lat** | `number` | Latitude (-90 to +90) |
| **lng** | `number` | Longitude (-180 to +180) |
| **altitude** | `number \| null` | Altitude in meters (GPS only) |
| **recordedAt** | `timestamp` | GPS fix time (device-reported) |
| **satellites** | `number \| null` | Satellite count (GPS only) |

#### intelligence map

| Field | Type | Details |
|-------|------|---------|
| **updatedAt** | `timestamp` | Last refresh timestamp |
| **insights** | `array` | Array of insights: `{ id, facts: string[], inference: string, confidence: number (0–100), level: 'info'\|'warning'\|'urgent', suppressBelow: number }` |
| **topInsight** | `{ id, level, inference }` | Most severe insight (convenience field) |

### Example Document

```json
{
  "imei": "358123456789012",
  "nickname": "Mimi",
  "relationship": "Grandma",
  "name": "Device1",
  "avatarUrl": "https://firebasestorage.googleapis.com/v0/b/.../deviceAvatars/358123456789012/avatar",
  "simNumber": "+23041234567",
  "online": true,
  "lastHeartbeatAt": "2026-07-29T14:32:15Z",
  "batteryPercent": 87,
  "speedKmh": 0.0,
  "course": null,
  "location": {
    "lat": -20.1609,
    "lng": 57.5012,
    "altitude": 45.5,
    "recordedAt": "2026-07-29T14:31:42Z",
    "satellites": 12
  },
  "accuracySource": "gps",
  "lastAlarm": {
    "type": "geofence_exit",
    "at": "2026-07-29T12:15:00Z",
    "raw": "FENC,0,1234567890"
  },
  "intelligence": {
    "updatedAt": "2026-07-29T14:32:15Z",
    "insights": [
      {
        "id": "unusual_time_location",
        "facts": ["Device in residential area at 2:30 AM"],
        "inference": "Possible off-schedule activity",
        "confidence": 65,
        "level": "info",
        "suppressBelow": 80
      }
    ],
    "topInsight": {
      "id": "unusual_time_location",
      "level": "info",
      "inference": "Possible off-schedule activity"
    }
  },
  "firmware": "v1.2.3",
  "fallDetection": {
    "enabled": true,
    "dialMonitorOnFall": false,
    "sensitivityLevel": 2
  },
  "locationReportingIntervalSeconds": 60,
  "createdAt": "2026-01-10T08:00:00Z",
  "updatedAt": "2026-07-29T14:32:15Z"
}
```

### Creation & Updates

| Trigger | Writer | Action |
|---------|--------|--------|
| **First login (TCP)** | Gateway | Create doc with `imei`, `online: true`, `location`, `createdAt`, `updatedAt`, then `connectionState: live` |
| **GPS fix (write gate ≥50 m)** | Gateway | Update `location`, `accuracySource`, `speedKmh`, `course`, refresh `intelligence` |
| **Battery change** | Gateway | Update `batteryPercent` |
| **Heartbeat cap (5 min idle)** | Gateway | Update `lastHeartbeatAt`, `online: true` |
| **SOS/fall/low battery alarm** | Gateway | Create alert, upsert `lastAlarm`, refresh `intelligence` |
| **Geofence enter/exit** | Gateway | Create alert, upsert location, refresh `intelligence` |
| **TCP disconnect** | Gateway | Set `online: false`, `disconnectedAt`, `connectionState: offline` |
| **Offline alert timeout** | Gateway (periodic check) | Create offline alert if heartbeat gap exceeds threshold |
| **Wearer identity** | Client (Settings) | Update `nickname`, `relationship`, `name`, `avatarUrl`, `updatedAt` |
| **SIM number record** | Client (Phone screen) | Update `simNumber`, `updatedAt` |
| **Fall detection cache** | Client (V46+) | Update `fallDetection`, `updatedAt` (request cache, not confirmed state) |
| **Location reporting interval** | Client (V46+) | Update `locationReportingIntervalSeconds`, `updatedAt` (request cache) |

### Security Rules

**Read**: Authenticated user may read only if `imei` is in `users/{uid}.linkedImeis`

**Create**: Not allowed (gateway only)

**Update**: Authenticated user may update only:
- `name`, `nickname`, `relationship`, `avatarUrl`, `simNumber` (wearer identity)
- `fallDetection`, `locationReportingIntervalSeconds` (request cache)
- `updatedAt` (system)

All other fields are gateway-owned (telemetry).

**Delete**: Not allowed

### Indexes

**Composite indexes**: None required at collection root. See sub-collections below.

---

## devices/{imei}/locations/{locationId}

**Document ID**: Auto-generated (add()'s auto-ID)

### Purpose
Optional GPS history (gateway throttles writes; only appended when `WRITE_LOCATION_HISTORY=true`).

### Fields

| Field | Type | Details |
|-------|------|---------|
| **lat** | `number` | Latitude |
| **lng** | `number` | Longitude |
| **speedKmh** | `number \| null` | Speed in km/h |
| **accuracySource** | `string \| null` | `gps` \| `wifi` \| `lbs` |
| **recordedAt** | `timestamp` | GPS fix time |

### Example Document

```json
{
  "lat": -20.1609,
  "lng": 57.5012,
  "speedKmh": 5.2,
  "accuracySource": "gps",
  "recordedAt": "2026-07-29T14:31:42Z"
}
```

### Creation & Updates

| Trigger | Writer | Action |
|---------|--------|--------|
| **Location write (if enabled)** | Gateway | Append location via `add()` when write gate passes (≥50 m moved) OR on alarm/geofence/first fix. Controlled by `WRITE_LOCATION_HISTORY` env var |
| **Heartbeat cap history** | Gateway | Append location if interval elapses while stationary |

**Note**: History is append-only; no updates. To disable, set `WRITE_LOCATION_HISTORY=false` in gateway `.env`.

### Security Rules

**Read**: Authenticated user may read only if `imei` is in `users/{uid}.linkedImeis`

**Write**: Not allowed (gateway Admin SDK only)

### Indexes

**Composite index** (for query by IMEI + time):
- Parent: `devices/{imei}`
- Sub-collection: `locations`
- Fields: `recordedAt` (descending), auto-indexed by read parent rule

---

## devices/{imei}/segments/{segmentId}

**Document ID**: Auto-generated

### Purpose
Merged dwell periods for journey visualization (e.g., "stayed at home 2–4 PM").

### Fields

| Field | Type | Details |
|-------|------|---------|
| **type** | `string` | Always `dwell` (future: may include other segment types) |
| **placeName** | `string \| null` | Optional user label (e.g., "Home", "Work") |
| **geofenceId** | `string \| null` | Safe zone ID if dwell overlaps a geofence |
| **from** | `timestamp` | Dwell start time |
| **to** | `timestamp` | Dwell end time |
| **centerLat** | `number` | Centroid latitude (average of all stationary points) |
| **centerLng** | `number` | Centroid longitude |
| **createdAt** | `timestamp` | Document write time |

### Example Document

```json
{
  "type": "dwell",
  "placeName": "Home",
  "geofenceId": "geofence_abc123",
  "from": "2026-07-29T08:15:00Z",
  "to": "2026-07-29T09:30:00Z",
  "centerLat": -20.1609,
  "centerLng": 57.5012,
  "createdAt": "2026-07-29T09:31:00Z"
}
```

### Creation & Updates

| Trigger | Writer | Action |
|---------|--------|--------|
| **Dwell detection** | Gateway | Append segment when device stays stationary (<1 km/h or <50 m movement) for ≥ `DWELL_MIN_MINUTES` (default 10 min); on exit or idle timeout, close segment and write to Firestore |
| **Geofence overlap** | Gateway | Populate `geofenceId` if dwell occurs within a known safe zone |

Segments are write-once and not updated.

### Security Rules

**Read**: Authenticated user may read only if `imei` is in `users/{uid}.linkedImeis`

**Write**: Not allowed (gateway Admin SDK only)

### Indexes

**Composite index** (for journey timeline query):
- Parent: `devices/{imei}`
- Sub-collection: `segments`
- Fields: `from` (descending), `to` (descending)

---

## devices/{imei}/journeys/{journeyId}

**Document ID**: Auto-generated

### Purpose
Compressed movement routes for journey replay (polyline-encoded GPS points during active travel).

### Fields

| Field | Type | Details |
|-------|------|---------|
| **startAt** | `timestamp` | Journey start time |
| **endAt** | `timestamp` | Journey end time |
| **distanceKm** | `number` | Total path length (km) |
| **polyline** | `string` | Google encoded polyline (precision 5) — decode to lat/lng array for map display |
| **events** | `array \| null` | Inline events (e.g., geofence exits): `{ type: string, geofenceId?: string, name?: string, at: timestamp }` |
| **pointCount** | `number` | Count of raw GPS fixes before compression |
| **compressed** | `boolean` | Always `true` (gateway-written docs); client-generated journeys may use false |
| **closeReason** | `string` | `idle` \| `geofence_exit` \| `daily_boundary` \| `disconnect` |
| **createdAt** | `timestamp` | Document write time |

### Example Document

```json
{
  "startAt": "2026-07-29T08:30:00Z",
  "endAt": "2026-07-29T09:15:00Z",
  "distanceKm": 2.34,
  "polyline": "yvliFziww@~@xBfA|BxApBfBzBhCzA|B~@|A",
  "events": [
    {
      "type": "geofence_exit",
      "geofenceId": "geofence_home",
      "name": "Home",
      "at": "2026-07-29T08:32:00Z"
    }
  ],
  "pointCount": 47,
  "compressed": true,
  "closeReason": "idle",
  "createdAt": "2026-07-29T09:16:00Z"
}
```

### Creation & Updates

| Trigger | Writer | Action |
|---------|--------|--------|
| **Journey closes** | Gateway | Write one doc when device stops moving after ≥ `JOURNEY_IDLE_MINUTES` (default 15), exits geofence, crosses daily boundary (midnight), or disconnects. Gateway accumulates GPS in memory, compresses to polyline, writes once. |

Journeys are write-once and not updated.

### Security Rules

**Read**: Authenticated user may read only if `imei` is in `users/{uid}.linkedImeis`

**Write**: Not allowed (gateway Admin SDK only)

### Indexes

**Composite index** (for journey timeline query):
- Parent: `devices/{imei}`
- Sub-collection: `journeys`
- Fields: `startAt` (descending), `endAt` (descending)

---

## geofences/{geofenceId}

**Document ID**: Auto-generated UUID

### Purpose
Safe zones (GPS radius + optional WiFi SSID) for entry/exit alerts and journey context.

### Fields

| Field | Type | Mutable | Details |
|-------|------|--------|---------|
| **imei** | `string` | No | Device IMEI this fence guards |
| **name** | `string` | Yes | Zone label (e.g., "Home", "School") |
| **active** | `boolean` | Yes | Enable/disable alerts for this zone without deletion |
| **center** | `{ lat, lng }` | Yes | GPS coordinates (center of circle) |
| **radiusMeters** | `number` | Yes | Radius in meters (e.g., 500) |
| **wifiSsid** | `string \| null` | Yes | Home WiFi network name (e.g., "HomeNet"). Feature structurally dead in production until GT06 decoder populates SSID field from device packets. |
| **createdBy** | `string` | No | uid of guardian who created this fence |
| **createdAt** | `timestamp` | No | Creation time |
| **updatedAt** | `timestamp` | Yes | Last modification time |

### Example Document

```json
{
  "imei": "358123456789012",
  "name": "Home",
  "active": true,
  "center": {
    "lat": -20.1609,
    "lng": 57.5012
  },
  "radiusMeters": 500,
  "wifiSsid": "HomeNet_5G",
  "createdBy": "user_123",
  "createdAt": "2026-02-14T10:00:00Z",
  "updatedAt": "2026-07-20T15:30:00Z"
}
```

### Creation & Updates

| Trigger | Writer | Action |
|---------|--------|--------|
| **User creates safe zone** | Client (app Map screen) | Create doc with `name`, `center`, `radiusMeters`, `active: true`, `imei`, `createdBy`, `createdAt`, `updatedAt` |
| **User edits safe zone** | Client | Update `name`, `active`, `center`, `radiusMeters`, `wifiSsid`, `updatedAt` |
| **Geofence evaluation** | Gateway (real-time) | Reads all active geofences for device; evaluates every GPS fix against each; creates `geofence_enter`/`geofence_exit` alerts; may populate segment `geofenceId` |

### Security Rules

**Read**: Authenticated user may read only if `imei` is in `users/{uid}.linkedImeis`

**Create**: Authenticated user may create only if:
- User is linked to the device IMEI (`linkedTo(request.resource.data.imei)`)
- `createdBy == request.auth.uid`

**Update**: Authenticated user may update only if:
- User is linked to the device IMEI (`linkedTo(resource.data.imei)`)
- User is the creator (`resource.data.createdBy == request.auth.uid`)
- May update: `name`, `active`, `center`, `radiusMeters`, `wifiSsid`, `updatedAt`

**Delete**: Authenticated user may delete only if creator

### Indexes

No composite indexes required.

---

## alerts/{alertId}

**Document ID**: Auto-generated

### Purpose
Event log: SOS, fall, geofence enter/exit, low battery, offline, and client-originated help alerts.

### Fields

| Field | Type | Mutable | Details |
|-------|------|--------|---------|
| **imei** | `string` | No | Device IMEI that triggered alert |
| **type** | `string` | No | `sos` \| `fall` \| `geofence_exit` \| `geofence_enter` \| `low_battery` \| `offline` \| `other` |
| **severity** | `string` | No | `info` \| `warning` \| `critical` |
| **message** | `string` | No | Human-readable (e.g., "Pendant left home") |
| **payload** | `map` | No | Raw/extra fields (e.g., GPS coords, geofence name, battery %) |
| **resolved** | `boolean` | Yes (client only) | False until guardian marks as read/resolved |
| **resolvedAt** | `timestamp \| null` | Yes (client only) | When user dismissed alert |
| **notifyStatus** | `string` | Yes (gateway) | `pending` \| `sending` \| `sent` \| `failed` \| `skipped` |
| **notifiedAt** | `timestamp \| null` | Yes (gateway) | When push/SMS sent |
| **createdAt** | `timestamp` | No | Event time (device-reported or gateway timestamp) |

### Example Document

```json
{
  "imei": "358123456789012",
  "type": "geofence_exit",
  "severity": "warning",
  "message": "Pendant left Home at 14:32",
  "payload": {
    "geofenceId": "geofence_home",
    "geofenceName": "Home",
    "lat": -20.1609,
    "lng": 57.5012,
    "exitAt": "2026-07-29T14:32:15Z"
  },
  "resolved": false,
  "resolvedAt": null,
  "notifyStatus": "sent",
  "notifiedAt": "2026-07-29T14:32:30Z",
  "createdAt": "2026-07-29T14:32:15Z"
}
```

### Creation & Updates

| Trigger | Writer | Action |
|---------|--------|--------|
| **SOS pressed on pendant** | Gateway | Create alert with `type: sos`, `severity: critical`, `notifyStatus: pending`; trigger immediate push to guardians and SMS to emergency contacts (via `shouldNotify` + `shouldSms`) |
| **Fall detected** | Gateway | Create alert with `type: fall`, `severity: critical`, `notifyStatus: pending` |
| **Geofence exit** | Gateway | Create alert with `type: geofence_exit`, `severity: warning`, payload includes geofence name; SMS to emergency contacts (narrower than push) |
| **Geofence enter** | Gateway | Create alert with `type: geofence_enter`, `severity: info`, push only (no SMS) |
| **Low battery** | Gateway | Create alert with `type: low_battery`, `severity: warning`, payload includes battery %; push only (no SMS) |
| **Offline (heartbeat timeout)** | Gateway (periodic check) | Create alert with `type: offline`, `severity: warning` when heartbeat gap exceeds threshold; rate-limited by cooldown |
| **Guardian triggers SOS** | Client (app Emergency screen) | Create alert with `type: sos`, `severity: critical`, `resolved: false`, `notifyStatus: pending` if linked to device |
| **Guardian marks resolved** | Client (alert list) | Update `resolved: true`, `resolvedAt: serverTimestamp()` |
| **Notification delivery** | Gateway (watcher) | Update `notifyStatus` to `sending` (claim), then `sent`/`failed`, and `notifiedAt` |

### Security Rules

**Read**: Authenticated user may read only if `imei` is in `users/{uid}.linkedImeis`

**Create**: Authenticated user may create only `type: sos` with:
- `severity: critical`
- `resolved: false`
- `notifyStatus: pending`
- `imei` linked to user
- Only specified fields allowed (no extra data)

**Update**: Authenticated user may update only:
- `resolved` and `resolvedAt` (dismissal)

All other fields are gateway-owned.

**Delete**: Not allowed

### Indexes

**Composite index** (for alert history query):
- Collection: `alerts`
- Fields: `imei` (ascending), `createdAt` (descending)

---

## deviceCommands/{commandId}

**Document ID**: Auto-generated UUID

### Purpose
App-originated downlink queue (SMS for V28C, TCP session for V46/V48/V52).

### Fields

| Field | Type | Mutable | Details |
|-------|------|--------|---------|
| **imei** | `string` | No | Target device IMEI |
| **type** | `string` | No | Command type (see below) |
| **params** | `map` | No | Command-specific params (e.g., `{ phone }`, `{ enabled, dialMonitorOnFall }`, `{ seconds }`) |
| **status** | `string` | No (gateway updates) | `pending` \| `sending` \| `sent` \| `failed` |
| **result** | `map \| null` | No (gateway sets) | `{ text: string, channel: 'sms'\|'tcp', simNumber?, result: string }` on delivery |
| **error** | `string \| null` | No (gateway sets) | Error reason if status is `failed` |
| **createdBy** | `string` | No | uid of guardian who issued command |
| **createdAt** | `timestamp` | No | Creation time |
| **completedAt** | `timestamp \| null` | No (gateway sets) | When delivery finished |

#### Command Types

| Type | Protocol | Device | Params | Notes |
|------|----------|--------|--------|-------|
| **set_center_number** | SMS | V28C | `{ phone: string }` | Center server number |
| **set_sos_number** | SMS | V28C | `{ slot: 1\|2\|3, phone: string }` | Emergency contact number |
| **check_status** | SMS | V28C | `{}` | Request device status (battery, location, etc.) |
| **voice_monitor** | SMS | V28C | `{ phone: string }` | Listen in (monitor) — **unverified; borrowed from RF-V28 docs** |
| **ring_to_find** | SMS | V28C | `{}` | Ring to locate — **unverified; borrowed from RF-V28 docs** |
| **set_fall_detection** | TCP | V46/V48/V52 | `{ enabled: boolean, dialMonitorOnFall: boolean }` | Enable/disable fall alert |
| **set_fall_sensitivity** | TCP | V46/V48/V52 | `{ level: number }` | Sensitivity 1–3 (1 = high, 3 = low) |
| **set_medication_reminder** | TCP | V46/V48/V52 | `{ time: "HH:MM", frequency: 1\|2\|3, week?: "Sun..Sat", text: string }` | Schedule reminder |
| **set_upload_interval** | TCP | V46/V48/V52 | `{ seconds: number }` | GPS upload interval (requires live TCP session) |

**Note**: `voice_monitor` and `ring_to_find` are unverified against real V28C hardware. Vendor PDFs only document: server switch, SOS numbers, center number, status check, APN, IMEI change. See GitHub issues #28, #29, #12 for unconfirmed commands.

### Example Document

```json
{
  "imei": "358123456789012",
  "type": "set_fall_detection",
  "params": {
    "enabled": true,
    "dialMonitorOnFall": false
  },
  "status": "sent",
  "result": {
    "text": "Fall detection enabled",
    "channel": "tcp",
    "result": "ACK"
  },
  "error": null,
  "createdBy": "user_123",
  "createdAt": "2026-07-29T14:00:00Z",
  "completedAt": "2026-07-29T14:00:02Z"
}
```

### Creation & Updates

| Trigger | Writer | Action |
|---------|--------|--------|
| **User issues command** | Client (Settings > Device Controls) | Create doc with `imei`, `type`, `params`, `status: pending`, `createdBy`, `createdAt` |
| **Gateway processes queue** | Gateway (startup + watcher) | Poll pending commands; attempt delivery (SMS or TCP depending on device version); update `status` → `sending` → `sent`/`failed`; set `result` or `error`; set `completedAt` |
| **TCP command (V46+)** | Gateway | Requires live TCP session; if not connected, mark `failed` with `error: "device offline"` |
| **SMS command (V28C)** | Gateway | Send SMS to device's `simNumber`; wait for response; update result |

### Security Rules

**Read**: Authenticated user may read only if `imei` is in `users/{uid}.linkedImeis`

**Create**: Authenticated user may create only if:
- User is linked to device IMEI (`linkedTo(request.resource.data.imei)`)
- `createdBy == request.auth.uid`
- `status == pending`
- Required fields present: `imei`, `type`, `params`, `status`, `createdBy`, `createdAt`

**Update**: Not allowed (gateway Admin SDK only)

**Delete**: Not allowed (gateway Admin SDK only)

### Indexes

No composite indexes required (gateway scans by status, not user query).

---

## medicationReminders/{reminderId}

**Document ID**: Auto-generated UUID

### Purpose
Medication reminder schedule (device-synced). App stores the source of truth; gateway enqueues matching `deviceCommands` on create/update/delete to sync pendant.

### Fields

| Field | Type | Mutable | Details |
|-------|------|--------|---------|
| **imei** | `string` | No | Device IMEI |
| **time** | `string` | Yes | Reminder time in 24-hour format (e.g., "14:30") |
| **frequency** | `number` | Yes | `1` (once) \| `2` (daily) \| `3` (weekly) |
| **week** | `string \| null` | Yes | 7-digit on/off mask (Sun→Sat) for weekly reminders (e.g., "1010101" = Mon/Wed/Fri); only when `frequency: 3` |
| **text** | `string` | Yes | Reminder text (app sends UTF-8; gateway converts to hex-UTF16 for device) |
| **enabled** | `boolean` | Yes | Pause/resume reminder without deletion |
| **createdBy** | `string` | No | uid of guardian who created reminder |
| **createdAt** | `timestamp` | No | Creation time |
| **updatedAt** | `timestamp` | Yes | Last modification time |

### Example Document

```json
{
  "imei": "358123456789012",
  "time": "08:00",
  "frequency": 2,
  "week": null,
  "text": "Take morning medication",
  "enabled": true,
  "createdBy": "user_123",
  "createdAt": "2026-07-15T12:00:00Z",
  "updatedAt": "2026-07-29T14:00:00Z"
}
```

### Creation & Updates

| Trigger | Writer | Action |
|---------|--------|--------|
| **User creates reminder** | Client (Settings > Reminders) | Create doc with `imei`, `time`, `frequency`, `week`, `text`, `enabled: true`, `createdBy`, `createdAt`, `updatedAt`; enqueue `deviceCommands/{id}` with `type: set_medication_reminder` |
| **User edits reminder** | Client | Update `time`, `frequency`, `week`, `text`, `enabled`, `updatedAt`; enqueue `deviceCommands` with new params |
| **User deletes reminder** | Client | Delete doc; enqueue `deviceCommands` to remove from device (gateway maps deletion to command) |
| **Gateway syncs** | Gateway (watcher) | Process `deviceCommands` queue; confirm delivery; update command status |

### Security Rules

**Read**: Authenticated user may read only if `imei` is in `users/{uid}.linkedImeis`

**Create**: Authenticated user may create only if:
- User is linked to device IMEI (`linkedTo(request.resource.data.imei)`)
- `createdBy == request.auth.uid`

**Update**: Authenticated user may update only if:
- User is linked to device IMEI (`linkedTo(resource.data.imei)`)
- User is the creator (`resource.data.createdBy == request.auth.uid`)
- May update: `time`, `frequency`, `week`, `text`, `enabled`, `updatedAt`

**Delete**: Authenticated user may delete only if creator

### Indexes

No composite indexes required (queries filtered by IMEI + user).

---

## invites/{inviteId}

**Document ID**: Auto-generated UUID (or could be the 6-char code itself)

### Purpose
Family access sharing: guardian creates invite with their device list, other user accepts to gain access.

### Fields

| Field | Type | Mutable | Details |
|-------|------|--------|---------|
| **code** | `string` | No | 6-character shareable code (e.g., "ABC123") |
| **createdBy** | `string` | No | uid of inviter |
| **createdByName** | `string` | No | Inviter's display name |
| **createdByEmail** | `string \| null` | No | Inviter's email (optional) |
| **linkedImeis** | `string[]` | No | Snapshot of inviter's devices at creation time |
| **status** | `string` | Yes | `pending` \| `accepted` \| `revoked` |
| **acceptedBy** | `string \| null` | Yes | uid of acceptor (if status is `accepted`) |
| **acceptedByName** | `string \| null` | Yes | Acceptor's display name (if status is `accepted`) |
| **acceptedAt** | `timestamp \| null` | Yes | When acceptor joined |
| **createdAt** | `timestamp` | No | Creation time |
| **expiresAt** | `timestamp` | No | Invite expiry (e.g., 7 days later) |

### Example Document

```json
{
  "code": "ABC123",
  "createdBy": "user_123",
  "createdByName": "Alice",
  "createdByEmail": "alice@example.com",
  "linkedImeis": ["358123456789012", "358123456789013"],
  "status": "accepted",
  "acceptedBy": "user_456",
  "acceptedByName": "Bob",
  "acceptedAt": "2026-07-20T10:30:00Z",
  "createdAt": "2026-07-18T15:00:00Z",
  "expiresAt": "2026-07-25T15:00:00Z"
}
```

### Creation & Updates

| Trigger | Writer | Action |
|---------|--------|--------|
| **Inviter creates share link** | Client (Family screen) | Create doc with `code`, `createdBy`, `createdByName`, `createdByEmail`, `linkedImeis` (snapshot), `status: pending`, `createdAt`, `expiresAt` (7 days default) |
| **Acceptor uses code** | Client (Invite entry screen) | Find invite by `code`; update `status: accepted`, `acceptedBy`, `acceptedByName`, `acceptedAt`; also append acceptor uid to inviter's `users/{uid}.familyMembers` (bug #62: inviter's list is never updated with acceptor) |
| **Inviter revokes** | Client | Update `status: revoked` |
| **Invite expires** | Scheduled task (future) | Mark `status: expired` after `expiresAt` (not currently implemented) |

### Security Rules

**Read**: Authenticated user may read any invite (unauthenticated can view if they have code)

**Create**: Authenticated user may create only if:
- `createdBy == request.auth.uid`
- `status == pending`

**Update**: Authenticated user may update if:
- User is inviter (`resource.data.createdBy == request.auth.uid`), OR
- Invite is `pending` and user is accepting (`resource.data.status == 'pending'` and `request.resource.data.status == 'accepted'` and `request.resource.data.acceptedBy == request.auth.uid`)

**Delete**: Authenticated user may delete only if inviter

### Indexes

No composite indexes required (lookup by code is single-field).

---

## notificationLogs/{logId}

**Document ID**: Auto-generated UUID

### Purpose
Audit trail of SMS/WhatsApp delivery attempts (emergency contact notifications only).

### Fields

| Field | Type | Details |
|-------|------|---------|
| **imei** | `string` | Device IMEI that triggered notification |
| **alertType** | `string` | Alert type (e.g., "sos", "fall", "geofence_exit") |
| **message** | `string` | SMS/WhatsApp message body sent |
| **contactCount** | `number` | Number of emergency contacts notified |
| **results** | `array` | Per-contact delivery results: `{ name, phone, channel, status, error?, sentAt }` |
| **createdAt** | `timestamp` | Send time |

### Example Document

```json
{
  "imei": "358123456789012",
  "alertType": "sos",
  "message": "Emergency SOS from Mimi at 14:32. Location: -20.1609, 57.5012",
  "contactCount": 2,
  "results": [
    {
      "name": "Mom",
      "phone": "+23041111111",
      "channel": "whatsapp",
      "status": "sent",
      "sentAt": "2026-07-29T14:32:30Z"
    },
    {
      "name": "Dad",
      "phone": "+23041111112",
      "channel": "sms",
      "status": "failed",
      "error": "Invalid phone number"
    }
  ],
  "createdAt": "2026-07-29T14:32:30Z"
}
```

### Creation & Updates

| Trigger | Writer | Action |
|---------|--------|--------|
| **Alert triggered** | Gateway (`notify.js`) | When `shouldSms(alert)` is true (SOS, fall, geofence_exit), create log after attempting to send to all emergency contacts; record per-contact success/failure |

Write-once; no updates.

### Security Rules

**Read**: Authenticated user may read only if `imei` is in `users/{uid}.linkedImeis`

**Write**: Not allowed (gateway Admin SDK only)

### Indexes

No composite indexes required (audit log; not queried in app UI).

---

## Security Rules Summary

### Client Access Pattern

Every Firestore read is scoped via the `linkedTo(imei)` function:

```
function linkedTo(imei) {
  return signedIn() && imei in userDoc().linkedImeis;
}
```

**Rule**: Clients may only read/write collections that reference an IMEI if they are linked to that IMEI.

### Gateway Access Pattern

Gateway uses Firebase Admin SDK (bypasses security rules) to:
- **Own** all device telemetry (`location`, `batteryPercent`, `online`, `intelligence`, etc.)
- **Create** alerts, notification logs, segments, journeys
- **Process** command queue and update status
- **Migrate** legacy device documents

### Client Ownership

Clients own and write:
- User profile fields (`displayName`, `phone`, `email`, `avatarUrl`, `emergencyContacts`)
- Device metadata (`nickname`, `relationship`, `avatarUrl`, `simNumber`)
- Geofences and medication reminders (create/update/delete)
- Alert resolution (mark as read)
- Invite creation and acceptance
- Device command creation (initiates downlink)

---

## Data Lifecycle & Retention

### How Data Flows

```
Pendant (GT06)
    ↓ [TCP/SMS]
Gateway (Node.js)
    ↓ [Admin SDK, no security rules]
Firestore (collections below)
    ↓ [Authenticated clients, subject to rules]
Flutter App
```

### Write Gates (Gateway Throttling)

Gateway writes to Firestore only when meaningful:

| Condition | Writes | Purpose |
|-----------|--------|---------|
| Moved ≥50 m from last persist | `devices/{imei}.location` | Avoid location spam |
| Battery changed by ≥1% | `devices/{imei}.batteryPercent` | Coalesce updates |
| SOS/fall/low_battery/geofence | Always | Critical events always persist |
| Heartbeat cap (5 min idle) | `devices/{imei}.lastHeartbeatAt` | Confirm online status |
| Dwell ≥10 min | `devices/{imei}/segments/{id}` | Journey timeline |
| Journey closes | `devices/{imei}/journeys/{id}` | Route replay |
| Disconnect | Flush journey, set `online: false` | Housekeeping |

### Data Not Persisted (In-Memory Only)

- Real-time GPS stream (unless threshold crossed)
- Individual short-duration movements
- Granular telemetry changes below thresholds

### No Hard Delete

Firestore documents are not deleted; instead:
- Alerts remain in history (guardians mark `resolved` to dismiss)
- Geofences and reminders may be deleted by creator
- Invites expire (status → `expired`) but document remains

---

## Composite Indexes Deployed

These indexes must exist in Firestore for queries to work:

| Collection | Parent | Fields | Purpose |
|------------|--------|--------|---------|
| `alerts` | — | `imei` (asc), `createdAt` (desc) | Alert history query |
| `locations` | `devices/{imei}` | `recordedAt` (desc) | Location history replay |
| `segments` | `devices/{imei}` | `from` (desc), `to` (desc) | Journey timeline |
| `journeys` | `devices/{imei}` | `startAt` (desc), `endAt` (desc) | Journey route query |

Deploy via:
```bash
firebase deploy --only firestore:indexes
```

Check `firestore/firestore.indexes.json` for exact definitions.

---

## Common Query Patterns

### Linked Devices
```dart
final linkedImeis = userData.linkedImeis;
final devices = db.collection('devices')
    .where(FieldPath.documentId, whereIn: linkedImeis)
    .snapshots();
```

### Alerts for Device (Last 24 Hours)
```dart
final yesterday = DateTime.now().subtract(Duration(days: 1));
final alerts = db.collection('alerts')
    .where('imei', isEqualTo: imei)
    .where('createdAt', isGreaterThan: Timestamp.fromDate(yesterday))
    .orderBy('createdAt', descending: true)
    .snapshots();
```

### Geofences for Device
```dart
final fences = db.collection('geofences')
    .where('imei', isEqualTo: imei)
    .snapshots();
```

### Medication Reminders for Device
```dart
final reminders = db.collection('medicationReminders')
    .where('imei', isEqualTo: imei)
    .orderBy('time')
    .snapshots();
```

### Journey Routes (Date Range)
```dart
final start = Timestamp.fromDate(DateTime(2026, 7, 28));
final end = Timestamp.fromDate(DateTime(2026, 7, 29));
final journeys = db.collection('devices').doc(imei)
    .collection('journeys')
    .where('startAt', isGreaterThanOrEqualTo: start)
    .where('startAt', isLessThan: end)
    .orderBy('startAt', descending: true)
    .snapshots();
```

---

## Troubleshooting & Known Issues

### "Composite index missing" Error

**Symptom**: Query fails with message like "The query requires an index on field X."

**Fix**: Deploy indexes:
```bash
firebase deploy --only firestore:indexes
```

Ensure `firestore/firestore.indexes.json` includes all composite indexes above.

### Location History Empty

**Symptom**: `devices/{imei}/locations` has no documents despite device being online.

**Cause**: Gateway env var `WRITE_LOCATION_HISTORY=false` (default). 

**Fix**: Set `WRITE_LOCATION_HISTORY=true` in `gateway/.env`, restart gateway.

### Alerts Not Reaching Guardians

**Symptom**: Device triggers SOS/fall but guardian doesn't get push/SMS.

**Check**:
1. Alert doc has `notifyStatus: pending` (check `alerts/{alertId}`)
2. Guardian has FCM tokens in `users/{uid}.fcmTokens`
3. Emergency contacts are populated in `users/{uid}.emergencyContacts`
4. Gateway is connected and polling alert watcher

**Debug**: Check `notificationLogs/{logId}` for delivery status.

### Family Invite Acceptance Bug (#62)

**Symptom**: Acceptor gains access to inviter's devices, but inviter's `familyMembers` list is not updated with acceptor.

**Status**: Known issue, not yet fixed. Work around by manually adding acceptor uid to inviter's `familyMembers`.

### WiFi Safe-Zone Feature Broken

**Symptom**: Setting `wifiSsid` on geofence has no effect.

**Cause**: GT06 decoder never populates WiFi SSID field from device packets (gateway code exists but receives null).

**Status**: Structurally dead in production. Remove `wifiSsid` field from geofence UI until device firmware or decoder is updated.

---

## References

- `firestore/SCHEMA.md` — High-level schema overview (source of truth)
- `firestore/rules.example` — Firestore security rules (deployed via `firebase.json`)
- `firestore/firestore.indexes.json` — Composite index definitions
- `gateway/src/firestore.js` — Gateway write logic (initialization, upserts, alerts)
- `gateway/src/notify.js` — Notification delivery and logging
- `apps/mobile/lib/services/guardian_services.dart` — Flutter client queries and updates
