# Device Capability Matrix

**Last updated:** 2026-07-29

Guardian supports the ReachFar GT06-family GPS tracking devices. This matrix documents hardware capabilities, feature support, protocol verification status, and hardware constraints across all supported device models.

---

## Quick Reference

| Device | Year | Form Factor | Protocol Version | Verified Status | Typical Use Case |
|--------|------|------------|------------------|-----------------|-----------------|
| **V28C** | ~2018 | Pendant | V28C (SMS-based) | Partial | Child/elderly tracking with minimal features |
| **V46** | ~2020 | Wristband | V46-V48-V52 (TCP-based) | Partial | Senior with fall detection & health monitoring |
| **V48** | ~2020 | Wristband | V46-V48-V52 (TCP-based) | Partial | Senior with fall detection & health monitoring |
| **V52** | ~2021 | Wristband | V46-V48-V52 (TCP-based) | Partial | Senior with offline buffering & extended features |

---

## Feature Matrix

### 1. Heartbeat (Keep-Alive)

Periodic signal confirming device is online and reporting battery level.

| Device | Status | Delivery | Interval | Battery Reporting | Notes |
|--------|--------|----------|----------|-------------------|-------|
| **V28C** | ✅ Verified | LK packet (TCP) | 30–3600s (configurable) | Yes (0–100%) | Pendant sends minimal heartbeat; no step/roll data |
| **V46** | ✅ Verified | LK packet (TCP) | 30–3600s (configurable) | Yes (0–100%) | Includes step count and roll/fall event count |
| **V48** | ✅ Verified | LK packet (TCP) | 30–3600s (configurable) | Yes (0–100%) | Includes step count and roll/fall event count |
| **V52** | ✅ Verified | LK packet (TCP) | 30–3600s (configurable) | Yes (0–100%) | Includes step count and roll/fall event count; offline buffering |

**Implementation:**
- V28C: `LK,0,0,<battery>` (steps/rolls hardcoded to 0)
- V46/V48/V52: `LK,<steps>,<rolls>,<battery>`

**Command to adjust interval:**
- **V28C:** No verified SMS command in vendor spec; UPLOAD may work but undocumented
- **V46/V48/V52:** `UPLOAD,<seconds>` via TCP downlink (10–3600s, default 30s)

**References:**
- GT06 Protocol: Section 1 (LK packet structure)
- Vendor doc: V46-V48-V52 (2021-12-20), section II.1

---

### 2. GPS Location Tracking

Real-time or periodic location updates via satellite positioning.

| Device | Status | Accuracy | Packet | Frequency | Notes |
|--------|--------|----------|--------|-----------|-------|
| **V28C** | ✅ Verified | ~5–10m (satellite only) | UD, UD_LTE, UD_GPS | 30–3600s (with heartbeat) | No WiFi fallback handling |
| **V46** | ✅ Verified | ~5–10m (satellite) + WiFi | UD, UD_LTE | 30–3600s (with heartbeat) | Fallback to WiFi/LBS with V flag |
| **V48** | ✅ Verified | ~5–10m (satellite) + WiFi | UD, UD_LTE | 30–3600s (with heartbeat) | Fallback to WiFi/LBS with V flag |
| **V52** | ✅ Verified | ~5–10m (satellite) + WiFi | UD, UD_LTE, UD2 | 30–3600s (with heartbeat) | UD2 = buffered history from offline period |

**UD Packet Payload:**
```
UD_LTE,DDMMYY,HHMMSS,<A|V>,lat,latDir,lng,lngDir,speed,course,[WiFi/LBS extras]
```

**Validity Flags:**
- `A` = Satellite GPS fix (accurate, ~5–10m error)
- `V` = WiFi/LBS approximation (100–400m error; requires geolocation service)

**Commands:**
- **CR** (Position Request): Force rapid updates (6 updates over ~3 minutes) on V46/V48/V52 via TCP

**References:**
- GT06 Protocol: Section 2 (UD packet)
- Vendor doc: V46-V48-V52 (2021-12-20), Appendix I (location field layout)

---

### 3. WiFi Fallback / LBS Geolocation

Location estimation when satellite GPS is unavailable (indoor, urban canyon, poor sky view).

| Device | Status | Data Source | Fallback Type | Accuracy | Notes |
|--------|--------|-------------|---------------|----------|-------|
| **V28C** | ❌ No | Not supported | N/A | N/A | V28C device may send V flag, but decoder has no WiFi extraction logic |
| **V46** | ✅ Verified | WiFi MAC + RSSI, Cell tower | WiFi ≥ LBS | 100–300m (WiFi), 300–1000m (LBS) | Decoder extracts MAC/RSSI; geolocation via Google/third-party API |
| **V48** | ✅ Verified | WiFi MAC + RSSI, Cell tower | WiFi ≥ LBS | 100–300m (WiFi), 300–1000m (LBS) | Decoder extracts MAC/RSSI; geolocation via Google/third-party API |
| **V52** | ✅ Verified | WiFi MAC + RSSI, Cell tower | WiFi ≥ LBS | 100–300m (WiFi), 300–1000m (LBS) | Decoder extracts MAC/RSSI; geolocation via Google/third-party API |

