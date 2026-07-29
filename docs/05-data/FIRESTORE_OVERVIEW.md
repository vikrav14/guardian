# Firestore Overview

Complete schema documentation for Guardian's Firestore database. This guide covers all collections, document structures, field types, relationships, write patterns, and access control.

**Source of truth:** `firestore/SCHEMA.md` (schema definitions) + `gateway/src/firestore.js` (implementation) + `firestore/rules.example` (security).

## Table of Contents

- [Collections at a Glance](#collections-at-a-glance)
- [Core Collections](#core-collections)
- [Subcollections](#subcollections)
- [Operational/Internal Collections](#operationalinternal-collections)
- [Document Relationships](#document-relationships)
- [Write Patterns & Triggers](#write-patterns--triggers)
- [Composite Indexes](#composite-indexes)
- [Access Control (Security Rules)](#access-control-security-rules)
- [Implementation Notes](#implementation-notes)

---

## Collections at a Glance

| Collection | Purpose | Owner | Example Doc ID |
|------------|---------|-------|-----------------|
| `users` | Guardian profiles, linked IMEIs, FCM tokens | App + Firebase Auth | Firebase UID |
| `devices` | Pendant state, location, battery, online status | Gateway (Admin SDK) | `860719027650812` (IMEI) |
| `geofences` | Safe zones for each device | App (with validation) | `geofence_abc123` |
| `alerts` | Event log (SOS, fall, offline, geofence, battery) | Gateway + App | Auto-generated |
| `deviceCommands` | Downlink requests (set center #, check status, etc.) | App (create) + Gateway (deliver) | Auto-generated |
| `medicationReminders` | Reminders synced to pendant | App | Auto-generated |
| `invites` | Family share codes | App | 6-char code + timestamp |
| `notificationLogs` | SMS/WhatsApp delivery audit trail | Gateway | Auto-generated |
| **Subcollections** |
| `devices/{imei}/locations` | GPS history (optional, gated by config) | Gateway | Auto-generated |
| `devices/{imei}/segments` | Dwell periods (dwelling > 10 min stationary) | Gateway | Auto-generated |
| `devices/{imei}/journeys` | Compressed movement routes (polyline) | Gateway | Auto-generated |

---

## Core Collections

### `users/{uid}`

User profiles. Document ID is the Firebase Auth UID.

| Field | Type | Notes |
|-------|------|-------|
| `displayName` | string | Guardian's name |
| `email` | string | Email address |
| `phone` | string | E.164 format preferred |
| `avatarUrl` | string \| null | Firebase Storage URL (`guardianAvatars/{uid}/avatar`); max 2048 chars |
| `role` | string | `guardian` \| `admin` (future: permission levels) |
| `linkedImeis` | string[] | IMEIs this guardian can view/control (e.g., `["860719027650812", "860719027650813"]`) |
| `fcmTokens` | string[] | FCM registration tokens for push notifications (one per app install) |
| `subscription` | map \| null | `{ tier: 'free' \| 'premium', status: 'active' \| ..., renewsAt: timestamp }`. Display-only; no payment processor wired up yet. |
| `emergencyContacts` | array | `[{ name, phone, whatsapp? }, ...]` — e.g., `[{ name: "Mom", phone: "+230xxxxxxxx", whatsapp: true }]` |
| `familyMembers` | array | Other guardians granted access: `[{ uid, displayName, email? }, ...]`. Built incrementally as invites are accepted (see [Known Gaps](../../CLAUDE.md#known-gaps)). |
| `createdAt` | timestamp | Account creation time |
| `updatedAt` | timestamp | Last modified (user-initiated, not automatic) |

**Access:**
- Clients may read their own doc only (`request.auth.uid == uid`).
- Clients may create docs for themselves on first sign-up.
- Guardians may update their own profile fields (name, email, phone, avatar).
- Gateway: Admin SDK bypasses all rules.

**Key Relationship:** Links to `devices` via `linkedImeis` (stored as IMEI strings).

---

### `devices/{imei}`

Live device state, updated by the gateway on every meaningful event (GPS movement, battery change, SOS, etc.). Document ID = device IMEI (digits only, 15 digits for authentic IMEIs).

| Field | Type | Notes |
|-------|------|-------|
| `imei` | string | Same as document ID; canonical form |
| `protocolId` | string \| absent | Legacy field used if IMEI was stored under a different ID (protocol variant). Only present after migration from old protocol tracking. |
| `nickname` | string \| null | Preferred dashboard name, e.g., "Mimi" (overrides `relationship`). Set by guardian. |
| `relationship` | string \| null | Guardian's relationship to wearer, e.g., "Mum", "Dad", "Grandad". Display-only. |
| `name` | string | Legacy friendly label for backwards compatibility. Avoid in new code. |
| `avatarUrl` | string \| null | Firebase Storage URL (`deviceAvatars/{imei}/avatar`); max 5 MB on upload. |
| `simNumber` | string \| null | Pendant's own SIM phone number (E.164). Used for SMS commands and voice calls. |
| **Connectivity State** |
| `online` | boolean | `true` while TCP session active or heartbeat recent; `false` after stale timeout. |
| `connectionState` | string | `'live'` \| `'connecting'` \| `'offline'`. More precise than boolean `online`. |
| `lastHeartbeatAt` | timestamp | Most recent heartbeat from pendant (heartbeat or GPS packet). |
| `disconnectedAt` | timestamp \| absent | When device went offline (deleted if online again). |
| `connectingAt` | timestamp \| absent | When device entered `'connecting'` state (cleared when online). |
| **Telemetry** |
| `batteryPercent` | number \| null | 0–100 (nullable for devices without battery reporting). |
| `speedKmh` | number \| null | Current speed from GPS. |
| `course` | number \| null | Heading in degrees (0–360). |
| `accuracySource` | string \| null | `'gps'` \| `'wifi'` \| `'lbs'` (LBS = cellular tower). Indicates source of `location`. |
| `location` | map | Current location (see [Location Map](#location-map) below). |
| **Location Metadata** |
| `location.lat` | number | Latitude |
| `location.lng` | number | Longitude |
| `location.altitude` | number \| null | Altitude in meters |
| `location.recordedAt` | timestamp | When this fix was recorded by pendant |
| `location.satellites` | number \| null | GPS satellite count (GPS fixes only) |
| **Device Capabilities & Config** |
| `firmware` | string \| null | Firmware version, e.g., `"V52"`. Set by gateway from device packet. |
| `fallDetection` | map \| null | App-cached preference, **not** device-confirmed state: `{ enabled: boolean, dialMonitorOnFall: boolean, sensitivityLevel: 'low' \| 'medium' \| 'high' }`. V46/V48/V52 only. Guardians update via UI; gateway enqueues `deviceCommands` to sync to pendant. |
| `locationReportingIntervalSeconds` | number \| null | App-cached last requested interval (e.g., 60). Gateway sends to pendant via `UPLOAD,<seconds>` command. V46/V48/V52 only. Not device-confirmed. |
| **Intelligence & Alerting** |
| `lastAlarm` | map \| null | Most recent alarm from device: `{ type: 'sos' \| 'fall' \| 'low_battery', at: timestamp, raw: {...} }`. |
| `intelligence` | map \| null | Gateway-owned rule-based insights: `{ updatedAt: timestamp, insights: [{ id, facts, inference, confidence: 0–100, level: 'info' \| 'warning' \| 'urgent', suppressBelow }, ...], topInsight: {...} \| null }`. Evaluated on every GPS fix but persisted only on alarm or Firestore write. |
| **Metadata** |
| `createdAt` | timestamp | When device was first linked to an account |
| `updatedAt` | timestamp | Last time any field was modified (by gateway or app) |

**Access:**
- Clients may read if IMEI is in `users/{uid}.linkedImeis`.
- Clients may update only these fields: `nickname`, `relationship`, `name`, `avatarUrl`, `simNumber`, `fallDetection`, `locationReportingIntervalSeconds` (see [Firestore Security Rules](../../firestore/rules.example)).
- Gateway (Admin SDK) owns telemetry: location, battery, online status, intelligence.

**Key Relationships:**
- Parent: `users/{uid}` (via `linkedImeis`).
- Children: `locations`, `segments`, `journeys` (subcollections).
- Related: `geofences` (query by `imei`), `alerts` (query by `imei`), `deviceCommands` (query by `imei`).

---

### `geofences/{geofenceId}`

Safe zones for a device (e.g., "Home", "School"). Guardians create/edit; gateway evaluates entry/exit on every GPS fix.

| Field | Type | Notes |
|-------|------|-------|
| `imei` | string | Target device IMEI. Used in queries: `where('imei', '==', imei)`. |
| `name` | string | Display name, e.g., "Home" |
| `active` | boolean | If `false`, geofence is paused (no alerts but still stored). |
| `center` | map | `{ lat: number, lng: number }` |
| `radiusMeters` | number | Radius in meters (e.g., 100). |
| `wifiSsid` | string \| null | Home WiFi SSID for WiFi-based safe-zone detection. **Note:** GT06 decoder never populates WiFi SSID from real device packets; this field is dead in production until decoder is fixed (see [Known Gaps](../../CLAUDE.md#known-gaps)). |
| `createdBy` | string | UID of the guardian who created this geofence. |
| `createdAt` | timestamp | Creation time |
| `updatedAt` | timestamp | Last modification time |

**Access:**
- Clients may read if they are linked to the IMEI.
- Clients may create if they are linked to the IMEI and set `createdBy` to their own UID.
- Clients may update/delete if they are linked and they created it (`createdBy == request.auth.uid`).

**Evaluation:** Gateway runs geofence checks on every valid GPS fix in memory (even if Firestore write is skipped by the write gate). Entry/exit creates alerts and may trigger notifications to emergency contacts.

---

### `alerts/{alertId}`

Event log for all device-related alerts. Document ID is auto-generated.

| Field | Type | Notes |
|-------|------|-------|
| `imei` | string | Device IMEI. Indexed with `createdAt` for fast lookups. |
| `type` | string | Alert type: `'sos'` \| `'fall'` \| `'geofence_exit'` \| `'geofence_enter'` \| `'low_battery'` \| `'offline'` \| `'other'`. |
| `severity` | string | `'info'` \| `'warning'` \| `'critical'`. Informs notification urgency. |
| `message` | string | Human-readable description, e.g., "Pendant left safe zone at 3:45 PM". |
| `title` | string \| absent | Short title for push notifications (if populated). |
| `payload` | map | Raw/extra context: geofence details, offline facts, etc. Structure varies by alert type. |
| **Status & Notification** |
| `resolved` | boolean | `false` initially. Guardians may set to `true` to dismiss. |
| `resolvedAt` | timestamp \| null | When guardian marked as resolved (if resolved). |
| `notifyStatus` | string | `'pending'` → `'sending'` → `'sent'` \| `'failed'` \| `'skipped'`. Tracks notification delivery. |
| `notifiedAt` | timestamp \| null | When notifications were sent. |
| **Metadata** |
| `createdAt` | timestamp | When alert was triggered (compound index with `imei`). |

**Sources:**
1. **Gateway:** SOS, fall, geofence enter/exit, low battery, offline (from intelligence monitor).
2. **App:** Manual "Send help alert" (SOS only, restricted by security rules).

**Access:**
- Clients may read if linked to the IMEI.
- Clients may update only `resolved` and `resolvedAt` fields.
- Gateway (Admin SDK) creates and manages notification status.

**Composite Index:** `(imei, createdAt DESC)` — required for efficient alert queries.

---

### `deviceCommands/{commandId}`

Downlink commands from app to pendant. App creates with `status: 'pending'`; gateway claims and delivers.

| Field | Type | Notes |
|-------|------|-------|
| `imei` | string | Target device IMEI. |
| `type` | string | Command type: `'set_center_number'` \| `'set_sos_number'` \| `'check_status'` \| `'voice_monitor'` \| `'ring_to_find'` \| `'set_fall_detection'` \| `'set_fall_sensitivity'` \| `'set_medication_reminder'` \| `'set_upload_interval'`. |
| `params` | map | Command-specific parameters: `{ phone }`, `{ slot, phone }`, `{ enabled, dialMonitorOnFall }`, `{ level }`, `{ time, frequency, week, text }`, `{ seconds }`, etc. Structure depends on `type`. |
| **Status & Delivery** |
| `status` | string | `'pending'` → `'sending'` → `'sent'` \| `'failed'`. Watcher delivers pending commands. |
| `result` | map \| null | Delivery outcome (if sent): `{ text: string, channel: 'sms' \| 'tcp', simNumber?: string, result: string }`. |
| `error` | string \| null | Error message (if failed). |
| **Metadata** |
| `createdBy` | string | UID of guardian who requested this command. |
| `createdAt` | timestamp | When command was created. |
| `completedAt` | timestamp \| null | When delivery was attempted (success or failure). |

**Delivery Mechanism:**
- **V28C (SMS):** All commands delivered via SMS. `voice_monitor` and `ring_to_find` are unverified against real V28C hardware (borrowed from RF-V28 community docs); see [Hardware Commands](../../CLAUDE.md#hard-rule-never-fabricate-hardware-commands).
- **V46/V48/V52 (TCP):** Commands delivered over live TCP session when device is online. `set_upload_interval` is TCP-only (no SMS equivalent).

**Access:**
- Clients may read if linked to the IMEI.
- Clients may create if linked and set `createdBy` to their own UID, with `status: 'pending'`.
- Gateway (Admin SDK) manages status updates and delivery.

**Watcher:** `startPendingCommandWatcher()` in `firestore.js` watches for `status == 'pending'` and calls `deliverDeviceCommand()`.

---

### `medicationReminders/{reminderId}`

Medication reminder schedule. Since the pendant has no "list my reminders" query command, this is the source of truth. Updating or deleting here enqueues a matching `deviceCommands` entry.

| Field | Type | Notes |
|-------|------|-------|
| `imei` | string | Target device IMEI. V46/V48/V52 only. |
| `time` | string | Reminder time in 24-hour format, e.g., `"08:30"`. |
| `frequency` | number | `1` (once) \| `2` (daily) \| `3` (weekly). |
| `week` | string \| null | 7-digit Sun→Sat mask (e.g., `"1111100"` for weekdays), only if `frequency == 3`. |
| `text` | string | Plain text reminder (e.g., "Take blood pressure medication"). Pendant stores as hex-UTF16 encoded. |
| `enabled` | boolean | If `false`, reminder is disabled but retained (recoverable). |
| **Metadata** |
| `createdBy` | string | UID of guardian who created this reminder. |
| `createdAt` | timestamp | Creation time |
| `updatedAt` | timestamp | Last modification time |

**Access:**
- Clients may read if linked to the IMEI.
- Clients may create/update/delete if linked and they created it (`createdBy == request.auth.uid`).

**V46/V48/V52 Only:** No SMS command equivalent for earlier protocol versions.

---

### `invites/{inviteId}`

Family share codes. Document ID is typically the 6-char code + timestamp. Acceptor links to inviter's devices; inviter's `familyMembers` list is updated separately (known bug, see [Known Gaps](../../CLAUDE.md#known-gaps)).

| Field | Type | Notes |
|-------|------|-------|
| `code` | string | 6-character share code (e.g., `"ABC123"`) |
| `createdBy` | string | UID of the inviter |
| `createdByName` | string | Display name of inviter (snapshot at creation time) |
| `createdByEmail` | string \| null | Email of inviter (snapshot at creation time) |
| `linkedImeis` | string[] | Snapshot of inviter's `linkedImeis` at creation time. Acceptor links to these devices. |
| **Status** |
| `status` | string | `'pending'` \| `'accepted'` \| `'revoked'`. |
| `acceptedBy` | string \| null | UID of acceptor (if accepted). |
| `acceptedByName` | string \| null | Display name of acceptor (if accepted). |
| `acceptedAt` | timestamp \| null | When the invite was accepted. |
| **Metadata** |
| `createdAt` | timestamp | Creation time |
| `expiresAt` | timestamp | Expiration time (hard cutoff for accepting). |

**Lifecycle:**
1. Inviter creates invite with `status: 'pending'`.
2. Acceptor accepts by setting `status: 'accepted'`, `acceptedBy: uid`, `acceptedAt: now`.
3. Acceptor's `users/{uid}.linkedImeis` is updated to include devices from `linkedImeis`.
4. Inviter's `users/{uid}.familyMembers` should be updated but is **not** (known bug).

**Access:**
- All signed-in users may read invites (to support discovery).
- Creators may create/delete their own invites.
- Acceptors may update status from `'pending'` to `'accepted'`.

---

### `notificationLogs/{logId}`

Audit trail of SMS/WhatsApp delivery. Gateway writes after attempting to notify emergency contacts.

| Field | Type | Notes |
|-------|------|-------|
| `imei` | string | Device IMEI. Used for filtering: `where('imei', '==', imei)`. |
| `alertType` | string | Type of alert that triggered notification (e.g., `'sos'`, `'fall'`, `'geofence_exit'`). |
| `message` | string | Text of message sent. |
| `contactCount` | number | Number of emergency contacts notified. |
| `results` | array | Per-contact delivery results: `[{ name, phone, channel: 'sms' \| 'whatsapp', status: 'sent' \| 'failed', error?: string }, ...]`. |
| `createdAt` | timestamp | When notification attempt was made. |

**Access:**
- Clients may read if linked to the IMEI.
- Gateway (Admin SDK) only for writes.

---

## Subcollections

### `devices/{imei}/locations/{locationId}`

Optional GPS location history. Gateway appends only if `WRITE_LOCATION_HISTORY=true` in `.env`. Gated by the same write conditions as device doc updates (50 m movement, battery change, alarm, geofence event, etc.).

| Field | Type | Notes |
|-------|------|-------|
| `lat` | number | Latitude |
| `lng` | number | Longitude |
| `speedKmh` | number \| null | Speed at this fix |
| `accuracySource` | string \| null | `'gps'` \| `'wifi'` \| `'lbs'` |
| `recordedAt` | timestamp | When pendant recorded this fix |

**Write Gate:** (from `firestore/SCHEMA.md`)
- Device moved ≥ 50 m (default `WRITE_GATE_MIN_METRES`) from last persisted location.
- Battery integer changed.
- Alarm event (SOS, fall, low_battery, geofence).
- First GPS fix after TCP connect.
- Heartbeat cap (5 min default, `WRITE_GATE_HEARTBEAT_MINUTES`) while stationary.
- Location history interval elapsed (separate config).

**Access:**
- Clients may read if linked to the IMEI.
- Gateway (Admin SDK) only for writes.

---

### `devices/{imei}/segments/{segmentId}`

Dwell periods: contiguous stationary events (device moving < 1 km/h or < 50 m between fixes) lasting ≥ 10 min (default `DWELL_MIN_MINUTES`). Merged in memory by gateway; written as single doc at dwell end.

| Field | Type | Notes |
|-------|------|-------|
| `type` | string | Always `'dwell'` (reserved for future segment types). |
| `placeName` | string \| null | Optional human label for this dwell (e.g., "Park", "Clinic"). User-set or auto-detected (future). |
| `geofenceId` | string \| null | If dwell occurred inside an active geofence, its ID. |
| `from` | timestamp | Dwell start time |
| `to` | timestamp | Dwell end time (when device resumed movement or went offline). |
| `centerLat` | number | Centroid latitude (average of all fixes during dwell) |
| `centerLng` | number | Centroid longitude |
| `createdAt` | timestamp | When this segment was persisted (after dwell ended). |

**Triggers:** Gateway writes when:
- Device stays stationary (< 1 km/h or < 50 m movement) for ≥ 10 min.
- At disconnect (flushes open dwell).
- At daily boundary (midnight).

**Access:**
- Clients may read if linked to the IMEI.
- Gateway (Admin SDK) only for writes.

**Composite Index:** `(imei, from ASC)` — for timeline queries.

---

### `devices/{imei}/journeys/{journeyId}`

Compressed movement routes. Gateway accumulates raw GPS points in memory during active travel and writes one polyline document per closed journey instead of hundreds of raw points. Polyline uses Google's precision-5 encoding.

| Field | Type | Notes |
|-------|------|-------|
| `startAt` | timestamp | Journey start (first GPS fix) |
| `endAt` | timestamp | Journey end (when closed) |
| `distanceKm` | number | Total path length along buffered points. |
| `polyline` | string | Google encoded polyline (precision 5) for route replay on map. |
| `events` | array \| absent | Optional inline event log: `[{ type: 'geofence_exit' \| 'geofence_enter' \| ..., geofenceId?, name?, at: timestamp }, ...]`. |
| `pointCount` | number | Number of raw GPS fixes buffered before compression. |
| `compressed` | boolean | Always `true` for gateway-written docs (reserved for future client-uploaded routes). |
| `closeReason` | string | Why journey was closed: `'idle'` (≥ 15 min stationary), `'geofence_exit'`, `'daily_boundary'` (midnight), `'disconnect'` (TCP loss). |
| `createdAt` | timestamp | When this journey document was written (after journey closed). |

**Triggers:** Gateway closes journey when:
- Device idles ≥ 15 min (default `JOURNEY_IDLE_MINUTES`) after last movement.
- Device exits a geofence.
- Calendar day boundary (midnight).
- TCP session disconnects.

**Access:**
- Clients may read if linked to the IMEI.
- Gateway (Admin SDK) only for writes.

**Composite Index:** `(imei, startAt DESC)` — for timeline queries (most recent journeys first).

---

## Operational/Internal Collections

These collections are used for internal operations and monitoring; not part of the core Guardian feature set.

### `ops/metrics` (document)

Live metrics snapshot (aggregated counts, rates).

### `ops/metrics/daily/{date}` (subcollection)

Daily rollup of metrics (one doc per calendar day, e.g., `"2026-07-28"`).

| Example Fields |
|----------------|
| `date` | Calendar date string |
| `alertCount` | Total alerts created on this day |
| `sosCount`, `fallCount`, `offlineCount`, etc. | Per-type alert counts |
| `firestoreWriteCount` | Number of Firestore writes |
| `peakOnlineDevices` | Maximum concurrent online devices |

**Access:** Gateway (Admin SDK) only.

---

### `ops/finance/config/assumptions` (document)

Configuration assumptions used by billing/finance modules (if future payment system is integrated).

---

## Document Relationships

### Ownership Graph

```
users/{uid}
├─ owns: linkedImeis → devices/{imei}
├─ creates: geofences/{id}
├─ creates: medicationReminders/{id}
├─ creates: deviceCommands/{id}
├─ creates: invites/{id}
└─ receives: familyMembers (added by acceptors)

devices/{imei}
├─ referenced by: users/{uid}.linkedImeis
├─ has subcollections:
│  ├─ locations/{id}
│  ├─ segments/{id}
│  └─ journeys/{id}
└─ targeted by:
   ├─ geofences/{id}
   ├─ alerts/{id}
   ├─ deviceCommands/{id}
   ├─ medicationReminders/{id}
   └─ notificationLogs/{id}

invites/{id}
├─ createdBy → users/{uid}
└─ acceptedBy → users/{uid}
   └─ links acceptor to devices from inviter

geofences/{id}
├─ targets → devices/{imei}
└─ createdBy → users/{uid}

alerts/{id}
├─ triggered by → devices/{imei}
└─ resolved by → users/{uid}

deviceCommands/{id}
├─ targets → devices/{imei}
└─ createdBy → users/{uid}

medicationReminders/{id}
├─ targets → devices/{imei}
└─ createdBy → users/{uid}

notificationLogs/{id}
└─ documents delivery for → devices/{imei}
```

### Query Patterns

**Find all devices for a user:**
```javascript
db.collection('users').doc(uid).get()
  .then(doc => doc.data().linkedImeis)
  // Then: db.collection('devices').doc(imei).get() for each IMEI
```

**Find all alerts for a device (recent first):**
```javascript
db.collection('alerts')
  .where('imei', '==', imei)
  .orderBy('createdAt', 'desc')
  .limit(50)
  .get()
```

**Find all geofences for a device:**
```javascript
db.collection('geofences')
  .where('imei', '==', imei)
  .where('active', '==', true)
  .get()
```

**Find all journeys for a device (recent first):**
```javascript
db.collection('devices').doc(imei)
  .collection('journeys')
  .orderBy('startAt', 'desc')
  .limit(10)
  .get()
```

**Find all segments for a device (timeline):**
```javascript
db.collection('devices').doc(imei)
  .collection('segments')
  .orderBy('from', 'asc')
  .get()
```

---

## Write Patterns & Triggers

### Gateway Write Gate (Phase 0.5)

Gateway holds a full in-memory GPS stream and writes to Firestore only on meaningful events to reduce costs and contention.

| Trigger | Firestore Action | Note |
|---------|------------------|------|
| Device moved ≥ 50 m (default) | Upsert `devices/{imei}.location`; optional `locations` subcollection entry | Write-gate threshold |
| Battery integer changed | Upsert `batteryPercent` | Any %, not on fractional |
| SOS \| fall \| low_battery alarm | Always upsert + create alert | Alarms always persist |
| Geofence enter/exit | Always upsert + create alert + notify | Zone transitions always noted |
| Heartbeat (5 min default) while stationary | Upsert `lastHeartbeatAt`, `online` | Keeps device "alive" |
| First GPS fix after TCP connect | Always upsert location | Connection proof |
| Dwell ≥ 10 min stationary | Write `devices/{imei}/segments/{id}` | Segment only at dwell end |
| Journey closes | Write `devices/{imei}/journeys/{id}` (polyline) | Compressed route, not raw points |
| TCP login/disconnect | Upsert `online`, `connectionState`; flush dwell + journey | State transition |

### Geofence Evaluation

- Runs on **every valid GPS fix** in memory (even if Firestore write skipped).
- Entry/exit creates `alerts` + notifies emergency contacts (SMS/WhatsApp) + notifies guardians (push).
- Notification narrowing: emergency contacts receive **SOS, fall, geofence_exit only** (not enter, battery, offline). This is intentional (`shouldSms` vs `shouldNotify` in `firestore.js`).

### Intelligence Refresh

- Evaluated on every GPS tick; persisted only on alarm or Firestore write.
- Runs independently every `INTELLIGENCE_CHECK_INTERVAL_MS` (e.g., 30 sec) to detect offline/stale devices.
- Creates `offline` alert when heartbeat gap exceeds threshold (with cooldown to avoid spam).

### Notification Watchers

**Alert Watcher:** `startPendingAlertWatcher()`
- Watches `alerts.notifyStatus == 'pending'`.
- Delivers push to guardians (FCM) + SMS/WhatsApp to emergency contacts.
- Updates `notifyStatus` → `'sent'` \| `'failed'` and sets `notifiedAt`.

**Command Watcher:** `startPendingCommandWatcher()`
- Watches `deviceCommands.status == 'pending'`.
- Calls `sendDeviceCommand()` to deliver via SMS (V28C) or TCP (V46/V48/V52).
- Updates `status` → `'sent'` \| `'failed'`, sets `result`, clears pending state.

---

## Composite Indexes

Required composite indexes are defined in `firestore/firestore.indexes.json` and must be deployed via Firebase CLI or console.

| Collection | Fields | Purpose |
|------------|--------|---------|
| `alerts` | `imei` (ASC), `createdAt` (DESC) | Efficient alert timeline queries (`where imei = ? orderBy createdAt desc limit N`) |
| `journeys` | `imei` (ASC), `startAt` (DESC) | Recent journeys first (`where imei = ? orderBy startAt desc limit N`) |
| `segments` | `imei` (ASC), `from` (ASC) | Timeline of dwells (`where imei = ? orderBy from asc`) |

**Deployment:**
```bash
firebase deploy --only firestore:indexes
```

If indexes are out of sync, Firestore will reject the query with a link to auto-create the missing index.

---

## Access Control (Security Rules)

See `firestore/rules.example` for the canonical rules. Key patterns:

### Authentication & Linking

```javascript
function signedIn() {
  return request.auth != null;
}

function userDoc() {
  return get(/databases/$(database)/documents/users/$(request.auth.uid)).data;
}

function linkedTo(imei) {
  return signedIn() && imei in userDoc().linkedImeis;
}
```

All document-level access requires `linkedTo(imei)` (except `users/{uid}` and `invites`).

### Collection-Level Rules

| Collection | Read | Create | Update | Delete |
|------------|------|--------|--------|--------|
| `users/{uid}` | Own doc only | Own doc on signup | Own profile fields (avatar, name, phone) | Not allowed |
| `devices/{imei}` | If linked | Not allowed (gateway only) | Linked + approved fields only (`nickname`, `relationship`, `avatarUrl`, `simNumber`, `fallDetection`, `locationReportingIntervalSeconds`) | Not allowed |
| `geofences/{id}` | If linked to `imei` | If linked + set `createdBy` to own UID | If linked + own creation | If linked + own creation |
| `alerts/{id}` | If linked to `imei` | Linked + SOS only (restricted schema) | Linked + `resolved`/`resolvedAt` only | Not allowed |
| `deviceCommands/{id}` | If linked to `imei` | Linked + set `createdBy` to own UID + `status: 'pending'` | Not allowed (gateway only) | Not allowed |
| `medicationReminders/{id}` | If linked to `imei` | Linked + set `createdBy` to own UID | Linked + own creation | Linked + own creation |
| `invites/{id}` | All signed-in users | Own invites + `status: 'pending'` | Own invites or accept (status → `'accepted'`) | Own invites |
| `notificationLogs/{id}` | If linked to `imei` | Not allowed (gateway only) | Not allowed | Not allowed |

### Special Rules

**Family Invite Acceptance:**
```javascript
function selfJoiningFamilyCircle(inviterUid) {
  let newMembers = request.resource.data.get('familyMembers', []);
  let oldMembers = resource.data.get('familyMembers', []);
  return signedIn()
    && request.auth.uid != inviterUid  // Not the inviter
    && only([familyMembers, updatedAt]) changed  // Surgical update
    && newMembers.size() == oldMembers.size() + 1  // Exactly one added
    && newMembers[...].uid == request.auth.uid;  // Self-added
}
```

**App SOS Alert:**
Clients may create `alerts` with type `'sos'` and severity `'critical'` only, with a restricted schema (no arbitrary payloads).

---

## Implementation Notes

### Deviations from SCHEMA.md

**1. Additional Fields in `devices/{imei}`:**

The gateway implementation adds fields not documented in SCHEMA.md:
- `connectionState`: `'live'` \| `'connecting'` \| `'offline'` (more precise than boolean `online`).
- `disconnectedAt`: Timestamp when device went offline (deleted when online again).
- `connectingAt`: Timestamp when entering connecting state (cleared when online).

These are managed by `upsertDevice()` logic in `firestore.js` and should be documented in schema updates.

**2. Legacy `protocolId` Field:**

If a device was stored under a different protocol ID (e.g., GT06 variant), `migrateLegacyDeviceDoc()` preserves the old ID in `protocolId` and stores the canonical IMEI as the doc ID. This allows tracing protocol migrations but adds complexity.

**3. Alert `title` Field:**

Some alerts include a `title` field (short push-notification summary) not listed in SCHEMA.md. Example: offline alert copy from `buildOfflineAlertCopy()`.

### Write History Features

**Locations Subcollection:** Only written if `WRITE_LOCATION_HISTORY=true` (default: `false`). Gated by environment config; verify `.env` before expecting history.

**Segments & Journeys:** Always written for online/active devices. No config gate.

### Firestore Admin SDK

Gateway uses Admin SDK (`admin.initializeApp()` with service account key) to bypass security rules. This grants full read/write access to all collections. Protect the service account key; restrict its IAM permissions to Firestore only in GCP.

### Dry-Run Mode

When `FIRESTORE_DISABLED=true`, gateway logs all write operations to stdout without persisting to Firestore. Useful for testing protocol parsing without a real database.

### Device Presence Reconciliation

`reconcileStaleOnlineFlags()` runs on startup and periodically (~30 sec) to:
- Close stale TCP sessions (no packets for `TCP_SILENT_SECONDS`).
- Mark devices offline if they've exceeded `INTELLIGENCE_OFFLINE_MINUTES` without heartbeat.
- Prevent false `online` states after gateway restart.

---

## Summary

Guardian's Firestore schema is organized around **devices** (as central hubs) and their associated **telemetry** (locations, journeys, segments), **safety** (geofences, alerts), **communication** (commands, reminders), and **user management** (users, invites, family members).

The **gateway owns all device telemetry** (location, battery, online status, intelligence), while **clients own user preferences** (avatar, linked IMEIs, geofences, reminders, command requests).

Write operations are **gated by meaningful-event filters** to reduce costs and contention; geofence evaluation and intelligence checks run on every GPS tick regardless of Firestore persistence.

Security is enforced through **two-factor validation**: Firestore Security Rules (`linkedImeis` check) + client-side query filtering. Never loosen the `linkedTo(imei)` rule without careful security review.
