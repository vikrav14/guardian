# Downlink Protocol: Gateway → Device Commands

The downlink protocol defines how the Guardian gateway sends commands to devices over a live TCP session. Commands are text-based, use a strict framing format, and require an active connection—there is no SMS fallback for time-sensitive, session-scoped operations.

## Overview

### Two Dispatch Paths

Commands are routed based on their type:

| Channel | Use Case | Command Examples | Fallback |
|---------|----------|------------------|----------|
| **TCP Downlink** | Real-time, session-only commands | Fall detection, medication reminders, upload interval | None—fails clearly if no connection |
| **SMS** | V28C-documented commands | Center number, SOS slots, status check | Sent to device's SIM card |

The gateway automatically chooses the right path based on the command type:

```javascript
const TCP_ONLY_TYPES = new Set([
  'set_fall_detection',
  'set_fall_sensitivity',
  'set_medication_reminder',
  'set_upload_interval',
]);
```

TCP-only commands fail immediately if the device has no active session, rather than pretending to queue something that cannot be delivered.

---

## TCP Frame Format

All downlink commands use the GT06 protocol's ASCII frame structure:

```
[CS*YYYYYYYYYY*LEN*command,data...]
```

### Components

| Component | Length | Purpose | Example |
|-----------|--------|---------|---------|
| `[` | 1 byte | Frame start delimiter | `[` |
| `CS` | 2 chars | Factory code (ASCII) | `SG` |
| `*` | 1 byte | Separator | `*` |
| `YYYYYYYYYY` | 10 digits | Protocol ID (10-digit device ID) | `9705314117` |
| `*` | 1 byte | Separator | `*` |
| `LEN` | 4 hex digits | Content length (ASCII hex) | `0005` (5 bytes) |
| `*` | 1 byte | Separator | `*` |
| `command,data...` | Variable | Payload (command + optional data) | `CR`, `FALLDOWN,1,1` |
| `]` | 1 byte | Frame end delimiter | `]` |

### Example Frames

#### Continuous Reporting (CR)
```
[SG*9705314117*0002*CR]
        ↑ protocol ID
              ↑ length = 2 (CR is 2 bytes)
                  ↑ payload
```

**Binary representation (hex)**:
```
5b 53 47 2a 39 37 30 35 33 31 34 31 31 37 2a 30 30 30 32 2a 43 52 5d
[ S  G  *  9  7  0  5  3  1  4  1  1  7  *  0  0  0  2  *  C  R  ]
```

#### Fall Detection On
```
[SG*9705314117*000E*FALLDOWN,1,1]
                 ↑ length = 14 (FALLDOWN,1,1)
```

**Binary representation (hex)**:
```
5b 53 47 2a 39 37 30 35 33 31 34 31 31 37 2a 30 30 30 45 2a 46 41 4c 4c 44 4f 57 4e 2c 31 2c 31 5d
[ S  G  *  9  7  0  5  3  1  4  1  1  7  *  0  0  0  E  *  F  A  L  L  D  O  W  N  ,  1  ,  1  ]
```

#### Medication Reminder
```
[SG*9705314117*0063*TAKEPILLS,14:30-1-2,2,006400610069006c0079]
                ↑ length = 99 decimal = 0x63 hex
                  ↑ payload (time, frequency, hex-encoded reminder text)
```

---

## Session Requirement: Live Connection Only

### No Queuing, No SMS Fallback

TCP-only commands **require an active TCP session**. The gateway does not:
- Queue commands for later delivery
- Retry when the device reconnects
- Fall back to SMS

This is a deliberate design choice: these commands are either delivered immediately over the live session, or they fail transparently.

### Why This Matters

1. **Fall detection, medication reminders, and upload interval are not documented in the V28C's SMS command set** — they exist only in the V46-V48-V52 TCP protocol docs.
2. **Real-time configuration** — These settings affect device behavior right now (e.g., fall sensitivity must take effect before the next fall detection cycle).
3. **State drift prevention** — Queuing creates a false sense of delivery and makes debugging harder.

### Connection State

The gateway tracks active sessions in `src/sessions.js`:

```javascript
function findSocketsForDevice(imeiOrProtocolId) {
  // Returns array of { socket, session } for all active TCP sessions
  // matching this device or protocol ID.
}
```

Before sending a TCP command, the gateway looks up active sessions. If none exist:

```javascript
const result = sendDownlinkCommand(imei, 'FALLDOWN,1,1');
if (!result.ok) {
  throw new Error(
    'Device has no active connection right now — ' +
    'set_fall_detection requires a live session (no SMS fallback exists for this command)'
  );
}
```

---

## Echo Verification Mechanism

### How Device Acknowledgment Works

When a device receives a downlink command, it **echoes the command back** to the gateway in the same frame format. The gateway does not send a separate ACK; instead:

1. **Gateway sends command**: `[SG*9705314117*0002*CR]`
2. **Device receives, processes, and echoes**: `[3G*9705314117*0002*CR]` (echoed back on its uplink session)
3. **Gateway receives echo**: Sees the command in the `SERVER_ONLY_COMMANDS` set and drops it silently

### Server-Only Commands

Commands that can only originate from the server are listed in `SERVER_ONLY_COMMANDS`:

```javascript
const SERVER_ONLY_COMMANDS = new Set([
  'CR', 'UPLOAD', 'CALL', 'MONITOR', 'SOS1', 'SOS2', 'SOS3',
  'FALLDOWN', 'LSSET', 'TAKEPILLS',
  // ... and many others
]);
```

When an echo arrives, the gateway recognizes it as a server-only command and logs it as an event:

```javascript
} else if (SERVER_ONLY_COMMANDS.has(command)) {
  // Device echoed back a command we sent it.
  // Drop it silently to prevent loops.
  events.push({ type: 'command_echo', ...eventMeta, command });
}
```

### What This Verification Proves

The echo tells you:
- ✓ The device received the frame
- ✓ The device parsed it correctly
- ✓ The device is currently awake and processing

**What it does NOT tell you:**
- ✗ Whether the device will execute the command
- ✗ Whether the command succeeded (e.g., fall detection is actually armed)
- ✗ Whether the device will stay connected long enough to apply it

### No Command Result Confirmation

Guardian currently does not track **whether a device applied the setting**. For example:

- Send: `FALLDOWN,1,1` (enable fall detection)
- Receive echo: `[3G*9705314117*0008*FALLDOWN,1,1]` ✓ Received
- But: Is fall detection *actually* armed on the device? Unknown.

This is documented in the [Firestore schema](../05-data/SCHEMA.md) as a known gap: "Request cache — Some settings (fall detection, location interval) are cached in Firestore but cannot be read back from the device."

---

## Timeout Handling

### Command Delivery Timeout

When `sendDownlinkCommand()` is called:

```javascript
const result = sendDownlinkCommand(imei, 'FALLDOWN,1,1');
// Returns immediately: { ok: true/false, ... }
```

The function writes to the socket and returns immediately. There is **no timeout; no retry; no wait for echo**.

```javascript
for (const { socket } of matches) {
  socket.write(frame);  // Fire and forget
}
```

### What Happens If Device Disconnects?

If the device's TCP session ends after the command is sent but before it's processed:

1. The socket write succeeds (data is buffered in the OS)
2. The session ends
3. The device may or may not have read the data

The gateway has no way to know. No retry is triggered.

### Echo Loss Scenario

If a device processes the command but its uplink echo is dropped (e.g., lossy cellular):

1. Device receives and executes the command ✓
2. Device sends echo but packet is lost ✗
3. Gateway never sees the echo, but the setting is already applied

This is acceptable because the echo is verification for the operator, not a strict requirement. The device's state is already changed.

### Recommended Operator Behavior

For time-sensitive commands (fall detection, medication reminders):

1. Check device status first: is it online (checked in within 5 minutes)?
2. Send the command
3. Watch for the echo in the gateway logs
4. If no echo after 30 seconds, assume the device went offline during transmission

No in-app confirmation is currently provided to end users.

---

## Command Building: Implementation

### Frame Construction

The `buildAckFrame()` function constructs a downlink frame:

```javascript
function buildAckFrame(imei, command) {
  // imei = protocol ID (10 digits), e.g. '9705314117'
  // command = payload, e.g. 'FALLDOWN,1,1'
  
  const content = command;
  const lenHex = content.length.toString(16).toUpperCase().padStart(4, '0');
  const ack = `[SG*${imei}*${lenHex}*${content}]`;
  return Buffer.from(ack, 'ascii');
}
```

Example:
```javascript
buildAckFrame('9705314117', 'FALLDOWN,1,1')
// Produces: [SG*9705314117*000E*FALLDOWN,1,1]
//           ↑ factory  ↑ ID    ↑ len=14     ↑ payload
```

### Command Dispatch

The `sendDownlinkCommand()` function finds active sessions and writes to all of them:

```javascript
function sendDownlinkCommand(imeiOrProtocolId, command) {
  const matches = findSocketsForDevice(imeiOrProtocolId);
  if (matches.length === 0) {
    return { ok: false, error: 'no_active_session', imeiOrProtocolId, command };
  }

  const protocolId = matches[0].session.protocolId || ...;
  const frame = buildAckFrame(protocolId, command);

  for (const { socket } of matches) {
    socket.write(frame);  // Write to each active connection
  }

  return { ok: true, imeiOrProtocolId, protocolId, command, sessions: matches.length };
}
```

### Command Builders (src/commands.js)

Each command type has a builder function that constructs the payload string:

```javascript
function fallDetectionCommand({ enabled, dialMonitorOnFall = false }) {
  return `FALLDOWN,${enabled ? 1 : 0},${dialMonitorOnFall ? 1 : 0}`;
}
// → 'FALLDOWN,1,1'

function fallSensitivityCommand(level) {
  return `LSSET,${Number(level)}+6`;
}
// → 'LSSET,5+6' (level 5, constant 6)

function medicationReminderCommand({ time, frequency, week, text, enabled = true }) {
  const timeSegment = `${time}-${enabled ? 1 : 0}-${frequency}`;
  // ... frequency-specific validation ...
  const hexText = textToHexUtf16(text);
  return `TAKEPILLS,${timeSegment},${frequency},${hexText}`;
}
// → 'TAKEPILLS,14:30-1-2,2,006400610069006c0079'
```

---

## Error Scenarios

### Scenario 1: Device Offline

**Action**: Send fall detection command
```javascript
const result = sendDownlinkCommand(imei, 'FALLDOWN,1,1');
```

**Result**:
```javascript
{
  ok: false,
  error: 'no_active_session',
  imeiOrProtocolId: '353612150100125',
  command: 'FALLDOWN,1,1'
}
```

**API Response** (e.g., in a REST endpoint):
```json
{
  "success": false,
  "error": "Device has no active connection right now — set_fall_detection requires a live session (no SMS fallback exists for this command)"
}
```

**Operator Action**: Wait for device to come back online, then retry. No retry is queued.

---

### Scenario 2: Multiple Active Sessions (Duplicate Connections)

**Situation**: A device connects twice (e.g., via two different cellular data sessions or WiFi + LTE).

**Action**: Send command
```javascript
const matches = findSocketsForDevice(imei);
// matches.length = 2 (two active sockets)
```

**Behavior**:
```javascript
for (const { socket } of matches) {
  socket.write(frame);  // Sends to BOTH sockets
}

return { ok: true, sessions: 2 };
```

**Result**: The device receives the command twice. Both echoes arrive.

**Is this a problem?** No — the device is idempotent. Setting fall detection to ON twice has the same effect as setting it once. But the gateway logs show duplicate echoes.

---

### Scenario 3: Echo Arrives, But Device Didn't Actually Apply Setting

**Situation**:
1. Send: `FALLDOWN,1,1`
2. Device echoes it back ✓
3. But due to a device firmware bug, fall detection doesn't actually turn on

**How you'll know**: The echo arrives (confirming receipt), but when you later query the device's configuration via another method (e.g., via a dedicated status command or firmware version check), it shows fall detection is still OFF.

**Mitigation**: No automatic detection. This is why the documentation recommends manual verification on critical settings.

---

### Scenario 4: Partial Frame Write (TCP Buffering)

**Situation**: The gateway calls `socket.write(frame)` but the frame is larger than the TCP send buffer.

**What happens**:
```javascript
socket.write(frame);  // Returns boolean: true if all data was written
```

If the frame size exceeds available buffer:
- `write()` returns `false`
- Data is buffered in Node.js
- A `drain` event fires when buffer space opens up
- The write completes automatically

The gateway does not check the return value or listen for `drain`.

**Impact**: Extremely unlikely in practice (frames are ~40-100 bytes; typical TCP buffers are megabytes). If it does happen, Node.js will queue the data and send it when possible.

---

### Scenario 5: Malformed Command Builder Output

**Situation**: A command builder produces invalid syntax.

Example:
```javascript
medicationReminderCommand({ time: '25:00', frequency: 2, text: 'test' });
// Builder catches this: "Medication reminder time must be HH:MM (24-hour)"
// Throws Error before reaching frame construction
```

**Result**: The error is caught by the caller:

```javascript
async function sendDeviceCommand(db, imei, type, params) {
  const builder = BUILDERS[type];
  try {
    const text = builder(params || {});  // Throws if validation fails
    // ...
  } catch (error) {
    // Propagate to API caller
    throw new Error(`Invalid command: ${error.message}`);
  }
}
```

**Operator sees**: Clear error message before any frame is sent.

---

### Scenario 6: Device Echo Doesn't Match Original Command

**Situation**: Device receives `[SG*9705314117*000E*FALLDOWN,1,1]` but echoes back `[3G*9705314117*0008*FALLDOWN,1]` (truncated).

**What happens**:
1. The partial echo `FALLDOWN,1` is not in `SERVER_ONLY_COMMANDS` exactly (case matters, and the second 1 is missing)
2. The gateway treats it as a valid command from the device (not a recognized server echo)
3. It gets logged as `type: 'unknown_command'` and an ACK is sent back

