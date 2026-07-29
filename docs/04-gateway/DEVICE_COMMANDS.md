# Device Commands Reference

**Last updated:** 2026-07-29

The Guardian gateway communicates with the GPS pendant (V28C, V46, V48, V52) by sending device commands. This document covers command format, delivery channels, device acknowledgement, and verification status.

## Overview

Commands are dispatched via two channels:

| Channel | Device | Delivery | Status | Fallback |
|---------|--------|----------|--------|----------|
| **SMS** | V28C | Pendant's SIM number | Async (seconds/minutes) | None required |
| **TCP Downlink** | V46, V48, V52 | Live TCP session | Synchronous | None — fails if offline |

**Critical:** TCP-only commands (UPLOAD, FALLDOWN, TAKEPILLS) have **no SMS fallback**. The device must have an active connection to the gateway. If offline, `sendDeviceCommand()` raises an error rather than silently queuing.

## SMS Commands (V28C)

SMS commands use the syntax from the vendor's **Switch-Server-SMS-Commands.pdf** (the official V28C documentation). These are sent to the device's SIM number as recorded in Firestore (`devices/{imei}.simNumber`).

### Center Number

Sets the "center number" — the phone number the device dials for SOS / emergency.

**Format:**
```
pw,123456,center,<phone>#
```

**Parameters:**
- `<phone>` — Phone number (e.g., `+23057234567`)

**Example:**
```
pw,123456,center,+23057234567#
```

**Implementation:**
```javascript
centerNumberCommand('+23057234567')
// Returns: "pw,123456,center,+23057234567#"
```

**Vendor Source:** Switch-Server-SMS-Commands.pdf

---

### SOS Number (Slots 1-3)

Sets one of three SOS phone numbers that the device dials when the user presses the button.

**Format:**
```
sos<slot>,<phone>#
```

**Parameters:**
- `<slot>` — 1, 2, or 3 (three available slots)
- `<phone>` — Phone number (e.g., `+23057234567`)

**Example:**
```
sos1,+23057234567#
sos2,+23057234568#
sos3,+23057234569#
```

**Implementation:**
```javascript
sosNumberCommand(1, '+23057234567')
// Returns: "sos1,+23057234567#"
```

**Device Acknowledgement:**
- Device will send a `TS` status response to confirm receipt (may be seconds/minutes later)

**Vendor Source:** Switch-Server-SMS-Commands.pdf

---

### Status Check

Forces the device to send a status report (battery, signal, location).

**Format:**
```
ts#
```

**Example:**
```
ts#
```

**Implementation:**
```javascript
statusCommand()
// Returns: "ts#"
```

**Device Acknowledgement:**
- Device responds with `TS` packet containing current battery %, signal strength, and location

**Vendor Source:** Switch-Server-SMS-Commands.pdf

---

### Voice Monitor (Unverified)

Enables voice monitoring on the device — the device will call the specified number so the monitor can listen in.

**Format:**
```
monitor,<phone>#
```

**Parameters:**
- `<phone>` — Monitor's phone number (e.g., `+23057234567`)

**Example:**
```
monitor,+23057234567#
```

**Implementation:**
```javascript
voiceMonitorCommand('+23057234567')
// Returns: "monitor,+23057234567#"
```

**⚠️ Verification Status: UNVERIFIED**
- This command is not in the V28C vendor datasheet
- Documented for the **RF-V28** (a related but different hardware model by the same manufacturer)
- Source: Third-party community documentation (github.com/matthiasmo/RF-V28), not Reachfar's official V28C manual
- **Not tested against real V28C hardware**
- Treat as higher-confidence-but-unverified until validated

**Privacy Note:**
- When enabled, the wearer receives **no on-device indication** that they are being listened to
- This is a real privacy/consent concern, not just a testing caveat
- Worth a deliberate decision before use on a real person

**Vendor Source:** Not in official V28C docs; RF-V28 community reference only

---

