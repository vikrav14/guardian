# Gateway Overview

**Last updated:** 2026-07-29

The Gateway is a Node.js TCP server that acts as the bridge between GPS pendants in the field and the cloud backend (Firestore). It receives raw GT06 protocol packets from devices, decodes them, evaluates business logic (geofences, presence, health alerts), and writes meaningful state changes to Firestore. It also sends commands back to devices and orchestrates notifications.

## Architecture at a Glance

```
Device (V52 pendant)
    │ 4G LTE + GPS module
    │ Sends raw GT06 TCP packets
    │ (every 30s–3600s + alarms)
    │
    ▼
Gateway TCP Server (port 9000)
    │ Node.js process with live in-memory cache
    │
    ├─► Decode (GT06 protocol)
    │   │ Extract: imei, lat, lng, battery, speed, etc.
    │   │
    │   └─► Handle: LK (heartbeat), UD (location), AL (alarm)
    │
    ├─► Enrich & Evaluate
    │   │ • Geofence transitions (Haversine distance)
    │   │ • Dwell detection (stationary zones)
    │   │ • Journey tracking (route history)
    │   │ • Suspect location filtering (hemisphere sign bugs)
    │   │
    │   └─► Build alerts for critical events
    │
    ├─► Persist (Write Gate)
    │   │ Throttle Firestore writes based on:
    │   │ • Distance moved (min 50m)
    │   │ • Battery change
    │   │ • Time elapsed (heartbeat cap ~5 min)
    │   │ • Event type (alarms always written)
    │   │
    │   └─► Update Firestore collections
    │
    ├─► Notify
    │   │ • Push (FCM) to mobile app
    │   │ • SMS/WhatsApp to emergency contacts
    │   │ • Alert timing + severity rules
    │   │
    │   └─► Send via Twilio API (if configured)
    │
    └─► Command downlink
        │ Watch Firestore for device commands
        │ Queue TCP packets for next connection
        │ Send on next device heartbeat/location
        │
        └─► Example: UPLOAD (interval), FALLDOWN (fall detection toggle)

    ▼
Firestore (Real-time Database)
    ├─► devices/{imei} (Current state)
    │   Location, battery, online status, last heartbeat
    │
    ├─► locations/{docId} (Location history, if enabled)
    │   Lat/lng by timestamp (optional, gated by WRITE_LOCATION_HISTORY env)
    │
    ├─► segments/{docId} (Dwell periods)
    │   Stationary zone visited
    │
    ├─► journeys/{docId} (Route history)
    │   Multi-point trip with start/end, distance, time
    │
    └─► alerts/{docId} (Event log)
        Geofence, fall, SOS, offline, low battery

    ▼
Mobile App (Flutter)
    │ Real-time listener on devices/{imei}
    │ Updates live map marker
    │ Shows alerts, geofence state
```

## Technology Stack

| Component | Purpose |
|-----------|---------|
| **Node.js** (18+) | Runtime; no frameworks (vanilla Node HTTP/TCP) |
| **firebase-admin** | Firestore SDK (read/write, watch collections) |
| **dotenv** | Environment variable loading |
| **Twilio SDK** | (Optional) SMS/WhatsApp delivery |
| **Google Geolocation API** | (Optional) WiFi/LBS fallback when GPS unavailable |

**Testing:** Uses Node's built-in `node:test` module (`npm test`).

---

## Core Responsibilities

### 1. TCP Listener & Session Management

**File:** `src/server.js`, `src/sessions.js`

- **Port:** 9000 (configurable via `PORT` env var)
- **Host:** 0.0.0.0 (configurable via `HOST` env var)
- **Protocol:** Raw TCP; accepts connections from any device with GT06 support
- **Session lifecycle:**
  - Device connects → `registerSession(socket)`
  - Receive & buffer frames → Parse & decode
  - Process events (location, alarm, heartbeat)
  - Device disconnects → Flush dwell/journey, `unregisterSession(socket)`, schedule offline marker