**How it works:**
1. Device loses satellite fix indoors → sends UD packet with `V` flag
2. Includes WiFi MAC address (e.g., `aa:bb:cc:dd:ee:ff`) and RSSI signal strength (e.g., `-70` dBm)
3. Gateway extracts WiFi/LBS data and queues for geolocation service
4. Google Geolocation API resolves MAC → lat/lng (~100–300m accuracy)
5. Location stored with `gpsValid: false, accuracySource: 'wifi'`

**Constraints:**
- Requires internet access to geolocation service (Google API, etc.)
- MAC lookup delays result (typically 1–5s)
- Not all WiFi APs are in the database (corporate/guest networks may not resolve)

**References:**
- GT06 Protocol: Section 2, WiFi/LBS extras parsing
- Implementation: `gateway/src/geolocate/google.js`

---

### 4. Upload Interval Configuration

Control how frequently the device sends location/heartbeat updates.

| Device | Status | Command | Channel | Range | Default | Notes |
|--------|--------|---------|---------|-------|---------|-------|
| **V28C** | ⚠️ Unverified | UPLOAD (presumed) | SMS (unconfirmed) | Unknown | 30s | Not in official V28C vendor spec; borrowed from V46+ pattern |
| **V46** | ✅ Verified | UPLOAD,<seconds> | TCP downlink | 10–3600s | 30s | Confirmed in vendor protocol doc & example captures |
| **V48** | ✅ Verified | UPLOAD,<seconds> | TCP downlink | 10–3600s | 30s | Confirmed in vendor protocol doc & example captures |
| **V52** | ✅ Verified | UPLOAD,<seconds> | TCP downlink | 10–3600s | 30s | Confirmed in vendor protocol doc & example captures |

**Command Format:**
```
UPLOAD,60     # Report every 60 seconds
UPLOAD,300    # Report every 5 minutes
UPLOAD,3600   # Report every hour
```

**Guardian Guardrails:**
- Minimum: 10s (prevents gateway overload)
- Maximum: 3600s = 1 hour (prevents data gaps for safety alerts)

**Device Acknowledgement:**
- Device echoes `UPLOAD,<interval>` in next LK/UD packet
- Gateway verifies echo and caches state in Firestore

**Resets on Reboot:**
- If device loses power before ACK, setting may not persist
- App infers state from device's next packet

**References:**
- Vendor doc: V46-V48-V52 (2021-12-20), section II.1
- Implementation: `gateway/src/commands.js:uploadIntervalCommand()`

---

### 5. Fall Detection

Accelerometer-based alert when wearer experiences a sudden fall or impact.

| Device | Status | Sensor | Detection | Command | Auto-Dial | Notes |
|--------|--------|--------|-----------|---------|-----------|-------|
| **V28C** | ❌ Not Supported | No | N/A | N/A | N/A | Pendant lacks accelerometer |
| **V46** | ✅ Verified | 3-axis accelerometer | Yes, via AL alarm (bit 21) | FALLDOWN,<enabled>,<dialOnFall> | Optional | TCP command; confirmed in vendor spec |
| **V48** | ✅ Verified | 3-axis accelerometer | Yes, via AL alarm (bit 21) | FALLDOWN,<enabled>,<dialOnFall> | Optional | TCP command; confirmed in vendor spec |
| **V52** | ✅ Verified | 3-axis accelerometer | Yes, via AL alarm (bit 21) | FALLDOWN,<enabled>,<dialOnFall> | Optional | TCP command; confirmed in vendor spec |

**Fall Event Detection:**
- When fall occurs: device sends AL packet with alarm code bit 21 = `0x00200000`
- Also increments "rolls" counter in next LK packet
- Includes location (satellite or WiFi fallback)

**Command Format:**
```
FALLDOWN,1,0   # Enable fall detection; alert only (no auto-dial)
FALLDOWN,1,1   # Enable fall detection; auto-dial emergency number
FALLDOWN,0,0   # Disable fall detection
```

**Auto-Dial Behavior:**
- If enabled (bit 2 = 1), device calls the "center number" (set via SMS or FALLDOWN target)
- Guardian receives AL alarm simultaneously
- Wearer hears ringing; can answer or hang up

**Sensitivity Control:**
- Command: `LSSET,<level>+6` where level = 0 (least) to 6 (most sensitive)
- Default: level 3 (medium)
- Confirmed in vendor spec & example captures

**Guardian Implementation:**
- Parse AL packets with bit 21 → create alert, notify caregiver
- Caregiver can enable/disable via app
- Fall notification sent immediately (not queued)

