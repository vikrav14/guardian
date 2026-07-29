# Gateway Event Processing Loop

The gateway's core responsibility is **decoding GPS tracker protocol packets, evaluating geofences and alarms, persisting state to Firestore, and triggering notifications**. This document covers the event flow from device packet arrival through notification delivery and how Firestore listeners tie back into the system.

---

## Overview: The Event Processing Pipeline

```
TCP Socket receives data
    ↓
extractFrames() → buffer management
    ↓
decodeFrame() → parse GT06 protocol
    ↓
handlePacket() → interpret commands, generate events
    ↓
applyEvents() → orchestrate all side effects
    ├→ Firestore writes (device state, alerts, history)
    ├→ Geofence evaluation → transition alerts
    ├→ Dwell & journey tracking
    ├→ Write-gate filtering (throttle frequent fixes)
    ├→ Notification delivery (push, SMS, WhatsApp)
    └→ Intelligence evaluation & offline detection
```

All processing happens in `gateway/src/server.js` inside `applyEvents()`, which is called once per batch of decoded frames from a TCP client.

---

## 1. Location Events

**Trigger**: GPS position fix from the device.

**File**: `gateway/src/server.js` lines 286–512 (the `event.type === 'location'` block).

### Processing Steps

1. **Geolocation Resolution** (if needed)
   - If the device sends WiFi/cell-tower data without GPS lock (flag `V`), the gateway requests coordinates from Google's Geolocation API.
   - Result: `location` object with `lat`, `lng`, `accuracyMeters`, `recordedAt`, and `accuracySource` (gps, wifi, or lbs).

2. **Hemisphere Sanity Check**
   - `correctFleetHemisphere()` fixes the rare GPS hemisphere-sign glitch (e.g., east/west or north/south inverted). Applied once per fix.

3. **Live State Update**
   - In-memory cache in `gateway/src/live-cache.js` is updated with latest location, speed, and accuracy.

4. **Geofence Evaluation**
   - `evaluateGeofenceTransitions()` loads all active geofences for the IMEI, compares the new location against each, and detects enter/exit transitions (with a 60-second cooldown per transition to avoid alert flapping).
   - Each transition generates a `geofence_enter` or `geofence_exit` alert.
   - Transitions are passed to `createAlert()` to write the alert to Firestore and trigger immediate notification delivery.

5. **Dwell Tracking**
   - `trackPointForDwell()` accumulates points at the current location. When the device moves beyond a radius threshold or a time window expires, `flushDwellIfNeeded()` writes a segment document to `devices/{imei}/segments/`.

6. **Journey Tracking**
   - `trackPointForJourney()` builds a polyline of the device's route. When the device is stationary (low speed) for a threshold duration, `flushJourneyIfNeeded()` writes a journey document to `devices/{imei}/journeys/`.
   - Journey documents are used for route replay and cost analytics (distance traveled).

7. **Write Gate (Throttle)**
   - `shouldPersist()` decides whether the location warrants a Firestore write based on:
     - **First fix**: Always persist the first location of a session.
     - **Distance**: Persist if moved ≥ `writeGateMinMetres` (default 100m).
     - **Heartbeat cap**: Persist at least every `writeGateHeartbeatMinutes` (default 30 minutes), even if stationary.
     - **Geofence transition**: Persist immediately.
     - **Suspect jump**: If the fix is >250km from the last known location, hold it back one cycle. A corroborating fix is trusted immediately.
   - Reduces unthrottled ~2880–4320 fixes/day to ~100–400 persisted writes.

8. **Firestore Write**
   - `persistDeviceState()` → `upsertDevice()` writes:
     ```firestore
     devices/{imei} {
       online: true,
       lastHeartbeatAt: <now>,
       location: { lat, lng, accuracyMeters, recordedAt, accuracySource },
       speedKmh, course, batteryPercent,
       updatedAt: <server timestamp>
     }
     ```
   - If history is enabled (`WRITE_LOCATION_HISTORY=true`), also writes to `devices/{imei}/locations/` for route replay.

9. **Intelligence Refresh**
   - `refreshDeviceIntelligence()` evaluates device insights (battery forecast, offline detection, geofence status) and stores the result in `devices/{imei}.intelligence`.