Each socket gets a session object tracking:
- `imei` (device identifier)
- `protocolId` (10-digit ID from GT06 frame)
- `fullImei` (15-digit IMEI, extracted from payloads)
- `buffer` (incomplete frames, waiting for close bracket)
- `lastActivityAt` (for idle timeout detection)
- `persistCount` (number of location/heartbeat writes — used to mark "live" session)

### 2. GT06 Protocol Decoding

**File:** `src/protocol/gt06.js`, `src/protocol/crc.js`

Decodes ReachFar GT06 ASCII protocol — covers both V28C and V46/V48/V52 device families.

#### Frame Format

```
[CS*IMEI*LEN*command,args...]
│  │    │    │      │
│  │    │    │      └─ Payload: comma-separated data
│  │    │    └──────── 4-char hex length of payload
│  │    └──────────── 10-digit protocol ID (not full IMEI)
│  └──────────────── 2-char factory code (e.g., "SG", "3G")
└────────────────── ASCII delimiters
```

#### Command Types Decoded

| Command | Type | Example Payload |
|---------|------|---|
| **LK** | Heartbeat | `LK,steps,rolls,batteryPercent` |
| **UD** | Location | `UD,DDMMYY,HHMMSS,A/V,lat,NS,lng,EW,speed,course` |
| **UD2** | Buffered location (offline re-upload) | Same as UD, server doesn't ACK |
| **AL** | Alarm (SOS, fall, geofence) | Same location + alarm code bits |
| **oxygen** | SpO2 health reading (V46+) | `oxygen,oxyType,value` |
| **bphrt** | Heart rate + blood pressure (V46+) | `bphrt,systolic,diastolic,heartRate` |
| **RYIMEI** | Device reports full IMEI | Contains 15-digit IMEI in payload |
| **CONFIG** | Firmware self-test | Device state including upload interval |

#### Location Parsing Details

- **GPS Valid (A flag):** Satellite GPS fix; `lat`, `lng`, `speed` are direct
- **GPS Invalid (V flag):** WiFi/LBS fallback; needs Google Geolocation API:
  - Extract WiFi access point BSSIDs + signal strength
  - Extract cell tower info (MCC, MNC, LAC, CID, signal)
  - Call Google Geolocation API → `{lat, lng, accuracyMeters}`
  - Mark as `accuracySource: 'wifi'` or `'lbs'`

- **Timestamp:** Device sends local time (DDMMYY HHMMSS), converted to UTC
  - Year assumed 2000–2099
  - No timezone offset — treated as UTC
  - Validation: reject if date/time out of range

#### Alarm Code Decoding

Alarms are bitflags in a hex byte (e.g., `0x101` = bits 0 and 8 set):

| Bit | Meaning | Severity |
|-----|---------|----------|
| 16 | SOS button pressed | critical |
| 21 | Fall detected | critical |
| 22 | Heart rate abnormal (V46+) | warning |
| 20 | Geofence exit | warning |
| 19 | Geofence enter | info |
| 17 | Low battery | warning |

#### CRC Validation

- GT06 frames include a 2-byte CRC checksum (CCITT-XMODEM)
- **Current status:** Calculation implemented in `src/protocol/crc.js` but **not yet validated against real hardware**
- Frames with bad CRC are dropped with `[crc_error]` log

### 3. Event Extraction & Session Binding

**File:** `src/imei.js`, `src/connection-handshake.js`

After decoding, the frame's 10-digit `imei` (protocol ID) is bound to the TCP session:
- Extract full 15-digit IMEI from payloads when available (RYIMEI, CONFIG)
- Store `{protocolId, imei}` mapping per session
- First event from a device initiates presence check in Firestore

Handshake flow:
1. Device sends location/heartbeat with protocol ID
2. Gateway checks `devices/{protocolId}` exists in Firestore
3. If not found, calls `onDeviceConnect()` → auto-creates device document with `online: true`, `lastHeartbeatAt: now`

### 4. Live Cache & Write Gate

**File:** `src/live-cache.js`

In-memory cache per device tracks:
- Last persisted location (lat, lng, battery, timestamp)
- Last persisted at (for heartbeat timeout cap)
- Current live state (latest unpersisted location, battery)
- Suspect location (held back if implausible jump detected)
- Dwell state (stationary tracking)
- Journey state (route tracking)