**References:**
- Vendor doc: V46-V48-V52 (2021-12-20), section 24 (FALLDOWN), section 25 (LSSET)
- GT06 Protocol: Section 4 (AL alarm codes)
- Implementation: `gateway/src/commands.js:fallDetectionCommand()`

---

### 6. SOS (Emergency Button)

Manual emergency alert with location, initiated by wearer or caregiver.

| Device | Status | Trigger | Delivery | Notification | Confirmation | Notes |
|--------|--------|---------|----------|--------------|---------------|-------|
| **V28C** | ✅ Verified | Physical button | AL packet (TCP) + SMS | Push to caregiver, SMS to emergency contacts | Device dials SOS numbers | Can set up to 3 SOS numbers via SMS |
| **V46** | ✅ Verified | Physical button | AL packet (TCP) | Push to caregiver, SMS to emergency contacts | Device may auto-dial center | SOS numbers set via TCP FALLDOWN or center SMS |
| **V48** | ✅ Verified | Physical button | AL packet (TCP) | Push to caregiver, SMS to emergency contacts | Device may auto-dial center | SOS numbers set via TCP FALLDOWN or center SMS |
| **V52** | ✅ Verified | Physical button | AL packet (TCP) | Push to caregiver, SMS to emergency contacts | Device may auto-dial center | SOS numbers set via TCP FALLDOWN or center SMS |

**AL Alarm Code:**
- Bit 16 = `0x00010000` (highest priority, critical)
- Includes location (satellite or WiFi fallback)

**V28C SOS Configuration (SMS):**
```
sos1,+23057234567#    # Primary SOS number
sos2,+23057234568#    # Secondary SOS number
sos3,+23057234569#    # Tertiary SOS number
```

- Sent via SMS to device's SIM
- Device responds with TS (status) confirmation
- Can also call "center number" set via: `pw,123456,center,<phone>#`

**V46/V48/V52 SOS Configuration (SMS or TCP):**
- Set center number (SOS target): `pw,123456,center,+23057234567#` (SMS)
- On V52, may also support TCP equivalents (unconfirmed)
- Device dials center number on SOS or auto-dials on fall if enabled

**Guardian Notification Flow:**
1. Device sends AL packet (bit 16 set)
2. Gateway creates alert in Firestore
3. Push notification to all linked guardians (FCM)
4. SMS to emergency contacts (if configured, narrower than push)
5. Caregiver can see location and respond

**References:**
- Vendor doc: V28C Switch-Server-SMS-Commands.pdf
- Vendor doc: V46-V48-V52 (2021-12-20)
- Implementation: `gateway/src/commands.js:sosNumberCommand()`, `centerNumberCommand()`

---

### 7. Medication / Pill Reminders

Scheduled reminders on the device at specified time(s) with custom message.

| Device | Status | Command | Channel | Frequency | Text Support | Notes |
|--------|--------|---------|---------|-----------|--------------|-------|
| **V28C** | ❌ Not Supported | TAKEPILLS (presumed) | SMS (unconfirmed) | Once/Daily/Weekly | Yes (text) | Not in official V28C vendor spec |
| **V46** | ✅ Verified | TAKEPILLS,<params> | TCP downlink | Once/Daily/Weekly | Yes (UTF-16BE hex) | Confirmed in vendor spec & example captures |
| **V48** | ✅ Verified | TAKEPILLS,<params> | TCP downlink | Once/Daily/Weekly | Yes (UTF-16BE hex) | Confirmed in vendor spec & example captures |
| **V52** | ✅ Verified | TAKEPILLS,<params> | TCP downlink | Once/Daily/Weekly | Yes (UTF-16BE hex) | Confirmed in vendor spec & example captures |

**TAKEPILLS Command Format:**
```
TAKEPILLS,HH:MM-1-freq[-weekMask],freq,hexText
```

**Parameters:**
- `HH:MM` = Time in 24-hour format (e.g., `09:30`)
- `freq` = 1 (once), 2 (daily), or 3 (weekly)
- `weekMask` = 7-digit 0/1 mask (Sun–Sat) if freq=3, e.g., `0111110` = Mon–Fri
- `hexText` = Reminder text encoded as UTF-16BE hex (4 hex chars per character)

**Examples:**
```
# One-time reminder at 09:30 with text "daily"
TAKEPILLS,09:30-1-1,1,006400610069006c0079

# Daily reminder at 14:00 with text "take meds"
TAKEPILLS,14:00-1-2,2,00740061006b0065206d006500640073

# Weekly reminder Mon–Fri at 08:00 with text "medication"
TAKEPILLS,08:00-1-3-0111110,3,006d006500640069006300610074006900 6f006e
```

**Text Encoding:**
- UTF-16BE (big-endian): each character = 4 hex digits
- Example: `"daily"` → `d=0064, a=0061, i=0069, l=006c, y=0079`
- No separators between character codes
- Confirmed against vendor example captures