10. **Presence Touch**
    - If the write gate skipped this fix but the TCP session is still live, `touchPresenceIfNeeded()` sends a lightweight update to keep `online: true` and prevent false offline alerts.

### Alert Output

- **Geofence transitions**: `type: 'geofence_enter'` or `'geofence_exit'`, severity `info`, written to `alerts/{alertId}`.

---

## 2. Heartbeat Events

**Trigger**: Device keep-alive packet (no position data, just battery/status).

**File**: `gateway/src/server.js` lines 514–580.

### Processing Steps

Similar to location but simpler:

1. Update live state with battery percent and accuracy source.
2. Apply write gate based on battery change or heartbeat cap.
3. If persisting, write `devices/{imei}` with updated `batteryPercent` and `lastHeartbeatAt`.
4. Refresh device intelligence.

### Alert Output

- No alerts generated directly; only used for battery trend analysis in intelligence.

---

## 3. Alarm Events (SOS, Fall, Low Battery)

**Trigger**: Device sends an alarm packet (SOS button, fall detection, low battery, etc.).

**File**: `gateway/src/server.js` lines 582–724.

### Alarm Types

Decoded by the GT06 protocol in `gateway/src/protocol/gt06.js`:
- `sos`: SOS button pressed.
- `fall`: Fall detected (V46/V48/V52 only).
- `low_battery`: Battery below threshold.
- `power_off`: Device powered off.
- `gps_offline`: GPS offline for extended time.
- `fence_in_out`: Geofence transitions (alternative to location-based).
- Other hardware-specific codes.

### Processing Steps

1. **Geolocation Resolution** (if applicable)
   - If the alarm includes WiFi/cell data without a GPS fix, resolve coordinates.

2. **Hemisphere Correction**
   - Apply fix if location is included.

3. **Live State Update**
   - Update in-memory cache with alarm location (if present).

4. **Firestore Write**
   - Write to `devices/{imei}`:
     ```firestore
     {
       online: true,
       lastAlarm: { type, at: <now>, raw: { alarmCode } },
       location, speedKmh, course, accuracySource (if present),
       lastHeartbeatAt: <now>
     }
     ```

5. **Alert Creation**
   - Immediately call `createAlert()` to write to `alerts/`:
     ```firestore
     {
       imei,
       type: 'sos' | 'fall' | 'low_battery' | ... (from alarmType),
       severity: 'warning' | 'urgent' (device-provided),
       message: 'Device alarm: <alarmType>',
       payload: { alarmCode (if raw alarm code was present) },
       resolved: false,
       notifyStatus: 'pending',
       createdAt: <server timestamp>
     }
     ```

6. **Location History**
   - Always append to `devices/{imei}/locations/` for audit trail.

7. **Intelligence Refresh**
   - Evaluate insights with alarm context (e.g., SOS affects priority).

### Alert Output

- **SOS**: `type: 'sos'`, severity `urgent`.
- **Fall**: `type: 'fall'`, severity `warning` or `urgent`.
- **Low Battery**: `type: 'low_battery'`, severity `warning`.
- Other codes produce `type: 'alarm'`, severity depends on payload.

---

## 4. Geofence Events

**Trigger**: Location evaluation detects device crossing a geofence boundary.

**File**: `gateway/src/geofence.js`.

### Evaluation Logic

```javascript
evaluateGeofenceTransitions(db, imei, location) {
  1. Load all active geofences for the IMEI from `geofences/` collection.
  2. For each geofence:
     - Calculate distance from location to geofence center.
     - Check if location is inside radius OR matches wifiSsid (if WiFi fence).
     - Compare to previous state. If transition occurred:
       - Skip if within 60-second cooldown window.
       - Emit enter/exit event.
  3. Return array of transition events.
}
```

### State Tracking

- In-memory map `insideState: Map<"${imei}:${geofenceId}", boolean>` tracks device inside/outside each fence.
- On first sample, state is seeded; no alert is generated.
- On subsequent samples, a state change triggers an alert (if not in cooldown).

### Alert Output

From `gateway/src/geofence.js` lines 74–87:

```javascript
// Enter
{
  type: 'geofence_enter',
  severity: 'info',
  message: `Entered safe zone: ${geofenceName}`,
  payload: { geofenceId, geofenceName }
}

// Exit
{
  type: 'geofence_exit',
  severity: 'warning', // higher priority for exits
  message: `Left safe zone: ${geofenceName}`,
  payload: { geofenceId, geofenceName }
}
```

---

## 5. Command Responses & Downlink Events

**Trigger**: Device confirms receipt of a command sent from the gateway.

**File**: `gateway/src/server.js` lines 776–796, and `gateway/src/protocol/gt06.js`.

### Command Types

#### SMS-Based Commands (V28C, all devices)
Defined in `gateway/src/commands.js`:
- `centerNumberCommand(phone)` → `pw,123456,center,<phone>#`
- `sosNumberCommand(slot, phone)` → `sos<1|2|3>,<phone>#`
- `statusCommand()` → `ts#`
- `voiceMonitorCommand(phone)` → `monitor,<phone>#` (unverified, RF-V28 source)
- `ringToFindCommand()` → `find#` (unverified, RF-V28 source)

#### TCP Downlink Commands (V46/V48/V52 only)
- `fallDetectionCommand({ enabled, dialMonitorOnFall })`
- `fallSensitivityCommand(level)` — sensitivity 0–6
- `medicationReminderCommand(time, frequency, weekMask, text, enabled)`

### Response Handling

1. **Command Echo**: If the device echoes back a server-sent command (because it received it over SMS or TCP), the gateway logs it and drops it (no re-ack).
   - `type: 'command_echo'`, logged but not stored.

2. **Unknown Command**: If the gateway receives a command code it doesn't recognize:
   - `type: 'unknown_command'`, logged.

3. **Firestore Listener** (see below):
   - When the mobile app creates a `deviceCommands/{commandId}` with `status: 'pending'`, the gateway's `startPendingCommandWatcher()` listener picks it up.
   - Gateway attempts to send via SMS or TCP.
   - On success: updates to `{ status: 'sent', result: outcome, completedAt }`.
   - On failure: updates to `{ status: 'failed', error: errorMessage, completedAt }`.

---

## 6. Firestore Listeners (Bidirectional Communication)

The gateway maintains two long-lived listeners on Firestore that drive downlink communication:

### Alert Watcher (`startPendingAlertWatcher`)

**File**: `gateway/src/firestore.js` lines 293–317.

```javascript
db.collection('alerts')
  .where('notifyStatus', '==', 'pending')
  .onSnapshot((snap) => {
    // Trigger delivery of push/SMS/WhatsApp for each pending alert
  });
```

**Trigger**: Mobile app or gateway creates an alert with `notifyStatus: 'pending'`.

**Action**: 
1. `deliverAlertNotifications()` processes the alert.
2. Claims the alert via transaction (set `notifyStatus: 'sending'`).
3. Sends push to guardians via FCM.
4. Sends SMS/WhatsApp to emergency contacts (only for SOS, fall, geofence_exit).
5. Updates alert to `{ notifyStatus: 'sent', notifiedAt }` or `'failed'`.

**Notification Filtering**:

From `gateway/src/firestore.js` lines 199–210:

```javascript
// Push notifications (to guardians' app)
shouldNotify(alert) {
  type ∈ ['sos', 'fall', 'geofence_exit', 'geofence_enter', 'low_battery', 'offline']
}

// SMS/WhatsApp (to emergency contacts — narrower)
shouldSms(alert) {
  type ∈ ['sos', 'fall', 'geofence_exit']  // Urgent only; no enter/low-battery
}
```

This is intentional: emergency contacts get only critical alerts (SOS/fall/exit), while guardians get richer notifications (enters, low battery) in the app.

### Command Watcher (`startPendingCommandWatcher`)

**File**: `gateway/src/firestore.js` lines 350–373.

```javascript
db.collection('deviceCommands')
  .where('status', '==', 'pending')
  .onSnapshot((snap) => {
    // Trigger delivery of command to device
  });
```

**Trigger**: Mobile app creates a `deviceCommands/{commandId}` with:
```firestore
{
  imei: "<device-id>",
  type: "set_sos_number" | "voice_monitor" | "fall_detection" | ...,
  params: { ... },
  status: "pending",
  createdAt: <timestamp>
}
```