#### Write Gate Decision

Before writing to Firestore, check if the update is "meaningful":

```javascript
const gate = shouldPersist(imei, {
  eventType: 'location',
  location: { lat, lng, ... },
  batteryPercent: 85,
  geofenceTransition: false
})
// Returns: { persist: true/false, reason: 'distance_moved' | 'heartbeat_cap' | ... }
```

**Persist if any is true:**
- Device just connected (first fix)
- Location moved > 50m (WRITE_GATE_MIN_METRES, default 50)
- Battery changed significantly
- Geofence triggered
- > 5 min since last write (WRITE_GATE_HEARTBEAT_MINUTES, default 5)
- Alarm received (always persist)

**Skip if:**
- Device stationary, battery stable, < 5 min elapsed

**Benefit:** Reduces Firestore writes from ~2880/day (every 30s) to ~100–400/day (only meaningful changes).

#### Suspect Location Filtering

If a fix lands **> 250 km** from last known location (JUMP_SANITY_METERS):
1. Flag as `suspect_location`
2. **Hold the display back one cycle** — don't write to Firestore yet
3. If next fix is close to the suspect (not the old location), trust the suspect
4. If next fix is close to the old location, discard the suspect (likely a glitch)

*Real scenario:* A hemisphere-sign bug can place a Mauritius pendant near Oman for one fix. This holds display back one cycle and prevents the map from jumping.

---

## Major Processing Flows

### Flow 1: Location Update

```
socket.on('data', chunk)
  ├─► Append to session.buffer
  ├─► extractFrames() → split by [ ]
  │
  └─► For each frame:
      ├─► decodeFrame() → { imei, command, args }
      │
      ├─► handlePacket() → { acks, events }
      │   • Build LK/UD/AL/etc. events
      │   • Queue ACK frames
      │
      ├─► Write ACKs to socket (device needs immediate response)
      │
      └─► applyEvents(events):
          For each location event:
          ├─► maybeAnnounceConnecting() → Mark device online if new
          │
          ├─► resolveGeolocation() → Call Google API if gps=V
          │
          ├─► correctFleetHemisphere() → Detect & hold suspect fixes
          │
          ├─► updateLiveState() → Cache the location in-memory
          │
          ├─► evaluateGeofenceTransitions()
          │   • Haversine distance to each safe zone
          │   • Compare to prev state (inside/outside)
          │   • Create alerts for enter/exit
          │   • Store alerts in Firestore
          │
          ├─► trackPointForDwell() → Add point to dwell buffer
          │   • Auto-flush if zone changed
          │   • Write segments/{docId} to Firestore
          │
          ├─► trackPointForJourney() → Add point to journey
          │   • Auto-close if idle > 15 min (JOURNEY_IDLE_MINUTES)
          │   • Write journeys/{docId} to Firestore
          │   • Includes route (polyline), distance, time, geofence events
          │
          ├─► shouldPersist() → Check write gate
          │   • If persist: write to devices/{imei}
          │   • If skip: touch presence only (keep online=true)
          │
          ├─► persistDeviceState() → upsertDevice()
          │   • Update devices/{imei}: location, battery, lastHeartbeatAt
          │   • Append to locations/{docId} (if WRITE_LOCATION_HISTORY=true)
          │
          ├─► refreshDeviceIntelligence() → Update smart state
          │   • Trigger rule-based insights (offline detection, etc.)
          │
          └─► maybeFlushDwell() → Auto-close dwell if needed
```

### Flow 2: Geofence Evaluation

```
evaluateGeofenceTransitions(db, imei, location):
  ├─► Load all active geofences for imei from Firestore
  │
  ├─► For each geofence:
  │   ├─► Calculate: distance = haversine(device_lat/lng, fence_lat/lng)
  │   │
  │   ├─► Check WiFi fence:
  │   │   • If WiFi SSID configured & device associated with SSID → inside
  │   │   • Else if distance < radius → inside
  │   │   • Else → outside
  │   │
  │   ├─► Compare to prev state in-memory
  │   │
  │   ├─► If transition (inside→outside or outside→inside):
  │   │   ├─► Create alert: { type: 'geofence_exit'/'geofence_enter', ... }
  │   │   ├─► Write to alerts/{docId}
  │   │   ├─► Cooldown (60s) to prevent flapping
  │   │   │
  │   │   └─► Return event with payload: { geofenceId, geofenceName, ... }
  │   │
  │   └─► Update in-memory state
  │
  └─► Return array of transition events
```