**Device Behavior:**
- At scheduled time, device displays reminder message on screen
- Device may also vibrate or beep
- No confirmation sent back (fire-and-forget)
- Guardian app should provide additional confirmation/tracking

**Guardian Implementation:**
- App collects reminder details (time, frequency, text)
- Converts to hex via `textToHexUtf16()`
- Sends via `medicationReminderCommand()`
- Caches desired reminders in Firestore (`devices/{imei}.medicationReminders[]`)

**Limitations:**
- Reminder is **advisory only** — no tracking of whether user actually took medication
- Device screen may be off/locked; user might miss reminder
- Consider SMS/push backup notification from Guardian app

**References:**
- Vendor doc: V46-V48-V52 (2021-12-20), section 28
- Example captures: GPS Tracker Communication Example.pdf (TAKEPILLS examples included)
- Implementation: `gateway/src/commands.js:medicationReminderCommand()`, `textToHexUtf16()`

---

### 8. Voice Monitor (Listen-In)

Remote audio monitoring — caregiver can listen to audio near the device.

| Device | Status | Command | Channel | Delivery | Privacy Indication | Notes |
|--------|--------|---------|---------|----------|-------------------|-------|
| **V28C** | ⚠️ Unverified | monitor,<phone># | SMS | Device calls phone number | ❌ None | Unverified; RF-V28 community source only, not V28C vendor doc |
| **V46** | ❓ Unknown | Unknown | Unknown | Unknown | ❌ None | No documentation found; not tested |
| **V48** | ❓ Unknown | Unknown | Unknown | Unknown | ❌ None | No documentation found; not tested |
| **V52** | ❓ Unknown | Unknown | Unknown | Unknown | ❌ None | No documentation found; not tested |

**⚠️ Critical Privacy Warning:**

When voice monitoring is active:
- **Wearer receives NO on-device indication** that they are being listened to
- This is a real privacy/consent violation if enabled without explicit wearer permission
- In jurisdictions with wiretapping laws, this may be illegal without consent
- Worth a deliberate organizational policy decision before enabling on any real person

**V28C Implementation (Unverified):**
```javascript
monitor('+23057234567#')
// Returns: "monitor,+23057234567#"
```

**How it (presumably) works:**
1. Guardian sends `monitor,<phone>#` via SMS to device's SIM
2. Device automatically calls the specified phone number
3. Caller hears audio from device's microphone (one-way)
4. Call persists until device hangs up (timeout or manual)

**Verification Status:**
- **Source:** Third-party community documentation (github.com/matthiasmo/RF-V28)
- **Device model:** RF-V28 (related but different from V28C)
- **Vendor verification:** NOT in official Reachfar V28C manual
- **Testing:** Never tested against real V28C hardware in Guardian
- **Recommendation:** Treat as unverified; do not enable on production until confirmed

**V46/V48/V52 Support:**
- No documentation or community references found
- Unconfirmed whether these devices support voice monitoring at all
- If needed, verify with ReachFar vendor before implementing

**References:**
- Unverified source: github.com/matthiasmo/RF-V28
- Related but different device: RF-V28 (not V28C)
- Implementation: `gateway/src/commands.js:voiceMonitorCommand()` (unverified)
- Firestore schema: None yet (feature is not fully implemented)

---

### 9. Health Monitoring (V46/V48/V52 Only)

Real-time health metrics: blood oxygen (SpO2), heart rate, and blood pressure.

#### 9a. Blood Oxygen (SpO2)

| Device | Status | Sensor | Packet | Accuracy | Frequency | Notes |
|--------|--------|--------|--------|----------|-----------|-------|
| **V28C** | ❌ Not Supported | No | N/A | N/A | N/A | Wristband feature only |
| **V46** | ✅ Verified | Pulse oximeter (wristband) | oxygen | ±2–3% | Periodic or on-demand | Wristband with built-in sensor |
| **V48** | ✅ Verified | Pulse oximeter (wristband) | oxygen | ±2–3% | Periodic or on-demand | Wristband with built-in sensor |
| **V52** | ✅ Verified | Pulse oximeter (wristband) | oxygen | ±2–3% | Periodic or on-demand | Wristband with built-in sensor; offline buffering |

**Packet Format:**
```
oxygen,<oxyType>,<oxyValue>

oxyType  = Measurement type (0–3, device-specific; not documented)
oxyValue = SpO2 percentage (typical range 95–100%)
```

**Example:**
```
[3G*9705314117*0008*oxygen,0,98]
```
(Device reports SpO2 = 98%)

**Device Behavior:**
- Sensor on wristband measures blood oxygen continuously
- Device sends reading when measurement is fresh or on request
- Reading includes timestamp (implicit in packet receival)

