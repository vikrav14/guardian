# GT06 Protocol: Packet Format & Implementation

**Last updated:** 2026-07-29

Guardian's gateway decodes the **ReachFar GT06 ASCII protocol**, a family of GPS tracking devices that share the same packet structure and core command set. This document covers the protocol's fundamentals, the devices Guardian supports, key packet types, and how the gateway parser works.

---

## Protocol Overview

The GT06 protocol is an **ASCII text protocol** sent over **TCP** (port 9000 in Guardian). Every packet follows the same frame structure, regardless of device model or packet type.

### Frame Structure

```
[CS*IMEI*LEN*payload]

CS       = 2-byte factory code (e.g., "3G", "SG")
IMEI     = 10-digit device ID (protocol id; see IMEI normalization below)
LEN      = 4-char ASCII hex encoding of the payload length
payload  = comma-separated command and arguments
```

**Example frame:**
```
[3G*9705314117*000F*LK,0,0,80]
    └─ factory: 3G
            └─ protocol ID: 9705314117
                       └─ payload length: 0x000F = 15 bytes
                                 └─ command: LK
                                      └─ args: [0, 0, 80] (steps, rolls, battery %)
```

### Payload Format

Payload is comma-delimited: `command,arg1,arg2,arg3,...`

- **Command** = device-initiated uplink packet type (LK, UD_LTE, AL, etc.) or server echo
- **Arguments** = data fields specific to each command (varies by type)

### Factory Code

- **3G** = ReachFar V28C, V46, V48, V52 models
- **SG** = Used in device ACKs from the gateway

---

## Device Support Matrix

Guardian supports three hardware families, all sharing the same decoder:

| Device | Year | Protocol | Features | Notes |
|--------|------|----------|----------|-------|
| **V28C** | ~2018 | V28C | GPS, SOS, geofence, heartbeat | Pendant form factor; lowest power |
| **V46/V48** | ~2020 | V46-V48-V52 (2021-12-20) | V28C + fall detection, health (SpO2, heart rate) | Wearable wristband; extended feature set |
| **V52** | ~2021 | V46-V48-V52 (2021-12-20) | V46/V48 + blind-spot reupload (UD2) | Latest model; buffering for offline periods |

**Key observation:** V28C uses its own protocol doc, but the V46/V48/V52 doc is newer and more comprehensive. Guardian decodes both because:
1. Core packets (LK, UD, AL) are **structurally identical** across all three
2. Location field layout (Appendix I in both docs) is **unchanged**
3. V46/V48/V52-only additions (health, UD2) are **additive** — a V28C device simply never sends them

---

## IMEI Normalization

The protocol uses a **10-digit "protocol ID"** in every frame, but Firestore documents and device labels use the **15-digit full IMEI**. The relationship is:

```
fullImei.substring(4, 14) === protocolId
```

Example:
```
Full IMEI:   861397053141170  (15 digits)
Protocol ID:    9705314117   (10 digits, extracted from position 4-14)
```

Rebuilding the full IMEI from a protocol ID:
```
fullImei = "8613970" + protocolId.substring(3) + suffixDigit
         = "8613970" +       "5314117"       + "0"  (default suffix)
         = "861397053141170"
```

**See also:** `gateway/src/imei.js` for full normalization logic.

---

## Acknowledgments (Server → Device)

The gateway must ACK most uplink packets to prevent the device from retransmitting. The ACK format is:

```
[SG*<protocolId>*<lenHex>*<command>]

SG           = gateway factory code
<protocolId> = 10-digit device ID from the original frame
<lenHex>     = 4-char ASCII hex length of command
<command>    = the command being acknowledged (LK, UD, AL, etc.)
```

**Example ACK for an LK heartbeat:**
```
[SG*9705314117*0002*LK]
    └─ SG: gateway
            └─ device's protocol ID (echoed)
                       └─ "LK" is 2 bytes
                                 └─ ACK the LK command
```

**Example ACK for CONFIG (vendor requires CONFIG,1):**
```
[SG*9705314117*0008*CONFIG,1]
                  └─ "CONFIG,1" is 8 bytes; vendor spec requires the "1" status code
```

---

## Key Packet Types

### 1. LK (Heartbeat / Link Keep-Alive)

**Direction:** Device → Gateway  
**Frequency:** Every 30–3600 seconds (configurable via UPLOAD command)  
**Purpose:** Signals that device is alive and connected