**Impact**: False unknown_command log entry. The original command may or may not have been applied (you can't tell from the malformed echo).

**This shouldn't happen**: The device firmware is expected to echo exactly what it receives. If it doesn't, it's a device firmware bug, not a protocol issue.

---

## TCP-Only Commands Reference

These commands require a live session and have no SMS fallback:

| Command | Type | Purpose | Payload Example |
|---------|------|---------|-----------------|
| `UPLOAD` | Interval | Set location reporting interval (seconds) | `UPLOAD,30` |
| `FALLDOWN` | Health | Enable/disable fall detection | `FALLDOWN,1,1` |
| `LSSET` | Health | Set fall sensitivity (0-6) | `LSSET,5+6` |
| `TAKEPILLS` | Health | Medication reminder (time, frequency, days, text) | `TAKEPILLS,14:30-1-2,2,0074006500730074` |
| `CR` | Status | Continuous reporting mode (streams location) | `CR` |

### v46-V48-V52 Health Commands (Advanced)

These are documented in the vendor's V46-V48-V52 protocol doc and confirmed in example captures:

- `UPLOAD` — Location upload interval in seconds (10-3600)
- `FALLDOWN` — Fall detection on/off, with optional auto-dial
- `LSSET` — Fall sensitivity 0-6 (vendor constant)
- `TAKEPILLS` — Medication reminder with UTF-16BE hex-encoded text

---

## SMS Fallback Commands Reference

These commands are documented in the V28C vendor manual and fall back to SMS:

| Command | Type | Purpose | SMS Payload |
|---------|------|---------|-------------|
| `set_center_number` | Config | Set center (gateway) number | `pw,123456,center,+23012345678#` |
| `set_sos_number` | SOS | Set SOS button slot (1-3) | `sos1,+23098765432#` |
| `check_status` | Status | Request device status | `ts#` |
| `voice_monitor` | Audio | Enable voice monitoring | `monitor,+23012345678#` |
| `ring_to_find` | Finding | Ring pendant to locate | `find#` |

**Note**: `voice_monitor` and `ring_to_find` are documented for the RF-V28 by a third-party source (github.com/matthiasmo/RF-V28), not the V28C's own manual. Treat them as higher-confidence-but-unverified.

---

## Logging and Observability

### Gateway Downlink Logs

When a command is sent:

```
[downlink] sent CR to 9705314117 (1 session(s)): [SG*9705314117*0002*CR]
```

Shows:
- Command sent
- Protocol ID
- Number of active sessions
- ASCII frame representation

### Command Echo Logs

When an echo arrives:

```javascript
events.push({ type: 'command_echo', imei, protocolId, command: 'CR' });
```

This is logged as an `events` table entry (Firestore or log aggregator, depending on configuration).

### No Active Session Logs

When a TCP-only command fails:

```json
{
  "ok": false,
  "error": "no_active_session",
  "imeiOrProtocolId": "353612150100125",
  "command": "FALLDOWN,1,1"
}
```

This is typically caught and re-thrown as a user-facing error:

```
Device has no active connection right now — set_fall_detection requires a live session
```

---

## Security Considerations

### Command Injection

Commands are built by type-specific builders that validate their inputs:

```javascript
function medicationReminderCommand({ time, frequency, week, text, ... }) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time || '')) {
    throw new Error('Medication reminder time must be HH:MM (24-hour)');
  }
  if (![1, 2, 3].includes(Number(frequency))) {
    throw new Error('Medication reminder frequency must be 1, 2, or 3');
  }
  // ... more validation ...
}
```

Callers cannot inject arbitrary payloads. Each command has a fixed format.

### Frame Encoding

Frames are always ASCII-encoded. UTF-16BE hex encoding (used for medication reminder text) is sanitized:

```javascript
function textToHexUtf16(text) {
  let hex = '';
  for (const ch of String(text)) {
    hex += ch.codePointAt(0).toString(16).padStart(4, '0');
  }
  return hex;
}
```

This converts the input text to hex, which is safe to embed in ASCII frames.

### Device Authentication

The gateway does not authenticate commands at the frame level. Authentication happens at the **session level**:

1. Device connects to gateway
2. Gateway validates device IMEI and stores it in the session
3. Only commands sent to *that specific session* reach *that device*

Cross-device command injection is not possible: you cannot send a command intended for device A to device B.

---

## Related Documentation

- **[UPLINK_PROTOCOL.md](./UPLINK_PROTOCOL.md)** — How devices send data to the gateway
- **[GATEWAY_ARCHITECTURE.md](./GATEWAY_ARCHITECTURE.md)** — Overall gateway design
- **[Firestore Schema](../05-data/SCHEMA.md)** — Data model and request cache
- **[Vendor Protocol Docs](../reference/)** — V28C and V46-V48-V52 protocol specifications

---

## Changelog

| Date | Change |
|------|--------|
| 2026-07-29 | Initial documentation; covers TCP frame format, session requirements, echo verification, timeout handling, command building, error scenarios, and security |