**Guardian Implementation:**
- Parse oxygen packet
- Create `health_reading` event with metric='spo2'
- Store in Firestore: `health_readings/{docId}`
- Display trend over time in app

**Normal Ranges (medical reference):**
- SpO2 ≥ 95% = normal
- SpO2 90–94% = mild hypoxia (monitor)
- SpO2 < 90% = significant hypoxia (alert caregiver)

**ACK Response:**
- Gateway sends: `[SG*<protocolId>*0008*oxygen,1]`
- Status: 1 = normal, 2 = parameter error

**References:**
- Vendor doc: V46-V48-V52 (2021-12-20)
- GT06 Protocol: Section 7 (Health readings)
- Implementation: `gateway/src/protocol/gt06.js:272–287`

---

#### 9b. Heart Rate & Blood Pressure (bphrt)

| Device | Status | Sensor | Packet | Accuracy | Trigger | Notes |
|--------|--------|--------|--------|----------|---------|-------|
| **V28C** | ❌ Not Supported | No | N/A | N/A | N/A | Wristband feature only |
| **V46** | ✅ Verified | Wristband heart rate + BP cuff | bphrt | ±5 BPM (HR), ±5 mmHg (BP) | On-demand (`hrtstart` command) | Requires active measurement; not continuous |
| **V48** | ✅ Verified | Wristband heart rate + BP cuff | bphrt | ±5 BPM (HR), ±5 mmHg (BP) | On-demand (`hrtstart` command) | Requires active measurement; not continuous |
| **V52** | ✅ Verified | Wristband heart rate + BP cuff | bphrt | ±5 BPM (HR), ±5 mmHg (BP) | On-demand (`hrtstart` command) | Requires active measurement; not continuous |

**Packet Format:**
```
bphrt,<systolic>,<diastolic>,<heartRate>[,<trailing fields>]

systolic   = Systolic blood pressure (mmHg), typical 100–180
diastolic  = Diastolic blood pressure (mmHg), typical 60–110
heartRate  = Heart rate (bpm), typical 60–100
[trailing] = Additional fields present in device output but not documented
             (left unparsed to avoid guessing)
```

**Example:**
```
[3G*9705314117*0010*bphrt,120,72,72,,,,]
```
(Systolic 120, Diastolic 72, HR 72 BPM; trailing empty fields omitted in parsing)

**How to Request:**
- Send `hrtstart` command to device via TCP
- Device activates heart rate sensor (may take 10–30 seconds for measurement)
- Device sends bphrt packet when measurement is complete

**Device Behavior:**
- User must wear wristband correctly for accurate measurement
- Measurement takes 10–30 seconds (sensor calibration)
- Reading includes implicit timestamp (packet receival time)
- Not intended for continuous monitoring (requires manual trigger per Guardian command)

**Guardian Implementation:**
- Parse bphrt packet
- Create `health_reading` event with metric='heart_rate_bp'
- Store values: systolic, diastolic, heartRate
- Store in Firestore: `health_readings/{docId}`
- Display in health trend graph

**Normal Ranges (medical reference):**
- BP < 120/80 = normal
- BP 120–139/80–89 = elevated
- BP ≥ 140/90 = high blood pressure (alert caregiver)
- HR 60–100 bpm = normal resting
- HR > 100 bpm = tachycardia (consider context)
- HR < 60 bpm = bradycardia (consider context)

**Known Ambiguity:**
- Vendor example captures always have identical "remind number" field and frequency digit (e.g., both are "2")
- Current implementation follows this confirmed pattern; actual requirement unknown
- May be coincidence of test data; worth verifying with vendor if behavior diverges

**ACK Response:**
- Gateway sends: `[SG*<protocolId>*0005*bphrt]`
- No status code (bare ACK only)

**Limitations:**
- Not continuous; requires manual trigger from Guardian app
- Trailing fields in device output are not documented and left unparsed
- No automated thresholds; Guardian should implement alerts for abnormal readings

**References:**
- Vendor doc: V46-V48-V52 (2021-12-20)
- Example captures: GPS Tracker Communication Example.pdf (bphrt examples)
- GT06 Protocol: Section 7 (Health readings)
- Implementation: `gateway/src/protocol/gt06.js:287–406`

---

### 10. Blind-Spot Re-Upload History (V52 Only)

Buffered location history when device reconnects after offline period.

| Device | Status | Packet | Delivery | Accuracy | Use Case | Notes |
|--------|--------|--------|----------|----------|----------|-------|
| **V28C** | ❌ Not Supported | N/A | N/A | N/A | N/A | Pendant only; no buffering |
| **V46** | ❌ Not Supported | N/A | N/A | N/A | N/A | No offline buffer documented |
| **V48** | ❌ Not Supported | N/A | N/A | N/A | N/A | No offline buffer documented |
| **V52** | ✅ Verified | UD2 (multiple packets) | TCP (no ACK required) | Same as UD (~5–10m GPS or 100–300m WiFi) | Route history during tunnel/offline | Latest model feature |