**Payload format:**
```
LK,steps,rolls,battery

steps    = Step count (V46/V48/V52 feature; V28C sends 0)
rolls    = Roll count / fall events detected (V46/V48/V52 feature; V28C sends 0)
battery  = Battery percentage (0–100)
```

**Example:**
```
[3G*9705314117*000B*LK,0,0,85]
                    └─ 0 steps, 0 rolls, 85% battery
```

**Gateway action:**
1. Extract battery level
2. Send ACK: `[SG*9705314117*0002*LK]`
3. Update `devices/{imei}.lastHeartbeat` timestamp
4. Update `devices/{imei}.batteryPercent`
5. Mark device as `online: true` (if was offline)

**Code reference:** `gateway/src/protocol/gt06.js`, lines 233–237

---

### 2. UD (Location Upload)

**Direction:** Device → Gateway  
**Frequency:** Every 30–3600 seconds (same interval as LK heartbeats)  
**Variants:** `UD`, `UD_LTE`, `UD_WCDMA`, `UD_GPS` (all handled identically)  
**Purpose:** Transmit GPS location, speed, and course

**Payload format:**
```
UD_LTE,DDMMYY,HHMMSS,A,lat,latDir,lng,lngDir,speed,course,[lte extras...]

DDMMYY      = Date (day, month, year, e.g., "241122" = Nov 24, 2022)
HHMMSS      = Time UTC (hour, minute, second)
A or V      = GPS validity flag
              "A" = Satellite GPS fix (accurate, ~5–10m)
              "V" = WiFi/LBS raw data (approximate, ~100–400m)
lat         = Latitude decimal degrees (e.g., 22.653729)
latDir      = "N" or "S"
lng         = Longitude decimal degrees (e.g., 114.0146)
lngDir      = "E" or "W" (usually "E")
speed       = Speed in km/h
course      = Direction in degrees (0–359)
[lte extras]= Optional WiFi MAC + RSSI and cell tower data (if GPS=V)
```

**Example with satellite GPS:**
```
[3G*9705314117*003F*UD_LTE,241122,062109,A,22.653729,N,114.0146,E,0.0,0]
                             └─ Nov 24, 2022, 06:21:09
                                         └─ "A" = satellite GPS fix (valid)
                                              └─ Lat: 22.653729°N
                                                        └─ Lng: 114.0146°E
                                                                    └─ Speed: 0 km/h, Course: 0°
```

**Example with WiFi fallback (GPS=V, no satellite fix):**
```
[3G*9705314117*...LTE,241122,062109,V,22.68,N,113.99,E,0,0,617,1,12345,67890123,1,,aa:bb:cc:dd:ee:ff,-70,00010000]
                                     └─ "V" = WiFi/LBS data (not satellite GPS)
                                              └─ Placeholder coordinates; need geolocation
                                                                                    └─ WiFi: aa:bb:cc:dd:ee:ff @ -70dBm RSSI
                                                                                                                 └─ Alarm state field (end of array)
```

**Gateway action:**
1. Parse location fields and extract: `{lat, lng, speedKmh, course, recordedAt}`
2. Determine GPS validity:
   - If flag="A": `gpsValid: true` (use coordinates as-is)
   - If flag="V": `gpsValid: false` + extract WiFi/cell tower data for geolocation
3. Send ACK: `[SG*<protocolId>*0002*UD]`
4. Write to `locations/{docId}` (if `WRITE_LOCATION_HISTORY=true`)
5. Update `devices/{imei}.lastLocation`
6. Evaluate geofences against the location
7. If geofence triggered, create alert and send notifications

**Code reference:** `gateway/src/protocol/gt06.js`, lines 255–271

---

### 3. UD2 (Blind-Spot Re-Upload)

**Direction:** Device → Gateway  
**Introduced:** V46/V48/V52 protocol (V28C does not send UD2)  
**Purpose:** Transmit buffered location history when device reconnects after offline period

**Payload format:** Same as UD, but the device sends multiple UD2 packets in sequence

**Example:**
```
[3G*9705314117*003F*UD2,241122,062109,A,22.653729,N,114.0146,E,0.0,0]
[3G*9705314117*003F*UD2,241122,062129,A,22.654100,N,114.0150,E,0.5,90]
[3G*9705314117*003F*UD2,241122,062149,A,22.654500,N,114.0155,E,1.2,95]
                     └─ Multiple buffered locations sent in a row
```

