# Location Data Pipeline

**Last updated:** 2026-07-29

The location pipeline is the core flow that brings GPS data from the pendant into the app. It combines protocol decoding, optional history storage, geofence evaluation, alert generation, and real-time synchronization.

## Overview

```
Device sends UD/UD2 packet
    ↓
Gateway receives TCP frame
    ↓
Parse GT06 packet (protocol/gt06.js)
    Extract: IMEI, lat, lng, speed, course, timestamp, accuracy source
    ↓
Resolve geolocation (if needed)
    WiFi/LBS data → Google geolocation API
    ↓
Update live state cache
    Track location for journey/dwell/hemisphere correction
    ↓
Evaluate geofence transitions
    Compare to previous location
    Generate enter/exit alerts
    ↓
Apply write gate (live-cache.js)
    Distance threshold: 50m default (WRITE_GATE_MIN_METRES)
    Heartbeat cap: 5 min default (WRITE_GATE_HEARTBEAT_MINUTES)
    ↓
Persist to Firestore if threshold met
    Update: devices/{imei}.lastLocation
    Optionally write: devices/{imei}/locations/{docId} (if WRITE_LOCATION_HISTORY=true)
    ↓
Publish alerts
    Create: alerts/{docId}
    Notify: guardians (FCM push) + emergency contacts (SMS/WhatsApp)
    ↓
Mobile app syncs via Firestore listener
    devices/{imei} snapshot
    alerts collection listener
```

---

## 1. Device Sends UD/UD2 Packet

### UD: Real-Time Location Upload

When the pendant detects movement or on a periodic interval, it sends a UD (location update) packet:

```
[SG*9705314117*003D*UD,280726,141530,A,2012.3441,S,05732.1256,E,12.5,045]
          └─ Protocol ID (10 digits)
                      └─ Packet length (hex)
                          └─ Command: UD
                              └─ Location data: date, time, GPS flag, lat, lng, speed, course
```

**Fields:**
- `date` (DDMMYY): Day/month/year
- `time` (HHMMSS): Hour/minute/second
- `gpsFlag` (A|V): "A" = valid GPS fix, "V" = WiFi/LBS data only
- `lat`: Latitude in DDMM.MMMM format (degrees and minutes)
- `latDir` (N|S): North or South
- `lng`: Longitude in DDDMM.MMMM format
- `lngDir` (E|W): East or West
- `speed`: Speed in km/h
- `course`: Heading in degrees (0-360)
- Optional LTE extras: WiFi SSIDs and cell tower info (for geolocation fallback)

### UD2: Blind-Spot Re-upload

When the device reconnects after losing signal, it sends buffered locations as UD2 packets. Same format as UD, but:
- **No server ACK** — the protocol doc says "Server no need reply"
- Marked internally as `blindSpotReupload: true` to distinguish from live fixes
- May arrive in quick succession (6-12 locations from a 1-hour offline gap)

---

## 2. Gateway Receives and Parses

### TCP Frame Extraction

The gateway's TCP server receives binary data and extracts frames:

```javascript
// File: src/protocol/gt06.js
// extractFrames(buffer)
// Finds all complete [frame] sequences
// Returns: { frames: [...], rest: remainder }
```

Multiple frames can arrive in one TCP packet:
```
[SG*...*...*UD,...] [SG*...*...*LK,...] [SG*...*...*AL,...]
```

### GT06 Protocol Decoding

The `decodeFrame()` function parses each frame:

```javascript
{
  factory: "SG",           // Vendor code
  imei: "9705314117",      // 10-digit protocol ID
  command: "UD",           // Packet type
  args: ["280726", "141530", "A", "2012.3441", "S", "05732.1256", "E", "12.5", "045"],
  payload: "UD,280726,141530,A,..."
}
```

### Location Data Parsing

The `parseLocationData()` function extracts structured location data:

```javascript
{
  gpsValid: true,           // A/V flag
  location: {
    lat: -20.2057,          // Converted from DDMM.MMMM
    lng: 57.5354,           // Converted from DDDMM.MMMM
    altitude: null,
    recordedAt: Date,       // UTC timestamp
    satellites: null        // Not populated from GT06
  },
  speedKmh: 12.5,
  course: 45,
  accuracySource: "gps"     // One of: gps, wifi, lbs, unknown
}
```

### Non-GPS Fallback (WiFi/LBS)

If `gpsFlag = 'V'` (invalid/no fix), the packet contains WiFi SSIDs and cell towers:

```javascript
// args[9+]: WiFi access points and cell tower info
{
  gpsValid: false,
  positioningMode: "wifi" | "lbs",  // Which data type was available
  wifiAccessPoints: [
    { ssid: "HomNetwork_5G", signalStrength: -45 },
    { ssid: "CoffeeShop_WiFi", signalStrength: -60 }
  ],
  cellTowers: [
    { mcc: 617, mnc: 20, lac: 1234, cid: 56789 }
  ],
  needsGeolocation: true,          // Requires Google Geolocation API call
  location: {
    lat: null,                      // Will be filled by geolocation
    lng: null,
    recordedAt: Date
  },
  accuracySource: "wifi" | "lbs"
}
```

---

## 3. Geolocation Resolution

If the device doesn't have a GPS fix (`needsGeolocation: true`), the gateway calls Google's Geolocation API:

```javascript
// File: src/geolocate/google.js
// geolocateFromV({ wifiAccessPoints, cellTowers })

await geolocateFromV({
  wifiAccessPoints: [...],
  cellTowers: [...]
});

// Returns:
{
  lat: -20.2057,
  lng: 57.5354,
  accuracyMeters: 150  // How far off the fix might be
}
```

**Logged output:**
```
[geolocate] 869362024567890 wifi=3 cells=2 → -20.206, 57.535 acc=150m
```

This is a best-effort fallback when the pendant can't lock onto satellites (indoors, urban canyon, etc.).

---

## 4. Fleet Hemisphere Correction

After geolocation (or after any valid GPS fix), the location is checked for hemisphere sign errors:

```javascript
// File: src/fleet-hemisphere.js
// correctFleetHemisphere(event)

// Some real V28C devices send lat/lng with inverted signs due to
// firmware bugs. This function detects and corrects hemisphere flips.

if (lastLocation && distance > HEMISPHERE_FLIP_THRESHOLD) {
  // Suspect a sign error; flip lat/lng and retry
  correctedDistance = haversine(flip(lat), flip(lng), lastLocation);
  if (correctedDistance < distance) {
    // Flipped version is closer to last known location → use it
    lat = -lat;
    lng = -lng;
  }
}
```

This prevents the device from suddenly "teleporting" to the opposite hemisphere due to a firmware error.

---

## 5. Live State Cache Update

The location is cached in memory for fast access and to compute derived metrics:

```javascript
// File: src/live-cache.js
// updateLiveState(imei, { location, speedKmh, accuracySource })

// Stored internally:
{
  [imei]: {
    location: { lat, lng, recordedAt },
    speedKmh: 12.5,
    accuracySource: "gps",
    lastHeartbeatAt: Date,
    batteryPercent: 85,
    // ... and more fields for journey/dwell tracking
  }
}
```

This cache is used by:
- **Write gate logic** — to decide if this location is different enough to persist
- **Journey builder** — to track segments of movement
- **Dwell detector** — to identify stationary periods
- **Device presence tracker** — to detect stale online flags

---

## 6. Geofence Evaluation

Once the location is known, the gateway checks all active geofences for this device:

```javascript
// File: src/geofence.js
// evaluateGeofenceTransitions(db, imei, location)

// For each active geofence:
{
  1. Load from Firestore: geofences/{id} where imei == device && active == true
  2. Calculate distance = haversine(device.lat/lng, zone.lat/lng)
  3. Determine: inside = distance <= zone.radiusMeters
  4. Compare to insideState[`${imei}:${geofenceId}`]
  5. If state changed:
     - Generate enter/exit alert
     - Apply cooldown (60s) to prevent flapping
     - Return alert event
}
```

**Geofence Structure:**
```javascript
// firestore: geofences/{id}
{
  imei: "869362024567890",
  name: "Home",
  active: true,
  center: {
    lat: -20.2057,
    lng: 57.5354
  },
  radiusMeters: 100,
  wifiSsid: "HomeNetwork_5G" // Optional: WiFi-based zone
}
```

**Alert Generated:**
```javascript
{
  type: "geofence_exit",        // or "geofence_enter"
  severity: "warning",           // or "info" for enter
  message: "Left safe zone: Home",
  payload: {
    geofenceId: "geofence_001",
    geofenceName: "Home",
    distanceMeters: 450,
    viaWifi: false,
    source: "gateway"
  }
}
```

**WiFi-Based Zones (Ready, Not Deployed):**
The code checks `location.wifiSsid` to support indoor WiFi geofences, but:
- The GT06 decoder does **not** currently extract SSID from device packets
- Vendor docs don't document the packet format for WiFi SSID
- This feature is structurally ready but awaiting protocol update

---

## 7. Write Gate: Persistence Decision

The gateway doesn't persist every location. Instead, it applies a write gate to reduce Firestore writes (cost + network traffic). Three rules decide if a location is persisted:

### Rule 1: Distance Threshold (Default: 50m)

```
WRITE_GATE_MIN_METRES=50
```

If the device has moved >= 50 meters since the last persisted location, persist.

### Rule 2: Heartbeat Cap (Default: 5 minutes)

```
WRITE_GATE_HEARTBEAT_MINUTES=5
```