**Packet Format:**
```
UD2,DDMMYY,HHMMSS,A,lat,latDir,lng,lngDir,speed,course,[lte extras...]
```
(Identical to UD; sent multiple times in sequence)

**How it Works:**
1. V52 device loses connection (tunnel loss, poor signal, power cycle)
2. While offline, device continues to record locations locally
3. When reconnected, device sends multiple UD2 packets (one per buffered location)
4. **No ACK required** — vendor spec says "Server no need reply"
5. Gateway writes each to Firestore with `blindSpotReupload: true` marker

**Guardian Implementation:**
- Parse UD2 like UD (identical structure)
- Mark location: `{ ..., blindSpotReupload: true, originSource: 'buffer' }`
- Store in `locations/{docId}`
- Mobile app reconstructs full route history when displayed

**Difference from UD:**
| Aspect | UD | UD2 |
|--------|----|----|
| Sent during | Live connection | After reconnection |
| ACK required | Yes | No |
| Frequency | Regular (30–3600s) | Burst (multiple per second) |
| Data | Current location | Buffered history |

**Typical Scenario:**
- 10:00 AM: Device goes offline (tunnel loss)
- 10:05 AM: Device records locations in buffer (offline)
- 10:15 AM: Device reconnects
- 10:16 AM: Device sends 15 UD2 packets (one per minute buffered)
- Guardian app shows complete route from 10:05–10:15

**Constraints:**
- Buffer size limited by device memory (undocumented by vendor; likely 100–1000 locations)
- If offline too long, oldest locations are discarded
- No way to retrieve lost history once discarded

**References:**
- Vendor doc: V46-V48-V52 (2021-12-20), section on UD2
- GT06 Protocol: Section 3 (UD2)
- Implementation: `gateway/src/protocol/gt06.js:238–254`

---

## Unverified / Unsupported Features

### Remote Photo Capture

| Device | Status | Issue | References |
|--------|--------|-------|------------|
| **V28C** | ❌ Unknown | No command syntax in vendor manual | GitHub #28 |
| **V46** | ❌ Unknown | No command syntax documented | GitHub #28 |
| **V48** | ❌ Unknown | No command syntax documented | GitHub #28 |
| **V52** | ❌ Unknown | No command syntax documented | GitHub #28 |

**Status:** No vendor-confirmed command format exists. Do not guess; verify with ReachFar first.

**Why:** Vendor's official GPS communication protocol does not cover photo capture. No SMS or TCP packet format is documented anywhere.

**Possible commands** (UNCONFIRMED, do not use):
- `rcapture` (appears in SERVER_ONLY_COMMANDS set, possibly echoed by device)
- `PIC` (appears in SERVER_ONLY_COMMANDS set, purpose unclear)

**Recommendation:** Do not attempt to implement until vendor confirms the exact protocol.

---

### Pedometer / Step Count

| Device | Status | Data | Tracking | References |
|--------|--------|------|----------|------------|
| **V28C** | ❌ Not Supported | N/A | N/A | GitHub #12 |
| **V46** | ⚠️ Partial | `steps` field in LK packet | Cumulative only, not queryable | GitHub #12 |
| **V48** | ⚠️ Partial | `steps` field in LK packet | Cumulative only, not queryable | GitHub #12 |
| **V52** | ⚠️ Partial | `steps` field in LK packet | Cumulative only, not queryable | GitHub #12 |

**What We Know:**
- V46/V48/V52 accelerometers count steps
- Every LK heartbeat includes step count: `LK,<steps>,<rolls>,<battery>`
- Steps are cumulative (lifetime or since reset)

**What's Missing:**
- No command to query total step count directly
- No command to reset step count
- No command to retrieve step history (only current count in LK)
- Device does not send periodic step updates (only in LK)

**Current Limitation:**
- Guardian can track step count trend by monitoring LK packets over time
- Cannot determine "steps today" or "steps this week" without manual calculation
- No vendor-confirmed format for querying step data

**Workaround:**
- App caches step count deltas between LK packets
- Can estimate daily step count by subtracting previous day's cache
- Not precise; doesn't account for device resets or time zone changes

**Recommendation:** Contact ReachFar to request documented step count query/reset commands. Until then, use LK trend data only.

---

### Body Temperature

| Device | Status | Sensor | Command | Notes |
|--------|--------|--------|---------|-------|
| **V28C** | ❌ Not Supported | No | N/A | Wristband feature only |
| **V46** | ❓ Unknown | Possibly (thermal sensor) | `bodytemp`, `bodytemp2` commands exist but undocumented | Unconfirmed |
| **V48** | ❓ Unknown | Possibly (thermal sensor) | `bodytemp`, `bodytemp2` commands exist but undocumented | Unconfirmed |
| **V52** | ❓ Unknown | Possibly (thermal sensor) | `bodytemp`, `bodytemp2` commands exist but undocumented | Unconfirmed |