## TCP Downlink Commands (V46/V48/V52)

TCP downlink commands are sent via the device's live TCP session with the gateway. These commands come from the vendor's **GPS Tracker Communication Protocol V46-V48-V52** documentation and confirmed against their example packet captures.

**Key constraint:** These commands have **no SMS equivalent**. If the device is offline or has no active TCP connection, delivery fails immediately.

All TCP downlink commands follow this frame structure:

```
[SG*<protocolId>*<length>*<command>]
```

Where:
- `<protocolId>` — 10-digit protocol ID (extracted from device's initial connection)
- `<length>` — Hex-encoded message length
- `<command>` — Actual command payload (built by the command functions below)

The gateway's `sendDownlinkCommand()` function handles framing; you only construct the command payload.

---

### UPLOAD (Reporting Interval)

Sets the device's standing location-reporting interval.

**Format:**
```
UPLOAD,<seconds>
```

**Parameters:**
- `<seconds>` — Integer seconds between reports (10–3600)
  - **Minimum:** 10 seconds (UX guardrail; vendor doc specifies no floor)
  - **Maximum:** 3600 seconds = 1 hour (UX guardrail; vendor doc specifies no ceiling)
  - Device will default to 30 seconds on boot if not explicitly set

**Example:**
```
UPLOAD,60
```
(Report location every 60 seconds)

**Implementation:**
```javascript
uploadIntervalCommand(60)
// Returns: "UPLOAD,60"
```

**Device Acknowledgement:**
- Device echoes `UPLOAD,<interval>` in its next heartbeat packet
- Gateway's downlink handler verifies the echo against the requested value
- If echoed value matches: command is confirmed; app caches state in Firestore

**Resets on reboot:**
- If device reboots before acknowledging, the command may not persist
- App does not know until device reconnects (status is inferred, not confirmed)

**Protocol Spec:** GPS Tracker Communication Protocol V46-V48-V52, section II.1

---

### FALLDOWN (Fall Detection)

Enables or disables fall detection and optionally auto-dials a monitor on fall.

**Format:**
```
FALLDOWN,<enabled>,<dialOnFall>
```

**Parameters:**
- `<enabled>` — 1 (on) or 0 (off)
- `<dialOnFall>` — 1 (auto-dial monitor on fall) or 0 (send alert only, no auto-dial)

**Examples:**
```
FALLDOWN,1,0
```
(Enable fall detection; send alert but don't auto-dial)

```
FALLDOWN,1,1
```
(Enable fall detection; auto-dial monitor when fall detected)

```
FALLDOWN,0,0
```
(Disable fall detection)

**Implementation:**
```javascript
fallDetectionCommand({ enabled: true, dialMonitorOnFall: false })
// Returns: "FALLDOWN,1,0"

fallDetectionCommand({ enabled: true, dialMonitorOnFall: true })
// Returns: "FALLDOWN,1,1"
```

**Device Acknowledgement:**
- Device echoes `FALLDOWN,<enabled>,<dialOnFall>` in its next packet
- Gateway verifies echo; app caches desired state in Firestore

**Monitor Number:**
- If `dialOnFall = 1`, the device dials the "center number" (set via `center` SMS command)
- No separate monitor phone is specified in this command; reuse the emergency center

**Protocol Spec:** GPS Tracker Communication Protocol V46-V48-V52, section 24; confirmed in vendor example captures as `[3G*IMEI*LEN*FALLDOWN,1,1]`

---

### LSSET (Fall Sensitivity)

Adjusts the accelerometer sensitivity for fall detection (0 = least sensitive, 6 = most sensitive).

**Format:**
```
LSSET,<level>+6
```

**Parameters:**
- `<level>` — Integer 0–6
  - 0 = least sensitive (fewer false positives, may miss real falls)
  - 6 = most sensitive (detects more falls, more false positives)
- `+6` — Vendor-fixed constant (always appended; not a second parameter)

**Examples:**
```
LSSET,3+6
```
(Medium sensitivity)

```
LSSET,5+6
```
(High sensitivity)

**Implementation:**
```javascript
fallSensitivityCommand(5)
// Returns: "LSSET,5+6"
```

**Device Acknowledgement:**
- Device echoes `LSSET,<level>+6` in its next packet
- Gateway verifies; app caches setting

**Default:**
- Device defaults to level 3 (medium) on boot if not set

**Protocol Spec:** GPS Tracker Communication Protocol V46-V48-V52, section 25; confirmed in vendor example captures

---

### TAKEPILLS (Medication Reminders)

Schedules a medication reminder with a time, frequency (once/daily/weekly), and text message.

**Format:**
```
TAKEPILLS,<time>-<enabled>-<frequency>[-<week>],<frequency>,<hexText>
```

**Parameters:**
- `<time>` — HH:MM (24-hour format, e.g., `09:30`)
- `<enabled>` — 1 (on) or 0 (off)
- `<frequency>` — 1 (once), 2 (daily), or 3 (weekly)
- `<week>` — 7-digit Sun–Sat on/off mask (e.g., `0111110` = Mon–Fri), required if frequency is 3
- `<hexText>` — Reminder text, UTF-16BE hex-encoded (4 hex chars per character, no separators)

**Text Encoding (UTF-16BE):**

The device uses a specific hex encoding for reminder text:

```javascript
textToHexUtf16('daily')
// Returns: "006400610069006c0079"
// Breakdown: d=0064, a=0061, i=0069, l=006c, y=0079

textToHexUtf16('weekly')
// Returns: "007700650065006b006c0079"
// Breakdown: w=0077, e=0065, e=0065, k=006b, l=006c, y=0079
```

This encoding is confirmed against vendor example packet captures.

**Examples:**

One-time reminder at 09:30:
```
TAKEPILLS,09:30-1-1,1,0064006100690006c0079
```

Daily reminder at 14:00:
```
TAKEPILLS,14:00-1-2,2,0064006100690006c0079
```

Weekly reminder every weekday (Mon–Fri) at 08:00:
```
TAKEPILLS,08:00-1-3-0111110,3,0064006100690006c0079
```

**Implementation:**
```javascript
medicationReminderCommand({
  time: '09:30',
  frequency: 1,  // once
  text: 'daily'
})
// Returns: "TAKEPILLS,09:30-1-1,1,006400610069006c0079"

medicationReminderCommand({
  time: '14:00',
  frequency: 2,  // daily
  text: 'medication'
})
// Returns: "TAKEPILLS,14:00-1-2,2,006d006500640069006300610074006900 ..."

medicationReminderCommand({
  time: '08:00',
  frequency: 3,  // weekly
  week: '0111110',  // Sun=0, Mon-Fri=1, Sat=0
  text: 'take meds'
})
// Returns: "TAKEPILLS,08:00-1-3-0111110,3,00740061006b0065..."
```

**Device Acknowledgement:**
- Device echoes `TAKEPILLS,<timeSegment>,<frequency>,<hexText>` in response
- Gateway verifies echo matches request
- Confirmed against 3 vendor example packet captures (once, daily, weekly)

**Ambiguity in Protocol:**
- In all 3 vendor example captures, the "remind number" field (right after the time segment) is always identical to the frequency digit (1, 2, or 3)
- This may be a coincidence of test data or a real requirement
- Current implementation follows the confirmed pattern from the captures rather than guessing

**Protocol Spec:** GPS Tracker Communication Protocol V46-V48-V52, section 28; confirmed against vendor example packet captures

---

### CR (Position Request)

Forces the device to send GPS updates every 30 seconds for the next 3 minutes (6 total updates).

**Format:**
```
CR
```

**Example:**
```
CR
```

**Implementation:**
```javascript
// No builder function; sent directly via sendDownlinkCommand()
sendDownlinkCommand(imei, 'CR')
```

**Device Acknowledgement:**
- None — best-effort command
- Device may not send the expected 6 updates if it loses connection or reboots
- No verification mechanism

**Use Case:**
- Force an immediate position update when the guardian needs current location urgently
- Gateway will receive 6 rapid updates over ~3 minutes

**Protocol Spec:** GPS Tracker Communication Protocol V46-V48-V52; commonly used in real-world deployments

---

### FIND (Ring/Locate)

Triggers an audible alert on the device so the wearer can locate it (e.g., if lost in a bag).

**Format:**
```
FIND#
```

**Example:**
```
FIND#
```

**Implementation:**
```javascript
ringToFindCommand()
// Returns: "find#"
```

**Device Acknowledgement:**
- None — best-effort command
- Device will emit an audible tone/vibration but may not send a packet back
- No way to confirm the device heard it

**⚠️ Verification Status: PARTIALLY VERIFIED**
- The command format is borrowed from the RF-V28 (third-party community source)
- Not explicitly in the V28C vendor manual
- Format compatibility with V52 is unconfirmed
- Treat as unverified until tested on real hardware

**Use Case:**
- User has misplaced the device (on another person, in a room)
- Guardian taps "Find" in the app to make it ring

**Vendor Source:** RF-V28 community reference (github.com/matthiasmo/RF-V28), not V28C vendor docs

---

## Unverified / Unsupported Commands

### Remote Photo Capture

**Status:** No command syntax or protocol packet format documented.

**Why:** The vendor's communication protocol doesn't cover photo capture. No SMS command or TCP downlink format is available in any official Reachfar documentation.

**Workaround:** None. Don't attempt to guess the format — verify with the vendor first.

**GitHub Issue:** #28

---

### Pill/Medication Reminders (Pill Box)

The `TAKEPILLS` command schedules text-based reminders on the device. However, some third-party integrations hope for a "smart pill box" that the pendant can communicate with (e.g., to remind about which medication, or to receive compliance data back from the box).

**Status:** No command syntax documented.

**Why:** The vendor's protocol doesn't cover pill-box pairing or bidirectional sync.

**Workaround:** Use the text reminder (TAKEPILLS) as a notification only. Accept that compliance data must come from manual user input, not automated sync.

**GitHub Issue:** #29

---

### Pedometer / Step Count

**Status:** No command syntax or data format documented.

**Why:** While some ReachFar models have accelerometers that could theoretically count steps, there's no protocol coverage for querying or resetting step data.

**Workaround:** None yet. Verify with the vendor whether the V28C/V52 can expose step count via TCP downlink.

**GitHub Issue:** #12

---

## Delivery Channels

### SMS Channel (V28C)

**How it works:**
1. App or gateway wants to send a command (e.g., set center number)
2. Gateway looks up `devices/{imei}.simNumber` from Firestore
3. Constructs SMS text using the command builder (e.g., `centerNumberCommand()`)
4. Calls `sendSms(simNumber, text)` via Twilio or vendor SMPP gateway
5. SMS is delivered to device's SIM
6. Device receives, processes, and may send a response

**Requirements:**
- Device SIM number must be on file in Firestore
- Device must have cellular coverage (GPRS/LTE)
- Device may take seconds/minutes to respond

**Response Time:**
- Typically 5–30 seconds
- May be delayed if device is in deep sleep or poor signal

**Fallback:**
- No automatic retry or SMS fallback — SMS is the only fallback
- If SMS delivery fails, command is lost

**Delivery Confirmation:**
- Gateway logs the SMS outbound; Firestore does not
- No receipt tracking from the carrier

---

### TCP Downlink Channel (V46/V48/V52)

**How it works:**
1. App writes desired state to Firestore: `devices/{imei}.fallDetection = true`
2. Gateway watches `deviceCommands` collection for queued commands
3. Looks up active TCP session for the device via `findSocketsForDevice(imei)`
4. Builds frame using `buildAckFrame(protocolId, command)`
5. Writes frame on the socket
6. Device receives on its TCP session and processes synchronously
7. Device echoes the command in its next regular packet

**Requirements:**
- Device must have a live TCP connection to gateway
- Connection must be open **right now** (no async queue)
- No SMS fallback exists

**Response Time:**
- Immediate (device processes on the open connection)
- Echo arrives in the next heartbeat (within ~30 seconds)

**Failure Mode:**
- If device is offline: `sendDownlinkCommand()` returns `{ ok: false, error: 'no_active_session' }`
- Command is **not** queued for later retry
- App must inform the user: "Device is offline; command could not be delivered"

**Error Handling (in `commands.js`):**
```javascript
if (TCP_ONLY_TYPES.has(type)) {
  const result = sendDownlinkCommand(imei, text);
  if (!result.ok) {
    throw new Error(
      `Device has no active connection right now — ${type} requires a live session (no SMS fallback exists for this command)`
    );
  }
  return { text, channel: 'tcp', result };
}
```

---

## Device Echo Verification

When the device receives a command, it echoes the command (or a subset of it) in its next outbound packet. The gateway uses this echo to confirm delivery.

| Command | Echo Field | Checked By |
|---------|-----------|-----------|
| UPLOAD | `UPLOAD,<interval>` | `protocol/gt06.js` parser |
| FALLDOWN | `FALLDOWN,<enabled>,<dialOnFall>` | Parser |
| TAKEPILLS | `TAKEPILLS,<time>-<enabled>-<freq>[-<week>],<freq>,<hexText>` | Parser |
| LSSET | `LSSET,<level>+6` | Parser |
| CR | None (best-effort) | — |
| FIND | None (best-effort) | — |
| monitor (unverified) | None documented | Unverified |
| SMS commands (center, sos, ts) | Device may respond with `TS` packet | Async; no automatic check |

### Echo Matching Logic

The gateway does not yet implement automatic echo matching and state update. The current flow is:

1. `sendDeviceCommand()` sends the command via TCP or SMS
2. Gateway returns `{ text, channel, result }`
3. **App caches the desired state in Firestore** (`devices/{imei}.fallDetection = true`)
4. When device sends next packet with echo, parser receives it but **does not verify it matches the request**
5. App assumes state is correct if no error occurred during send

**Improvement needed:** Implement automated echo verification to catch:
- Device reboots before acknowledging
- Device ignores the command
- Device echoes a different value (corruption, malfunction)

See GitHub issue #XX for tracking.

---

## Gateway Implementation

### Command Builder API

All command builders live in `gateway/src/commands.js`:

```javascript
const {
  centerNumberCommand,
  sosNumberCommand,
  statusCommand,
  voiceMonitorCommand,
  ringToFindCommand,
  fallDetectionCommand,
  fallSensitivityCommand,
  medicationReminderCommand,
  uploadIntervalCommand,
  textToHexUtf16,
} = require('./src/commands');
```

### Sending a Command

```javascript
const { sendDeviceCommand } = require('./src/commands');

// SMS command (V28C)
const result = await sendDeviceCommand(db, imei, 'set_center_number', {
  phone: '+23057234567'
});
// Returns: { text: "pw,123456,center,+23057234567#", channel: 'sms', simNumber, result }

// TCP downlink command (V46/V48/V52)
const result = await sendDeviceCommand(db, imei, 'set_fall_detection', {
  enabled: true,
  dialMonitorOnFall: false
});
// Returns: { text: "FALLDOWN,1,0", channel: 'tcp', result }
// Or throws: "Device has no active connection right now — ..."
```

### Command Type Registry

```javascript
const BUILDERS = {
  set_center_number:      ({ phone }) => centerNumberCommand(phone),
  set_sos_number:         ({ slot, phone }) => sosNumberCommand(slot, phone),
  check_status:           () => statusCommand(),
  voice_monitor:          ({ phone }) => voiceMonitorCommand(phone),
  ring_to_find:           () => ringToFindCommand(),
  set_fall_detection:     (params) => fallDetectionCommand(params),
  set_fall_sensitivity:   ({ level }) => fallSensitivityCommand(level),
  set_medication_reminder:(params) => medicationReminderCommand(params),
  set_upload_interval:    ({ seconds }) => uploadIntervalCommand(seconds),
};

const TCP_ONLY_TYPES = new Set([
  'set_fall_detection',
  'set_fall_sensitivity',
  'set_medication_reminder',
  'set_upload_interval',
]);
```

---

## Constraints & Known Issues

### No Offline Buffering
- Commands sent to offline devices fail immediately
- No queue is maintained
- Future work: implement a command queue that retries on reconnection

### No Command State Tracking
- Firestore does not log which commands have been sent
- No way to see "command pending acknowledgement"
- App state is inferred, not verified

### No Real Device Onboarding
- Every new account auto-links to a hardcoded demo IMEI
- Real device linking requires manual Firestore edits
- See CLAUDE.md for details

### SMS Requires SIM Number on File
- If `devices/{imei}.simNumber` is missing, SMS commands fail
- User must configure it in device settings first
- No fallback if SIM number changes without app notification

### Gateway is Local-Only
- Gateway runs on developer's machine or in-office
- Device cannot reach `127.0.0.1` over 4G
- Must be exposed via tunnel (testing) or real hosting (production) before real hardware can connect

See CLAUDE.md for the full list of known gaps.

---

## Testing

### Command Builder Tests

Located in `gateway/test/commands.test.js`:

```bash
npm test -- --grep "command"
```

Tests cover:
- Command format generation
- Parameter validation (slot ranges, time formats, sensitivity levels)
- UTF-16BE hex encoding for medication reminders
- Error cases (invalid inputs)

### Simulator

The simulator can be used to test command delivery via TCP downlink:

```bash
npm run simulate
```

This starts a fake device near Quatre Bornes that connects to the gateway and responds to commands.

### Manual Testing

1. **Set center number (SMS):**
   ```javascript
   await sendDeviceCommand(db, '862754030123456', 'set_center_number', {
     phone: '+23057234567'
   });
   ```

2. **Enable fall detection (TCP):**
   ```javascript
   await sendDeviceCommand(db, '862754030123456', 'set_fall_detection', {
     enabled: true,
     dialMonitorOnFall: false
   });
   ```

3. **Schedule medication reminder (TCP):**
   ```javascript
   await sendDeviceCommand(db, '862754030123456', 'set_medication_reminder', {
     time: '09:30',
     frequency: 2,  // daily
     text: 'Take your meds'
   });
   ```

---

## References

### Vendor Documentation
- **V28C Datasheet:** `docs/reference/V28C-DataSheet.pdf`
- **SMS Commands (V28C):** `docs/reference/Switch-Server-SMS-Commands.pdf`
- **TCP Protocol (V46-V48-V52):** `docs/reference/GPS Tracker Communication Protocol V46-V48-V52 2021-12-20.pdf`
- **Protocol Examples:** `docs/reference/GPS Tracker Communication Example.pdf`

### Guardian Implementation
- **Command Builders:** `gateway/src/commands.js`
- **Command Dispatch:** `gateway/src/downlink.js`
- **SMS Delivery:** `gateway/src/notify.js`
- **Command Tests:** `gateway/test/commands.test.js`

### GitHub Issues
- Voice monitoring privacy: #XX
- Photo capture: #28
- Pill box integration: #29
- Pedometer/step count: #12
- Command state tracking: #XX

---

## Next Steps

1. **Verify unconfirmed commands** against real hardware (FIND, monitor)
2. **Implement echo matching** to confirm device acknowledgement
3. **Add command queuing** for offline devices
4. **Expose gateway publicly** so real devices can connect (testing or production)
5. **Add Firestore schema** for command history (`deviceCommandHistory/{...}`)