**Gateway action:**
1. Parse each UD2 the same way as UD (same payload structure)
2. **Important:** **No ACK sent** — vendor spec says "Server no need reply"
3. Mark each location with `blindSpotReupload: true` in Firestore
4. Mobile app displays full route history

**Code reference:** `gateway/src/protocol/gt06.js`, lines 238–254

---

### 4. AL (Alarm Upload)

**Direction:** Device → Gateway  
**Frequency:** Event-triggered (SOS button, fall, geofence, low battery)  
**Variants:** `AL`, `AL_LTE`, `AL_WCDMA`  
**Purpose:** Report emergency events with location

**Payload format:**
```
AL_LTE,DDMMYY,HHMMSS,A,lat,latDir,lng,lngDir,speed,course,[lte extras...],alarmCode

alarmCode = 8-digit hex bitmask of alarm state
```

**Alarm Code Bit Mapping:**

| Bit | Value | Meaning | Severity |
|-----|-------|---------|----------|
| 16  | 0x00010000 | SOS button pressed | critical |
| 21  | 0x00200000 | Fall detected | critical |
| 22  | 0x00400000 | Heart rate abnormal (V46/V48/V52 only) | warning |
| 20  | 0x00100000 | Geofence exit | warning |
| 19  | 0x00080000 | Geofence enter | warning |
| 17  | 0x00020000 | Low battery | warning |

**Example SOS button press with location:**
```
[3G*9705314117*...AL_LTE,241122,062109,A,22.653729,N,114.0146,E,0,0,00010000]
                                                                      └─ Bit 16 set = SOS
```

**Example fall detection with WiFi fallback:**
```
[3G*9705314117*...AL_LTE,241122,062109,V,22.68,N,113.99,E,0,0,...,00200000]
                                         └─ "V" = no GPS
                                                                  └─ Bit 21 set = fall
                                                                      │
                                                                      └─ Needs geolocation
```

**Gateway action:**
1. Parse location and extract alarm code (last field)
2. Decode alarm code to determine type (SOS, fall, geofence, etc.)
3. Send ACK: `[SG*<protocolId>*0002*AL]`
4. Create `alerts/{docId}` with alarm type, severity, and location
5. Send notifications:
   - Push (FCM) to caregiver
   - SMS/WhatsApp to emergency contacts (if enabled and alarm is SOS/fall/exit/low-battery)
6. If location is WiFi/LBS only (V flag), queue for geolocation

**Code reference:** `gateway/src/protocol/gt06.js`, lines 307–345

---

### 5. CONFIG (Device Self-Test)

**Direction:** Device → Gateway  
**Frequency:** Periodically (e.g., on boot or periodic self-test)  
**Purpose:** Report device firmware state and configuration

**Payload format:**
```
CONFIG,<device state fields>

Fields typically include upload interval (UL), various config parameters
(exact format varies; not all fields are documented by the vendor)
```

**Example:**
```
[3G*9705314117*003A*CONFIG,860,0,0,0,0,0,0,0,0,861397053141170]
                                                    └─ Full IMEI may be present
```

**Gateway action:**
1. Extract full IMEI if present (for IMEI binding)
2. Send ACK with status code: `[SG*<protocolId>*0008*CONFIG,1]`
   - The "1" indicates "normal" status (per V28C vendor spec)
3. Update device state if any parameters are parsed

**Code reference:** `gateway/src/protocol/gt06.js`, lines 351–357

---

### 6. RYIMEI (Report IMEI)

**Direction:** Device → Gateway  
**Frequency:** Event-triggered (during boot or setup)  
**Purpose:** Transmit the full 15-digit IMEI for device binding

**Payload format:**
```
RYIMEI,<full IMEI>

Example: RYIMEI,861397053141170
```

**Gateway action:**
1. Extract full IMEI from payload
2. Send ACK: `[SG*<protocolId>*0006*RYIMEI]`
3. Create `imei_report` event with full IMEI for session binding

**Code reference:** `gateway/src/protocol/gt06.js`, lines 346–350

---

### 7. Health Readings (V46/V48/V52 Only)

#### oxygen (SpO2 — Blood Oxygen)

**Direction:** Device → Gateway  
**Introduced:** V46/V48/V52 protocol

**Payload format:**
```
oxygen,oxyType,oxyValue

oxyType = Measurement type (0–3, device-specific)
oxyValue = SpO2 percentage (typically 95–100)
```