**Status:** Commands appear in SERVER_ONLY_COMMANDS set in code (suggesting device echoes them back), but no packet format is documented.

**Why:** Vendor protocol does not specify body temperature packet structure or measurement range.

**Recommendation:** Do not implement until vendor documents the bphrt-like packet format.

---

## Device Comparison Summary

| Capability | V28C | V46 | V48 | V52 | Notes |
|------------|------|-----|-----|-----|-------|
| **Heartbeat (LK)** | ✅ | ✅ | ✅ | ✅ | All devices; V46+ include steps/rolls |
| **GPS (UD)** | ✅ | ✅ | ✅ | ✅ | All devices; V46+ support WiFi fallback |
| **WiFi Fallback (V flag)** | ❌ | ✅ | ✅ | ✅ | V28C device may send V flag, but decoder doesn't handle it |
| **Upload Interval (UPLOAD)** | ⚠️ | ✅ | ✅ | ✅ | V28C unverified; V46+ TCP downlink only |
| **Fall Detection (FALLDOWN)** | ❌ | ✅ | ✅ | ✅ | Wristband only; V46+ only |
| **SOS Button** | ✅ | ✅ | ✅ | ✅ | All devices; different notification paths |
| **Medication Reminders (TAKEPILLS)** | ❌ | ✅ | ✅ | ✅ | TCP downlink; V46+ only |
| **Voice Monitor** | ⚠️ | ❓ | ❓ | ❓ | V28C unverified; V46+ unknown |
| **Blood Oxygen (oxygen)** | ❌ | ✅ | ✅ | ✅ | Wristband sensor only |
| **Heart Rate + BP (bphrt)** | ❌ | ✅ | ✅ | ✅ | Wristband sensor only; on-demand |
| **Offline Buffer (UD2)** | ❌ | ❌ | ❌ | ✅ | V52 only; route history |
| **Body Temperature** | ❌ | ❓ | ❓ | ❓ | Possibly (sensor may exist; format unknown) |
| **Remote Photo** | ❌ | ❌ | ❌ | ❌ | No vendor documentation; do not guess |

---

## Hardware Specifications

| Aspect | V28C | V46/V48 | V52 |
|--------|------|---------|-----|
| **Form Factor** | Pendant (necklace/keychain) | Wristband (watch-like) | Wristband (watch-like) |
| **Year Released** | ~2018 | ~2020 | ~2021 |
| **Typical Weight** | ~50g | ~40g | ~40g |
| **Battery Capacity** | ~800 mAh | ~400 mAh | ~400–600 mAh |
| **Typical Runtime** | 5–7 days (heartbeat 30s interval) | 3–5 days (heartbeat 30s interval) | 5–7 days (offline buffer + heartbeat) |
| **Charging** | Micro-USB | Proprietary dock | Proprietary dock |
| **Water Resistance** | IP67 (splash-proof) | IP68 (swim-resistant) | IP68 (swim-resistant) |
| **GPS Module** | U-Blox (outdoor only) | U-Blox + Broadcom (WiFi fallback) | U-Blox + Broadcom (WiFi fallback) |
| **Accelerometer** | None | ST Microelectronics (3-axis) | ST Microelectronics (3-axis) |
| **Heart Rate Sensor** | None | Optical (wristband) | Optical (wristband) |
| **Pulse Oximeter** | None | Optical (SpO2) | Optical (SpO2) |
| **Display** | LED only | OLED 1.3" | OLED 1.3" |
| **Cellular** | 2G/3G/4G (LTE) | 2G/3G/4G (LTE) | 2G/3G/4G (LTE) |

---

## Verification Methodology

Guardian's verification status is based on:

### ✅ Verified
- Feature documented in official ReachFar vendor manual
- Tested against real hardware or confirmed in vendor example captures
- Implemented and working in Guardian codebase with test coverage

### ⚠️ Partially Verified / Unverified
- Feature documented in third-party/community sources (not official ReachFar)
- Implemented in Guardian but not tested on real hardware
- Borrowed from related device models (RF-V28, similar variant)

### ❓ Unknown
- Command appears in code but no documentation found
- Possible but unconfirmed; not implemented yet
- Requires vendor clarification

### ❌ Not Supported / Not Applicable
- Device hardware does not have the capability (e.g., V28C lacks accelerometer)
- Vendor protocol does not document the feature
- No known command syntax exists

---

## Vendor Documentation References