**Action**:
1. `deliverDeviceCommand()` processes the command.
2. Claims via transaction (set `status: 'sending'`).
3. Calls `sendDeviceCommand()` to issue SMS or TCP downlink.
4. On success: updates to `{ status: 'sent', result: outcome, completedAt }`.
5. On failure: updates to `{ status: 'failed', error, completedAt }`.

**Socket-Based Delivery**: If the device has a live TCP session, commands can be sent over TCP (V46+). Otherwise, they fall back to SMS.

---

## 7. Device State Persistence

### Main Device Document

**Path**: `devices/{imei}`

**Schematic** (see `firestore/SCHEMA.md` for full spec):

```firestore
{
  // Identity
  imei: "<15-digit>",
  protocolId: "<10-digit>",
  fullImei: "<reconstructed>",
  
  // Connection
  online: true | false,
  connectionState: "live" | "offline" | "connecting",
  lastHeartbeatAt: <timestamp>,
  disconnectedAt: <timestamp>,
  
  // Location
  location: {
    lat, lng, accuracyMeters, recordedAt, accuracySource
  },
  speedKmh, course,
  
  // Battery
  batteryPercent: <0–100>,
  batteryTrend: "charging" | "discharging" | "stable",
  batteryForecastHours: <number>,
  
  // Recent alarm
  lastAlarm: {
    type, at, raw: { alarmCode }
  },
  
  // Intelligence (computed server-side)
  intelligence: {
    updatedAt,
    insights: [
      { id: "offline", confidence, suppressBelow, message },
      { id: "battery_low", ... },
      ...
    ],
    topInsight: <highest-priority insight>
  },
  
  updatedAt: <server timestamp>
}
```

### Historical Collections

- **`devices/{imei}/locations/`**: Per-location history (if `WRITE_LOCATION_HISTORY=true`).
  ```firestore
  { lat, lng, speedKmh, accuracySource, recordedAt, createdAt }
  ```

- **`devices/{imei}/segments/`**: Dwell periods (stationary at a location).
  ```firestore
  { placeName, lat, lng, startedAt, endedAt, durationMinutes, createdAt }
  ```

- **`devices/{imei}/journeys/`**: Route segments (collections of location fixes forming a trip).
  ```firestore
  { polylineEncoded, pointCount, distanceKm, startedAt, closedAt, closeReason, createdAt }
  ```

### Write Filtering (Write Gate)

Implemented in `gateway/src/live-cache.js`, `shouldPersist()` function.

```
persist if:
  - eventType === 'alarm' (always)
  - eventType === 'location' && pendingFirstFix (first fix of session)
  - eventType === 'location' && movedEnough (>= minMetres)
  - eventType === 'location' && geofenceTransition
  - eventType === 'heartbeat' && batteryChanged (integer percent changed)
  - eventType === 'heartbeat' && heartbeatCapDue (>= heartbeat interval)

Otherwise:
  - recordSkip()
  - touchPresenceIfNeeded() (keep online flag fresh if TCP session still live)
```

---

## 8. Notification Delivery

### Push Notifications (FCM)

**File**: `gateway/src/push.js`.

Flow:
1. `notifyGuardianDevices(db, imei, alert)`:
   - Query `users/` collection: find all guardians who have `imei` in `linkedImeis[]`.
   - Collect FCM tokens from each guardian's `fcmTokens[]`.
   - Build Firebase Cloud Messaging multicast payload.
   - Send via `admin.messaging().sendEachForMulticast()`.
   - Prune dead tokens from `users/{uid}.fcmTokens` based on FCM response.

2. **Message Format**:
   ```
   title: "SOS alert" | "Possible fall detected" | "Left safe zone" | ...
   body: alert.message || "Device <IMEI>"
   data: { imei, type: alert.type }
   ```

3. **Delivery Guarantee**: Best-effort. Logged, but not retried if FCM fails.

### SMS & WhatsApp Notifications

**File**: `gateway/src/notify.js`.

Flow:
1. `notifyEmergencyContacts(db, imei, alert)`:
   - Query `users/` to find guardians linked to `imei`.
   - Collect `emergencyContacts[]` from each guardian's user document.
   - For each contact, attempt SMS and/or WhatsApp (via Twilio).