### Flow 3: Device Command Downlink

**File:** `src/commands.js`, `src/downlink.js`

Commands are enqueued per device and sent on next connection:

```
Firestore watcher (Cloud Function or gateway HTTP endpoint):
  │ User changes device setting
  │ Write to deviceCommands/{docId}: { type: 'UPLOAD', value: 120 }
  │
  ▼
Gateway downlink queue:
  ├─► Builds SMS-style command:
  │   UPLOAD,120 (set location upload interval to 120s)
  │   FALLDOWN,1,3 (enable fall detection, sensitivity 3)
  │   FIND# (ring to find device)
  │   monitor,1234567890# (listen in with center phone number)
  │
  ├─► On next socket.on('data'), sends command to device
  │
  └─► Waits for echo (device responds with same command)
      If echo matches → command confirmed in Firestore

Known issues:
  • voice_monitor & find are from community source (RF-V28), not vendor-verified for V28C
  • No SMS fallback — commands only work if device has live TCP connection
  • No offline buffering — commands sent while offline are lost
```

### Flow 4: Device Offline Detection

**File:** `src/device-offline.js`, `src/connection-live.js`

```
Device stops sending packets (lost 4G signal)

Session still open (socket alive):
  └─► TCP keep-alive holds connection
      Periodically update devices/{imei}.online = true (presence touch)

Session closes (socket.close):
  └─► Unregister session
      Schedule offline transition:
      ├─► Wait OFFLINE_DEBOUNCE_MS (15s) to absorb ngrok/carrier reconnect blips
      └─► If still not reconnected: write devices/{imei}.online = false

Detection timeout:
  └─► Gateway watches lastHeartbeatAt
      If > WRITE_GATE_HEARTBEAT_MINUTES (5 min) + CONNECTION_STALE_MINUTES (10 min)
      Mark device offline

Visual timeline:
  │ Heartbeat   Heartbeat    Now      No HB > 15 min
  │    │           │          │           │
  │    ▼           ▼          ▼           ▼
  │   Online    Online     Stale      Offline
  └─── 0 min ─── 5 min ──── 10 min ──── 15+ min
```

### Flow 5: Notifications

**File:** `src/notify.js`, `src/push.js`

Triggered on alert creation (geofence, fall, SOS, low battery):

```
Alert created in Firestore:
  {
    "type": "geofence_exit",
    "imei": "869362...",
    "severity": "warning",
    "location": { lat, lng },
    "message": "Left 'Home' safe zone"
  }

gateway/src/notify.js evaluates:
  ├─► shouldNotify() → Send push to mobile app?
  │   ├─► geofence_exit: yes
  │   ├─► geofence_enter: yes
  │   ├─► fall: yes
  │   ├─► sos: yes
  │   ├─► low_battery: yes
  │   └─► offline: yes
  │
  ├─► shouldSms() → Send SMS/WhatsApp to emergency contacts?
  │   ├─► geofence_exit: yes ← Only critical alerts via SMS
  │   ├─► geofence_enter: no
  │   ├─► fall: yes
  │   ├─► sos: yes
  │   ├─► low_battery: yes
  │   └─► offline: no
  │
  ├─► Load device metadata from Firestore
  │   ├─► Caregiver Firebase user IDs → FCM tokens
  │   ├─► Emergency contact phone numbers (if configured)
  │   └─► Alert throttling rules (cooldown times)
  │
  ├─► Send push notifications (FCM)
  │   └─► Via firebase-admin: send({ tokens, data, notification })
  │       Recipient sees: "Device left 'Home' at 14:32"
  │
  └─► Send SMS/WhatsApp (if Twilio configured)
      └─► Via Twilio API: messages.create({ to, body })
          Emergency contact receives: "ALERT: Device left Home (14:32)"

Throttling:
  • Same alert type + device: 5 min cooldown
  • Prevents spam if device flaps in/out of zone
```