**Example:**
```
[3G*9705314117*0008*oxygen,0,98]
                    └─ SpO2: 98%
```

**Gateway action:**
1. Parse SpO2 value
2. Send ACK with status code: `[SG*<protocolId>*0008*oxygen,1]`
   - "1" = normal, "2" = parameter error
3. Create `health_reading` event with metric="spo2"

**Code reference:** `gateway/src/protocol/gt06.js`, lines 272–287

#### bphrt (Blood Pressure + Heart Rate)

**Direction:** Device → Gateway  
**Introduced:** V46/V48/V52 protocol  
**Trigger:** After `hrtstart` command sent to device

**Payload format:**
```
bphrt,systolic,diastolic,heartRate[,<trailing unconfirmed fields>]

systolic     = Systolic pressure (mmHg)
diastolic    = Diastolic pressure (mmHg)
heartRate    = Beats per minute
[trailing]   = Additional fields present in device output but not documented;
               left unparsed to avoid guessing
```

**Example:**
```
[3G*9705314117*0010*bphrt,120,72,72,,,,]
                      └─ Systolic: 120, Diastolic: 72, HR: 72 BPM
                                                    └─ Trailing empty fields
```

**Gateway action:**
1. Parse systolic, diastolic, and heart rate
2. Send bare ACK: `[SG*<protocolId>*0005*bphrt]`
3. Create `health_reading` event with metric="heart_rate_bp"

**Note:** Only the first three fields are confirmed against vendor example captures. The trailing fields are unknown and intentionally left unparsed.

**Code reference:** `gateway/src/protocol/gt06.js`, lines 287–306

---

### 8. Unknown / Server Echo Commands

If a command is not recognized, the gateway:
1. Sends an ACK for compatibility: `[SG*<protocolId>*<lenHex>*<command>]`
2. Logs the event as `unknown_command` or `command_echo`

If the device echoes back a **server-only command** (CR, UPLOAD, FALLDOWN, etc.), the gateway silently drops it to prevent echo loops.

**Code reference:** `gateway/src/protocol/gt06.js`, lines 364–372

---

## Server-to-Device Commands (TCP Downlink)

Commands are sent **only over TCP** — there is no SMS fallback for newer devices. Older V28C devices support SMS alternatives, but Guardian's current implementation uses TCP only.

### Command Categories

**Documented in vendor spec:**
- `UPLOAD` — Set location reporting interval (seconds)
- `FALLDOWN` — Enable/disable fall detection
- `LSSET` — Fall sensitivity level
- `TAKEPILLS` — Schedule medication reminders
- `CR` — Force immediate location update

**Unverified (community source, not vendor doc):**
- `monitor` — Enable voice monitoring (RF-V28 community reference)
- `find` — Ring/beep to locate device

**Other vendor commands:**
- `sos1`, `sos2`, `sos3` — Set SOS numbers (SMS only on V28C)
- `pw,123456,center,<phone>#` — Set center number (SMS only)
- `ts#` — Status check (SMS only)

**See:** `gateway/src/commands.js` for full builder functions

---

## Parsing Code References

### Main Decoder Functions

| Function | Purpose | File | Lines |
|----------|---------|------|-------|
| `extractFrames(buffer)` | Find complete `[...]` frames in TCP stream | gt06.js | 153–173 |
| `decodeFrame(frame)` | Parse frame header and validate length | gt06.js | 175–210 |
| `handlePacket(decoded, session)` | Route by command type, extract data, generate events | gt06.js | 212–376 |
| `parseLocationData(fields)` | Parse DDMMYY, HHMMSS, validity, lat/lng, speed, course | gt06.js | 39–128 |
| `parseLkData(fields)` | Extract battery level from LK | gt06.js | 135–143 |
| `buildAckFrame(imei, command)` | Construct server ACK packet | gt06.js | 145–151 |

### Helper Modules

| Module | Purpose | File |
|--------|---------|------|
| IMEI normalization | 10-digit ↔ 15-digit IMEI conversion | imei.js |
| Geolocation | WiFi/cell tower → lat/lng (via Google API) | geolocate/google.js |
| Firestore writes | Location, alert, and device state persistence | firestore.js |
| Commands | SMS/TCP command builders | commands.js |
| Notifications | Push, SMS, WhatsApp dispatch | push.js, notify.js |

---

## Error Handling

### Parse Errors