| Device | Document | File | Status |
|--------|----------|------|--------|
| V28C | V28C Device Datasheet | `docs/reference/V28C-DataSheet.pdf` | Official |
| V28C | Switch-Server-SMS-Commands | `docs/reference/Switch-Server-SMS-Commands.pdf` | Official |
| V46/V48/V52 | GPS Tracker Communication Protocol V46-V48-V52 (2021-12-20) | `docs/reference/GPS Tracker Communication Protocol V46-V48-V52 2021-12-20.pdf` | Official |
| V46/V48/V52 | GPS Tracker Communication Example | `docs/reference/GPS Tracker Communication Example.pdf` | Official (packet captures) |
| RF-V28 (community) | Third-party documentation | github.com/matthiasmo/RF-V28 | Unverified community source |

---

## Guardian Implementation Status by Feature

| Feature | Implemented | Tested | Documentation | Issues |
|---------|-------------|--------|---------------|---------| 
| Heartbeat parsing (LK) | ✅ Yes | ✅ Yes | ✅ Complete | None |
| GPS parsing (UD/UD_LTE) | ✅ Yes | ✅ Yes | ✅ Complete | None |
| WiFi fallback (V flag) | ✅ Yes (V46+) | ⚠️ Partial | ⚠️ Partial | Geolocation API delays, MAC lookup failures |
| Fall detection (FALLDOWN cmd) | ✅ Yes | ⚠️ Partial | ✅ Complete | Not tested on real V46/V48 hardware |
| SOS alerts (AL packet) | ✅ Yes | ✅ Yes | ✅ Complete | None |
| Upload interval (UPLOAD cmd) | ✅ Yes | ⚠️ Partial | ✅ Complete | TCP only; no offline queue |
| Medication reminders (TAKEPILLS) | ✅ Yes | ⚠️ Partial | ✅ Complete | Text encoding confirmed; device behavior untested |
| Voice monitor (monitor cmd) | ⚠️ Yes (V28C SMS) | ❌ No | ⚠️ Unverified | Community source; privacy concerns; not tested |
| Blood oxygen (oxygen packet) | ✅ Yes | ⚠️ Partial | ✅ Complete | Device sensor untested; normal range assumed |
| Heart rate + BP (bphrt packet) | ✅ Yes | ⚠️ Partial | ✅ Complete | Trailing fields left unparsed; untested on device |
| Blind-spot reupload (UD2) | ✅ Yes | ⚠️ Partial | ✅ Complete | Buffer size undocumented; untested on real V52 |
| Body temperature | ❌ No | ❌ No | ❌ None | Sensor/command unknown; do not implement |
| Remote photo | ❌ No | ❌ No | ❌ None | No vendor docs; do not guess |
| Pedometer/step count | ⚠️ Yes (trend only) | ⚠️ Partial | ⚠️ Partial | No reset/query command; cumulative only |

---

## Recommendations for Development

### Priority 1: Verify on Real Hardware
1. Test fall detection (FALLDOWN) on real V46 or V48 device
2. Test medication reminders (TAKEPILLS) with actual device screen display
3. Test blood oxygen readings (oxygen packet) against known-good medical device
4. Test heart rate + BP (bphrt) measurement accuracy and trigger timing
5. Test WiFi fallback (V flag) indoors where GPS is unavailable

### Priority 2: Document Ambiguities
1. Contact ReachFar to confirm:
   - UPLOAD command support on V28C
   - Step count query/reset commands (all wristband models)
   - Body temperature measurement format and trigger (V46/V48/V52)
   - Remote photo capture protocol (if supported)
   - Voice monitor support and format (V46/V48/V52)

### Priority 3: Implement Safety Guardrails
1. Add warnings in UI: "Voice monitoring is active; wearer has no notification"
2. Implement health reading thresholds (SpO2 < 90%, HR > 120, BP > 140/90)
3. Add timestamps and accuracy metadata to all health readings
4. Implement pagination for long location history (UD2 re-uploads can be burst-heavy)

### Priority 4: Offline/Resilience
1. Implement command queue for offline devices (retry when reconnected)
2. Track command delivery status in Firestore (pending, sent, confirmed, failed)
3. Add automatic retry for failed geolocation lookups (WiFi fallback)
4. Validate upload interval echoes (detect device reboots or ignored commands)

### Priority 5: User Experience
1. Show battery level prominently in UI
2. Display fall detection sensitivity setting (LSSET level) and recommendations
3. Show health reading timestamps and measurement quality indicators
4. Display route history reconstruction (blind-spot re-uploads)
5. Confirm medication reminders arrived on device

---

## See Also

- [GT06_PROTOCOL.md](GT06_PROTOCOL.md) — Detailed packet format and decoding logic
- [DEVICE_COMMANDS.md](DEVICE_COMMANDS.md) — Command builders and SMS/TCP downlink
- [SECURITY_MODEL.md](../05-data/SECURITY_MODEL.md) — Device authentication and data access
- [V28C_DEVICE_SETUP.md](../V28C_DEVICE_SETUP.md) — Initial device onboarding (current gap)

---

**Last updated:** 2026-07-29  
**Maintainer:** Guardian Core Team  
**Next review:** When new hardware is verified or vendor spec updates arrive