---

## Key Files & Modules

### Core Protocol & Session

| File | Purpose |
|------|---------|
| `src/server.js` | TCP server, socket event handlers, main event loop |
| `src/sessions.js` | Session registry (socket → IMEI binding) |
| `src/protocol/gt06.js` | Frame extraction, decoding, payload parsing |
| `src/protocol/crc.js` | CRC-CCITT checksum validation |
| `src/imei.js` | Protocol ID ↔ Full IMEI mapping, session binding |
| `src/connection-handshake.js` | First-connection detection, device online marker |
| `src/connection-live.js` | Session liveliness tracking, presence touches |

### State Management & Write Gate

| File | Purpose |
|------|---------|
| `src/live-cache.js` | In-memory device state (location, battery, journey, dwell) |
| `src/firestore.js` | All Firestore read/write operations |
| `src/geofence.js` | Haversine distance, inside/outside detection, transitions |
| `src/device-offline.js` | Offline scheduling after socket close |
| `src/device-presence.js` | Online/offline state management |

### Location Processing

| File | Purpose |
|------|---------|
| `src/geolocate/google.js` | Google Geolocation API client (WiFi/LBS → lat/lng) |
| `src/fleet-hemisphere.js` | Detect & hold suspect hemisphere-sign bug locations |
| `src/dwell.js` | Stationary zone tracking, segment flushing |
| `src/journey-builder.js` | Route tracking, polyline compression, auto-close |
| `src/polyline.js` | Encode lat/lng arrays as compressed polyline strings |

### Alerts & Notifications

| File | Purpose |
|------|---------|
| `src/notify.js` | Alert routing (to whom, via what channel) |
| `src/push.js` | FCM push notification sending |
| `src/commands.js` | Device command building (UPLOAD, FALLDOWN, FIND, etc.) |
| `src/downlink.js` | TCP downlink packet queuing |

### Monitoring & Ops

| File | Purpose |
|------|---------|
| `src/config.js` | Environment variable loader & schema |
| `src/ops-metrics/index.js` | Event counter (heartbeat, location, alarm, etc.) |
| `src/ops-metrics/collector.js` | Collect metrics in-memory per minute |
| `src/ops-metrics/flusher.js` | Periodic flush to Firestore (ops metrics collection) |
| `src/http.js` | HTTP server for `/ops/metrics`, `/dev/chat` endpoints |
| `src/ngrok-hint.js` | Detect ngrok tunnel URL on startup (development hint) |
| `src/ai-telemetry/index.js` | WhatsApp AI assistant telemetry |

### AI Features (Optional)

| File | Purpose |
|------|---------|
| `src/assistant/claude.js` | Claude API integration (WhatsApp chatbot) |
| `src/assistant/tools.js` | Tool handlers (device status, location lookup, etc.) |
| `src/intelligence/index.js` | Rule-based device insights (offline alerts, etc.) |
| `src/cost-engine/index.js` | SMS/WhatsApp cost estimation (ops tracking) |

---

## Event Loop Model

### Main Loop (Async Event Driven)

```
┌─────────────────────────────────────────────────────────────┐
│                    Node.js Event Loop                        │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│ 1. socket.on('data') ← TCP frames from devices              │
│    • Buffer frames (partial reads coalesced)                │
│    • Decode in current turn                                 │
│    • Queue events for async processing                      │
│                                                               │
│ 2. applyEvents(events, session)                             │
│    • Sync: decode, live cache update                        │
│    • Async: Firestore writes (location, alerts)            │
│    • Async: Geofence evaluation (Firestore query)          │
│    • Async: Geolocation API (if GPS=V)                      │
│    • Fire & forget (no await)                              │
│                                                               │
│ 3. socket.on('close') ← Device disconnects                  │
│    • Flush dwell segment (if open)                          │
│    • Flush journey (if open)                                │
│    • Schedule offline transition (async)                    │
│                                                               │
│ 4. setInterval(60s) ← Metrics reporter                      │
│    • Log write-gate stats (skipped vs. persisted)          │
│    • Flush ops metrics to Firestore                        │
│                                                               │
│ 5. HTTP server (port 9001, parallel)                        │
│    • GET /ops/metrics → Return ops stats                    │
│    • POST /webhook → WhatsApp incoming messages            │
│    • POST /dev/chat → Dev chat endpoint                     │
│                                                               │
└─────────────────────────────────────────────────────────────┘

Key: The TCP socket handler is synchronous (frames decoded immediately),
but all Firestore writes are async (Promise.then or await in background tasks).
No blocking waits — pending promises are tracked implicitly in Node's queue.
```