- `invalid_frame_delimiters` — Frame doesn't start with `[` or end with `]`
- `incomplete_frame` — Fewer than 4 pipe-delimited parts
- `length_mismatch` — Payload length doesn't match LEN header
- `gps_not_fixed` — Location flag="V" with no WiFi/cell tower data
- `location_parse_error` — Invalid lat/lng, timestamp, or coordinate values

### Events Generated

| Event Type | Reason | Example |
|------------|--------|---------|
| `heartbeat` | LK received | Battery level, timestamp update |
| `location` | UD/UD2 received | GPS or WiFi/LBS location |
| `alarm` | AL received | SOS, fall, geofence, low battery |
| `health_reading` | oxygen/bphrt received | SpO2, heart rate, blood pressure |
| `imei_report` | CONFIG/RYIMEI with full IMEI | Device binding |
| `unknown_command` | Unrecognized command | Logged for debugging |
| `command_echo` | Server command echoed back | Silently dropped |
| `location_parse_error` | Invalid location fields | Logged with detail |

All parse errors are logged; none stop the gateway from processing subsequent packets.

---

## Testing & Simulation

Guardian includes a **packet simulator** for development:

```bash
npm run simulate
```

This generates fake LK, UD, and AL packets from a simulated device near Quatre Bornes, Mauritius, at realistic intervals. Useful for:
- Testing geofence logic
- Verifying alert notifications
- Developing without real hardware

**Simulator location:** `gateway/src/simulator.js`  
**Test suite:** `gateway/test/gt06*.test.js`

---

## Summary Table: Packet Types at a Glance

| Packet | Type | Dir | ACK? | Purpose | Payload |
|--------|------|-----|------|---------|---------|
| LK | Heartbeat | Up | Yes | Alive + battery | Steps, rolls, battery % |
| UD* | Location | Up | Yes | GPS location | Date, time, lat, lng, speed, course |
| UD2 | History | Up | No | Buffered locations | Same as UD (multiple) |
| AL* | Alarm | Up | Yes | Emergency + location | Date, time, lat, lng, + alarm code |
| CONFIG | Status | Up | Yes | Self-test | Device state (format varies) |
| RYIMEI | Identity | Up | Yes | Full IMEI | 15-digit IMEI |
| oxygen | Health | Up | Yes | SpO2 reading | Type, SpO2 % |
| bphrt | Health | Up | Yes | BP + HR | Systolic, diastolic, HR |
| (server) | Command | Down | — | Device control | UPLOAD, FALLDOWN, TAKEPILLS, etc. |

*Variants: UD_LTE, UD_WCDMA, UD_GPS; AL_LTE, AL_WCDMA (all parsed identically)

---

## Key Takeaways for Developers

1. **All frames are ASCII** — Easy to debug via logs and packet captures
2. **Protocol ID is always 10 digits** — Normalize to full 15-digit IMEI for Firestore
3. **Heartbeat = LK, not just silent TCP keepalive** — Battery and step counts come from LK
4. **Location validity flag (A/V) matters** — GPS accurate, WiFi/LBS approximate; geolocation needed for V
5. **Alarms are location updates + state flags** — AL packets carry lat/lng just like UD
6. **V46/V48/V52 are backwards-compatible** — Decoder handles all three with one function
7. **No offline command buffering** — Commands sent while device is offline are lost; device must be online
8. **Multiple variants of the same command** — UD vs. UD_LTE vs. UD_WCDMA all parsed the same way

---

## References

- **V28C Device Protocol:** `docs/reference/Switch-Server-SMS-Commands.pdf` (SMS commands only)
- **V46/V48/V52 Device Protocol:** Vendor "GPS Tracker Communication Protocol V46-V48-V52 2021-12-20" (internal reference)
- **Gateway Decoder:** `gateway/src/protocol/gt06.js`
- **IMEI Normalization:** `gateway/src/imei.js`
- **Test Suite:** `gateway/test/gt06.test.js` (packet decoding examples)
- **Simulator:** `gateway/src/simulator.js` (fake packet generation for testing)

---

**Next steps:**
- See [GATEWAY_OVERVIEW.md](GATEWAY_OVERVIEW.md) for complete gateway architecture
- See [DEVICE_TO_APP_FLOW.md](../02-architecture/DEVICE_TO_APP_FLOW.md) for how packets become user-facing alerts
- See [GEOFENCING.md](GEOFENCING.md) for safe-zone evaluation logic