If 5 minutes have passed since the last persisted location (even if device hasn't moved), persist.

### Rule 3: Event Triggers (Forced Persist)

Certain events bypass the gate and always persist:
- **First fix:** Device just came online
- **Geofence transition:** Enter/exit detected
- **Alarm:** Fall detection, SOS, low battery
- **Session forced persist:** First 2 packets on a new TCP session (ensures initial connection syncs)

### Code Logic

```javascript
// File: src/live-cache.js
// shouldPersist(imei, { eventType, location, batteryPercent, geofenceTransition })

const gate = {
  persist: false,
  reason: null,
  appendHistory: false
};

if (geofenceTransition) {
  gate.persist = true;
  gate.reason = "geofence_transition";
  gate.appendHistory = true;
}

const distance = haversine(lastLocation, currentLocation);
if (distance >= WRITE_GATE_MIN_METRES) {
  gate.persist = true;
  gate.reason = "movement";
  gate.appendHistory = true;
}

const timeSinceLastPersist = now - lastPersistAt;
if (timeSinceLastPersist >= WRITE_GATE_HEARTBEAT_MINUTES * 60 * 1000) {
  gate.persist = true;
  gate.reason = "heartbeat_cap";
  gate.appendHistory = false;  // ← Don't create separate history doc
}

return gate;
```

**Logged output:**
```
[write-gate] persist 869362024567890 reason=movement
[write-gate] skipped 869362024567890 reason=distance_insufficient
```

### Session Persistence Override

When a new TCP connection is made, the first `SESSION_LIVE_PACKETS=2` location packets always persist to Firestore, even if they fail the gate. This ensures:
1. Initial connection shows up in the app immediately
2. Device state reaches `online: true, connectionState: "live"` after 2 packets
3. "Connecting" state in the app is brief and informative

---

## 8. Firestore Write Operations

### Update: devices/{imei}.lastLocation

**Always updated** (unless Firestore is disabled):

```javascript
await upsertDevice(imei, {
  online: true,
  connectionState: "live",
  lastHeartbeatAt: new Date(),
  location: {
    lat: -20.2057,
    lng: 57.5354,
    speedKmh: 12.5,
    course: 45,
    accuracySource: "gps",
    recordedAt: Date
  },
  batteryPercent: 85
});
```

This is what the app reads from `listeners.watchLinkedDevices()` for real-time location updates.

### Write: devices/{imei}/locations/{docId}

**Conditionally written** based on:
1. `WRITE_LOCATION_HISTORY=true` (environment variable)
2. `shouldAppendLocationHistory(gate)` — gate reason permits it
3. Firestore must be enabled

```javascript
// File: src/firestore.js
// appendLocation(imei, point)

if (!config.writeLocationHistory) return;  // ← CRITICAL: Can be disabled

await db
  .collection("devices")
  .doc(imei)
  .collection("locations")
  .add({
    lat: -20.2057,
    lng: 57.5354,
    speedKmh: 12.5,
    accuracySource: "gps",
    recordedAt: Date  // Device's timestamp, not server time
  });
```

**When History is NOT Written:**
- `WRITE_LOCATION_HISTORY=false` (default)
- Reason is `heartbeat_cap` (keep-alive only, not movement)

This reduces Firestore storage by ~90% for stationary devices while keeping real-time position accurate.

### Create: alerts/{docId}

If geofence or other triggers fire:

```javascript
await createAlert(imei, {
  type: "geofence_exit",        // | "geofence_enter" | "sos" | "fall" | etc
  severity: "warning",           // | "info" | "critical"
  title: "Left safe zone",
  message: "Device left 'Home' at 14:35",
  payload: {
    geofenceId: "geofence_001",
    geofenceName: "Home",
    distanceMeters: 450,
    viaWifi: false,
    source: "gateway"
  }
});

// Firestore doc:
{
  imei: "869362024567890",
  type: "geofence_exit",
  severity: "warning",
  title: "Left safe zone",
  message: "Device left 'Home' at 14:35",
  payload: {...},
  resolved: false,
  notifyStatus: "pending",
  createdAt: <timestamp>
}
```

---

## 9. Alert Notification Delivery

Once an alert is created, the gateway immediately tries to deliver it:

### Delivery Rule: shouldNotify() vs shouldSms()

```javascript
function shouldNotify(alert) {
  // Push notifications to caregiver app for these alert types:
  return ["sos", "fall", "geofence_exit", "geofence_enter", "low_battery", "offline"].includes(alert.type);
}

function shouldSms(alert) {
  // SMS/WhatsApp to emergency contacts for urgent subset only:
  return alert.type === "sos" || alert.type === "fall" || alert.type === "geofence_exit";
}
```

**Example Matrix:**

| Alert Type       | Push (FCM)? | SMS/WhatsApp? | Reason                               |
|------------------|-------------|---------------|--------------------------------------|
| SOS              | ✓           | ✓             | Life-threatening, urgent           |
| Fall             | ✓           | ✓             | Life-threatening, urgent           |
| Geofence Exit    | ✓           | ✓             | Child leaving safe zone             |
| Geofence Enter   | ✓           | ✗             | Informational, not urgent          |
| Low Battery      | ✓           | ✗             | Informational, monitoring           |
| Offline          | ✓           | ✗             | Informational, device down          |
| Health Reading   | ✗           | ✗             | Skipped (data-only, not alert)     |

### Notification Delivery

```javascript
// File: src/firestore.js
// deliverAlertNotifications(imei, alert, alertId)

if (shouldNotify(alert)) {
  await notifyGuardianDevices(db, imei, alert);  // FCM push
}

if (shouldSms(alert)) {
  await notifyEmergencyContacts(db, imei, alert);  // SMS/WhatsApp via Twilio
}

// Update alert status in Firestore:
{
  notifyStatus: "pending" → "sending" → "sent"    (or "failed")
  notifiedAt: <timestamp>
}
```

---

## 10. Real-Time Sync to Mobile App

### Firestore Listeners

The mobile app watches these collections in real-time:

#### 1. devices/{imei}

```dart
// File: lib/services/guardian_services.dart
// watchLinkedDevices()

stream: db
  .collection("devices")
  .where("imei", whereIn: linkedImeis)
  .snapshots()
```

**Triggers UI updates for:**
- Location (map marker position, coordinates)
- Battery percentage
- Online/offline status
- Speed & course (if relevant to the UI)
- Last update timestamp
- Connection state ("live", "connecting", "offline")

#### 2. alerts/{docId}

```dart
stream: db
  .collection("alerts")
  .where("imei", "==", deviceImei)
  .orderBy("createdAt", descending: true)
  .limit(50)
  .snapshots()
```

**Triggers UI updates for:**
- Alert list (SOS, fall, geofence, battery warnings)
- Alert detail (message, time, location)
- Notification badge count

#### 3. locations/{docId} (if queried)

```dart
// Optional: load location history for a time range
stream: db
  .collection("devices")
  .doc(imei)
  .collection("locations")
  .where("recordedAt", isGreaterThan: startTime)
  .orderBy("recordedAt", descending: true)
  .snapshots()
```

**Used for:**
- Journey playback / route history
- Route visualization on the map
- Data export / audit trail

### Firestore Security Rules

All reads are gated by the `linkedTo(imei)` function:

```javascript
// firestore/rules.example
function linkedTo(imei) {
  return imei in request.auth.token.linkedImeis;
}

match /devices/{imei} {
  allow read: if linkedTo(imei);
  allow write: if false;  // Only gateway writes
}

match /devices/{imei}/locations/{docId} {
  allow read: if linkedTo(imei);
}

match /alerts/{docId} {
  allow read: if linkedTo(resource.data.imei);
  allow write: if false;  // Only gateway writes
}
```

This ensures users can only see locations and alerts for devices they are linked to.

---

## 11. Environment Configuration

### Critical Settings

#### WRITE_LOCATION_HISTORY (Default: false)

```bash
export WRITE_LOCATION_HISTORY=true
```

- `true`: Store each persisted location in `devices/{imei}/locations/{docId}`
- `false` (default): Skip location history, only update lastLocation

**Why default false?**
- Reduces Firestore storage by ~90% for stationary devices
- Reduces operational cost
- Most apps only need current position, not full history
- Can be enabled on-demand if journey playback is needed

#### WRITE_GATE_MIN_METRES (Default: 50)

```bash
export WRITE_GATE_MIN_METRES=75
```

Movement distance (in meters) required to trigger a Firestore persist. Lower values = more frequent updates + higher cost.

#### WRITE_GATE_HEARTBEAT_MINUTES (Default: 5)

```bash
export WRITE_GATE_HEARTBEAT_MINUTES=3
```

Maximum time (in minutes) between persisted locations even if the device is stationary. Ensures `lastLocation` doesn't go stale.

#### WRITE_GATE_HISTORY_MINUTES (Default: 5)

```bash
export WRITE_GATE_HISTORY_MINUTES=10
```

Minimum time between location history writes (if enabled). Reduces redundant history entries for stationary devices.

### Other Relevant Settings

| Env Var | Default | Purpose |
|---------|---------|---------|
| `FIRESTORE_DISABLED` | false | Disable all Firestore writes (dry-run mode) |
| `WRITE_GATE_MIN_METRES` | 50 | Distance threshold for persistence |
| `WRITE_GATE_HEARTBEAT_MINUTES` | 5 | Time-based heartbeat cap |
| `DWELL_MIN_MINUTES` | 10 | How long before a location is a dwell (stationary period) |
| `JOURNEY_IDLE_MINUTES` | 15 | How long before a journey segment ends |
| `INTELLIGENCE_OFFLINE_MINUTES` | 10 | After how long (no heartbeat) mark device offline |
| `TCP_IDLE_MINUTES` | 12 | Close idle TCP connection after this long |

---

## 12. Processing Flow Diagram (Complete)

```
[Device sends UD/UD2 packet]
        │
        ├─→ TCP connection established
        │   │ Server registers session
        │   │ Start or touch lastActivityAt
        │   
        ├─→ Parse GT06 frame (protocol/gt06.js)
        │   │ Extract: IMEI, command, args
        │   │ Build decoded packet object
        │
        ├─→ handlePacket(decoded, session)
        │   │ Return: { acks, events }
        │   │ events: [
        │   │   { type: "location", imei, lat, lng, speed, accuracy, recordedAt, ... }
        │   │ ]
        │
        ├─→ Send ACK frame back to device
        │   │ "[SG*IMEI*LEN*UD]"
        │
        ├─→ applyEvents(events, session) in server.js
        │   │
        │   ├─→ For each location event:
        │   │
        │   ├─→ resolveGeolocation(event)
        │   │   │ If V flag (no GPS):
        │   │   │   Call Google Geolocation API with WiFi/cell data
        │   │   │   Update event.location with resolved coords
        │   │   │
        │   │   └─→ Return: event with valid lat/lng
        │   │
        │   ├─→ correctFleetHemisphere(event)
        │   │   │ Check if lat/lng sign inverted vs last known
        │   │   │ Correct if hemisphere flip detected
        │   │
        │   ├─→ updateLiveState(imei, { location, speedKmh, ... })
        │   │   │ Update in-memory cache
        │   │   │ Track for journey/dwell/intelligence
        │   │
        │   ├─→ evaluateGeofenceTransitions(db, imei, location)
        │   │   │ Load active geofences for device
        │   │   │ Calculate distance to each center
        │   │   │ Detect enter/exit transitions
        │   │   │ Return: [alerts]
        │   │   │
        │   │   └─→ for each alert:
        │   │       └─→ createAlert(imei, alert)
        │   │           └─→ deliverAlertNotifications()
        │   │               ├─→ notifyGuardianDevices() [FCM push]
        │   │               └─→ notifyEmergencyContacts() [SMS/WhatsApp if urgent]
        │   │
        │   ├─→ trackPointForDwell(imei, { lat, lng, speed, recordedAt })
        │   │   │ Add to current dwell
        │   │   │ Or start new dwell if moving
        │   │   └─→ schedules flush if dwell > DWELL_MIN_MINUTES
        │   │
        │   ├─→ trackPointForJourney(imei, { lat, lng, ... }, now, { geofence... })
        │   │   │ Add point to current journey segment
        │   │   │ If geofence transition: end current segment
        │   │   └─→ Return: { flushes: [...] } (completed journeys)
        │   │
        │   ├─→ shouldPersist(imei, { location, geofenceTransition, ... })
        │   │   │ Apply write gate logic:
        │   │   │   1. Check distance threshold
        │   │   │   2. Check heartbeat cap time
        │   │   │   3. Check session force persist
        │   │   │
        │   │   └─→ Return: { persist: bool, reason: string, appendHistory: bool }
        │   │
        │   ├─→ IF persist OR session forced:
        │   │
        │   ├─→ persistDeviceState(imei, patch, reason, session)
        │   │   │ Apply session persistence patch (connecting → live)
        │   │   │
        │   │   └─→ upsertDevice(imei, {
        │   │       online: true,
        │   │       connectionState: "live",
        │   │       lastHeartbeatAt: new Date(),
        │   │       location: { lat, lng, speedKmh, ... },
        │   │       batteryPercent: 85
        │   │     })
        │   │       Firestore write: devices/{imei}
        │   │
        │   ├─→ IF shouldAppendLocationHistory(gate):
        │   │
        │   ├─→ appendLocation(imei, { lat, lng, speedKmh, recordedAt })
        │   │   │ Check WRITE_LOCATION_HISTORY env var
        │   │   │
        │   │   └─→ IF true:
        │   │       Firestore write: devices/{imei}/locations/{docId}
        │   │       │ One document per location update
        │   │       │ (only if gate reason permits it)
        │   │
        │   ├─→ refreshDeviceIntelligence(imei, device)
        │   │   │ Load active geofences
        │   │   │ Evaluate offline/anomaly rules
        │   │   │ Update: devices/{imei}.intelligence
        │   │
        │   └─→ touchPresenceIfNeeded(imei, session)
        │       │ If TCP is live but write-gate skipped:
        │       │ Still touch lastHeartbeatAt to prevent stale flags
        │
        └─→ End loop
            
[Mobile app receives Firestore snapshot]
    │
    ├─→ devices/{imei}.location changed
    │   │ Map updates location marker
    │   │ Shows speed, accuracy, timestamp
    │
    ├─→ alerts/{docId} created
    │   │ Toast/banner notification
    │   │ Add to alert history list
    │   │ Badge count on app icon
    │
    └─→ locations/{docId} added (if WRITE_LOCATION_HISTORY=true)
        │ Journey map updated
        │ Route history populated
```

---

## 13. Troubleshooting

### Location Not Updating in App

**Check:**
1. Is the gateway receiving packets? Look for `[protocol]` log lines
2. Did parsing succeed? Check for `[location_parse_error]` logs
3. Did it pass the write gate? Look for `[write-gate]` logs
4. Did Firestore update? Check for `[firestore]` writes (or `[firestore:dry-run]` if disabled)
5. Are security rules correct? Check `linkedTo(imei)` function in `firestore/rules.example`

**If write-gate keeps skipping:**
- Device may be stationary
- Lower `WRITE_GATE_MIN_METRES` for testing
- Check heartbeat cap: is 5 minutes enough?
- Verify `shouldForceSessionPersist()` logic — first 2 packets should always persist

### Location History Not Recording

**Check:**
1. `WRITE_LOCATION_HISTORY=false` (default)? Set to `true` to enable
2. Is `shouldAppendLocationHistory(gate)` allowing it? Check gate reason
3. Is the location persisting to `devices/{imei}.lastLocation` at all?
4. Check Firestore quota/permissions

**Why default false?**
Most apps don't need history. Enable selectively for journeys/playback.

### Geofence Not Triggering

**Check:**
1. Is geofence `active: true` in Firestore?
2. Does it have the correct `imei`?
3. Distance calculation: manual test with `haversineMeters()`
4. Check `[geofence]` logs for evaluation output
5. Is there a cooldown? Check `[geofence]` cooldown messages
6. WiFi SSID match? Currently not working (protocol decoder limitation)

### Offline Alert Creating Repeatedly

**Check:**
1. `INTELLIGENCE_OFFLINE_MINUTES` — is it too short?
2. `INTELLIGENCE_OFFLINE_ALERT_COOLDOWN_MINUTES` — should be 2–3x offline minutes
3. Check `[intelligence]` logs for insights evaluation
4. Device may be flapping online/offline due to network

---

## 14. Related Documentation

- [SYSTEM_OVERVIEW.md](SYSTEM_OVERVIEW.md) — High-level architecture
- [DATA_FLOW.md](DATA_FLOW.md) — Sequence diagrams for all flows
- [DEVICE_TO_APP_FLOW.md](DEVICE_TO_APP_FLOW.md) — Real-time sync mechanism
- [SECURITY_MODEL.md](SECURITY_MODEL.md) — Access control & data privacy
- [`GATEWAY_OVERVIEW.md`](GATEWAY_OVERVIEW.md) — Gateway implementation overview
- [`FIRESTORE_SCHEMA.md`](../05-data/FIRESTORE_SCHEMA.md) — Collection structures