### Concurrency Model

- **Multiple devices:** Each socket is independent; no cross-device locking
- **Firestore writes:** Fire-and-forget; errors logged but don't block TCP processing
- **Geofence queries:** Each location update triggers a Firestore query (per device)
  - If slow, doesn't block TCP — next frame still processed
  - Cached results reduce latency (devices query same zones repeatedly)
- **Dwell/Journey:** Per-device state; in-memory cache prevents contention

### Backpressure

Gateway doesn't implement TCP backpressure. If Firestore is slow:
- Device packets still received & buffered normally
- Firestore writes pile up in Node's microtask queue
- If queue grows huge, process memory usage increases (rare, since Firestore is usually fast)

For production: Consider adding `socket.pause()` / `socket.resume()` if Firestore latency spikes.

---

## Configuration & Environment Variables

**See** `src/config.js` for all options. Key ones:

```bash
# TCP Server
PORT=9000
HOST=0.0.0.0

# Firestore
FIREBASE_PROJECT_ID=guardian-prod
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json
FIRESTORE_DISABLED=false  # Dry-run mode (decode only, no writes)

# Write Gate (Firestore throttling)
WRITE_GATE_MIN_METRES=50         # Min distance to persist location
WRITE_GATE_HEARTBEAT_MINUTES=5   # Max time between writes
WRITE_LOCATION_HISTORY=false     # Store per-fix history (optional)
DWELL_MIN_MINUTES=10             # Min time to create dwell segment
JOURNEY_IDLE_MINUTES=15          # Idle time before closing journey

# IMEI Mapping (V28C protocol ID → 15-digit IMEI)
IMEI_PREFIX=8613970              # Prefix for all V28C devices
IMEI_DEFAULT_SUFFIX=0            # Last digit (checksum)
IMEI_MAP=9705313987:861397053139877  # Override for specific device

# Notifications (Twilio)
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM_SMS=+1555123456
TWILIO_WHATSAPP_FROM=whatsapp:+1555123456
NOTIFY_SMS=true
NOTIFY_WHATSAPP=true

# Geolocation (Google)
GOOGLE_GEOLOCATION_API_KEY=...  # For WiFi/LBS fallback

# AI Assistant (Optional)
ANTHROPIC_API_KEY=...
ANTHROPIC_MODEL=claude-sonnet-4-20250514

# Operations Monitoring
ADMIN_API_KEY=...
ADMIN_EMAILS=vikrav14@gmail.com
OPS_METRICS_FLUSH_MS=60000

# Timeouts & Debounce
TCP_IDLE_MINUTES=12
OFFLINE_DEBOUNCE_MS=15000
CONNECTION_STALE_MINUTES=10
```

---

## Startup & Monitoring

### Starting the Gateway

```bash
# Development (watch mode)
npm run dev

# Production
npm start

# Simulate device (test connection)
npm run simulate
```

**Logs** follow `[module]` convention:
```
[guardian-gateway] listening on 0.0.0.0:9000
[tcp] connected 192.168.1.1:54321
[gateway] full IMEI 861397053141170 for protocol id 9705314117
[geofence] 9705314117 exit: Left Home (100 m away)
[write-gate] persist 9705314117 reason=distance_moved
[presence] touch 9705314117 (network session still live)
```

### Metrics & Observability

**Via gateway HTTP server (port 9001):**
```bash
curl http://localhost:9001/ops/metrics?key=ADMIN_API_KEY
```