2. **Message Format**:
   ```
   "Guardian <ALERT_TYPE>: <message>\nDevice IMEI <imei>"
   ```

3. **Channels**:
   - SMS: requires `TWILIO_FROM_SMS` configured.
   - WhatsApp: requires `TWILIO_WHATSAPP_FROM` configured.
   - If Twilio is not configured, skipped gracefully.

4. **Delivery Guarantee**: Logged in `notificationLogs/` collection. Retries handled by Twilio.

---

## 9. Protocol Decoding & Event Generation

**File**: `gateway/src/protocol/gt06.js`.

The GT06 protocol is shared by the V28C and V46/V48/V52 device families (documented in the vendor's datasheets). Frames have the structure:

```
[CS*YYYYYYYYYY*LEN*command,data...]
```

- **CS**: 2-byte factory code (e.g., "3G", "SG").
- **YYYYYYYYYY**: 10-digit protocol ID (not full 15-digit IMEI).
- **LEN**: 4-char ASCII hex length.
- **command,data**: Payload (e.g., `LK,ddmmyy,hhmmss,A,lat,NS,lng,EW,speed,course,...`).

### Supported Uplink Commands

- **LK**: Location (GPS or WiFi/LBS fallback).
- **UD_LTE**: Location with LTE extras (cell tower + WiFi data).
- **AL_LTE**: Alarm with LTE data.
- **HB**: Heartbeat (battery, status, no location).
- **VERNO**: Version/IMEI report (full 15-digit IMEI).

### Event Types Emitted

- `location`: Position fix, speed, course, accuracy source.
- `heartbeat`: Battery, status.
- `alarm`: SOS, fall, low battery, power off, GPS offline, etc.
- `imei_report`: Full IMEI extracted from VERNO response.
- `command_echo`: Device echoed back a server-sent command.
- `location_parse_error`: GPS flag invalid, WiFi/LBS data insufficient.
- `parse_error`: Malformed frame.
- `crc_error`: Checksum mismatch (frame discarded).

---

## 10. Device Connect/Disconnect Lifecycle

### On Connect

**File**: `gateway/src/connection-handshake.js`, `gateway/src/live-cache.js`.

1. TCP socket accepted, session registered.
2. First packet's IMEI extracted → `maybeAnnounceConnecting()`:
   - Set `devices/{imei}.connectionState = 'connecting'`.
   - Seed last-known location in live cache (jump-sanity check).
3. `onDeviceConnect()`: Reset `pendingFirstFix` flag in live cache.
4. First location write sets `online: true, connectionState: 'live'`.

### On Disconnect

**File**: `gateway/src/device-offline.js`.

1. TCP socket closed.
2. `onDeviceDisconnect()`: Wipe live cache (in-memory state reset).
3. Flush pending dwell & journey to Firestore.
4. If device reached "live" state (≥ SESSION_LIVE_PACKETS packets), schedule offline alert:
   - Delay: `config.offlineDebounceMs` (default 5 minutes).
   - After delay, if still offline, `createAlert()` with `type: 'offline'`.
   - This allows brief reconnects without spurious offline alerts.

---

## 11. Intelligence Evaluation & Offline Detection

**File**: `gateway/src/intelligence/index.js`.

After each persisted state update, `refreshDeviceIntelligence()` evaluates:

1. **Offline Detection**
   - If `lastHeartbeatAt` > `offlineMinutes` (default 10 min) → high-confidence offline insight.
   - Cooldown: only alert once per `offlineAlertCooldownMinutes` (default 30 min).

2. **Battery Forecasting**
   - Track battery samples over time.
   - If discharge trend detected and battery will deplete within forecast window → `battery_low` insight.

3. **Geofence Status**
   - Determine home geofence (named "home" or singleton).
   - Report if device is inside/outside.

4. **Insights Array**
   - Each insight has `id`, `confidence` (0–100), `suppressBelow` (threshold), `message`, `level` (urgent, warning, info).
   - Sorted by priority; top one stored in `devices/{imei}.intelligence.topInsight`.

---

## Summary: Event Type → Action Matrix

| Event Type | Source | Firestore Write | Geofence Check | Alert? | Push? | SMS? | History? |
|---|---|---|---|---|---|---|---|
| **location** | GPS fix | ✓ (if gate passes) | ✓ | if geofence transition | ✓ | ✓ (exit) | if enabled or gate reason |
| **heartbeat** | Keep-alive | ✓ (if gate passes) | ✗ | ✗ | ✗ | ✗ | ✗ |
| **alarm** (SOS/fall/etc) | Device button/sensor | ✓ (always) | ✗ | ✓ | ✓ | ✓ (SOS/fall/exit) | ✓ (always) |
| **geofence_enter** | Location evaluation | ✓ (as part of location) | — | ✓ | ✓ (enter) | ✗ | — |
| **geofence_exit** | Location evaluation | ✓ (as part of location) | — | ✓ | ✓ (exit) | ✓ (exit) | — |
| **command_echo** | Device echo-back | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ (log only) |
| **offline** (intelligence) | Absence timer | ✓ (alert doc) | ✗ | ✓ | ✓ | ✗ | ✗ |

---

## Configuration Tuning

**File**: `gateway/src/config.js` and `gateway/.env`.

### Write Gate Thresholds
- `WRITE_GATE_MIN_METRES` (default 100): distance threshold before persisting location.
- `WRITE_GATE_HEARTBEAT_MINUTES` (default 30): max time between updates even if stationary.
- `WRITE_GATE_HISTORY_MINUTES` (default 60): min interval for location history appends.

### Dwell & Journey
- `DWELL_MIN_MINUTES` (default 5): minimum stationary time before creating a segment.
- `JOURNEY_IDLE_MINUTES` (default 10): idle time before closing a journey.

### Offline Detection
- `INTELLIGENCE_OFFLINE_MINUTES` (default 10): offline threshold.
- `INTELLIGENCE_OFFLINE_ALERT_COOLDOWN_MINUTES` (default 30): alert suppression window.

### Notifications
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_SMS`, `TWILIO_WHATSAPP_FROM`: Twilio credentials.
- If not set, SMS/WhatsApp delivery is skipped gracefully.

---

## Common Debugging Patterns

### Why didn't an alert send?
1. Check `notifyStatus` in `alerts/` collection:
   - `pending` → watcher hasn't run yet, or claim transaction failed.
   - `sending` → in progress.
   - `sent` → completed; check `notifiedAt`.
   - `failed` → check `notifyError`.
2. Check `shouldNotify()` & `shouldSms()` logic: alert type may be filtered.
3. Check FCM tokens: `users/{uid}.fcmTokens` must be non-empty.
4. Check Twilio config: `TWILIO_FROM_SMS` and `TWILIO_WHATSAPP_FROM` must be set.

### Why is location not persisting?
1. Check `online` flag: if false, device is offline (no TCP session).
2. Check write gate: location must move ≥ `WRITE_GATE_MIN_METRES` or be first fix.
3. Check `lastHeartbeatAt`: if write gate is skipping, this still updates.
4. Check `live-cache.js` logs: `[write-gate]` lines show why a fix was skipped.

### Why is a geofence not triggering?
1. Geofence must be `active: true` in Firestore.
2. Geofence radius must be set (`radiusMeters`, default 150m).
3. State must transition: device must move from outside → inside or vice versa.
4. Check cooldown: 60-second per-transition minimum between alerts.
5. Check accuracy: if GPS accuracy is poor or unavailable, distance calc may be unreliable.

### Why is the device showing offline?
1. Check TCP session: if socket is closed, device is offline.
2. Check `disconnectedAt` timestamp: when did the session end?
3. Check intelligence: `topInsight.id === 'offline'` if above offline threshold.
4. Check `offlineDebounceMs`: offline alert is delayed to avoid false positives on brief reconnects.

---

## Testing & Simulation

**File**: `gateway/src/simulator.js` (if present) or `npm run simulate`.

Simulates a device near Quatre Bornes, Mauritius, sending periodic location updates to test the full pipeline locally.

---

## Further Reading

- **SCHEMA.md**: Firestore document structure and field reference.
- **GT06 Protocol Docs**: `docs/reference/` (vendor datasheets).
- **CLAUDE.md**: Hard rules on unverified commands.