Returns:
```json
{
  "interval": "2026-07-29T12:34:00Z",
  "events": {
    "heartbeat": 142,
    "location": 98,
    "alarm": 3,
    "geofence_exit": 2,
    "crc_error": 1
  },
  "costs": {
    "sms": { "count": 12, "usd": 0.60 },
    "whatsapp": { "count": 8, "usd": 0.40 }
  }
}
```

**Firestore opMetrics collection:**
- Automatically flushed every 60s (FLUSHED_MS env var)
- Tracks events per minute (heartbeat, location, alarm, etc.)
- Used to bill customers & understand traffic patterns

---

## Known Limitations & Gaps

### Verified Hardware Commands

Only these commands are **vendor-confirmed** for V28C:

- **UPLOAD** — Set location upload interval
- **FALLDOWN** — Fall detection sensitivity
- **CR** — Force GPS (30s high-frequency mode)
- **SOS1/SOS2/SOS3** — Set emergency numbers
- **PHBX** — Phone book
- **APN, IP** — Network settings

### Unverified Commands (Community Source)

These are from RF-V28 (related but different device):

- **FIND** / **find#** — Ring to locate (in `src/commands.js`, flagged as unverified)
- **monitor** / **voice_monitor** — Listen in (marked unverified in app UI)

**Do not use on production V28C without vendor testing.** See GitHub issues #28, #29 for details.

### Missing Features

- **No offline command buffering** — Commands sent while device offline are lost; device must reconnect to receive
- **No SMS fallback for commands** — Only TCP downlink supported; if device loses 4G, can't send commands
- **WiFi safe-zone matching incomplete** — Decoder extracts LTE extras (WiFi SSID), but GT06 protocol packets from real V28C don't populate WiFi SSID field yet (structurally dead in production)
- **No device firmware OTA** — PIC command exists in protocol but not implemented
- **No step counter** — PEDO command exists but unverified

---

## Testing

```bash
# Unit tests (Node's built-in test runner)
npm test

# Simulate a device sending location/alarm/heartbeat
npm run simulate

# Interactive chat with Claude via WhatsApp (dev only)
npm run chat
```

**Test files:**
- `test/protocol/gt06.test.js` — Frame decoding
- `test/geofence.test.js` — Haversine & zone logic
- `test/live-cache.test.js` — Write gate decision logic

---

## Deployment Checklist

- [ ] `FIREBASE_PROJECT_ID` set to production project
- [ ] `GOOGLE_APPLICATION_CREDENTIALS` points to service account key
- [ ] `WRITE_LOCATION_HISTORY=true` (store full route history) or `false` (save bandwidth)
- [ ] Firestore composite index deployed: `devices/{imei} + alerts.createdAt DESC`
- [ ] Twilio credentials configured (for SMS/WhatsApp)
- [ ] Google Geolocation API key set (for WiFi/LBS fallback)
- [ ] Anthropic API key set (for WhatsApp AI, if enabled)
- [ ] Gateway exposed to internet (ngrok tunnel for dev, public IP for prod)
- [ ] Device configured to connect to gateway's public address
- [ ] Mobile app's `AuthService.demoImei` changed or device linking flow enabled
- [ ] Firestore security rules deployed (`firebase deploy --only firestore:rules`)
- [ ] Operational metrics review process established

---

## Related Documentation

- [SYSTEM_OVERVIEW.md](../02-architecture/SYSTEM_OVERVIEW.md) — High-level architecture
- [DATA_FLOW.md](../02-architecture/DATA_FLOW.md) — Complete flow diagrams
- [DEVICE_TO_APP_FLOW.md](../02-architecture/DEVICE_TO_APP_FLOW.md) — Real-time sync details
- [SECURITY_MODEL.md](../02-architecture/SECURITY_MODEL.md) — Access control & data privacy
- [FIRESTORE_OVERVIEW.md](../05-data/FIRESTORE_OVERVIEW.md) — Collection schema & rules
- [MOBILE_OVERVIEW.md](../03-mobile/MOBILE_OVERVIEW.md) — App architecture
- [V28C_DEVICE_SETUP.md](../V28C_DEVICE_SETUP.md) — Hardware provisioning
- [WHATSAPP_ASSISTANT.md](../WHATSAPP_ASSISTANT.md) — Claude AI integration
