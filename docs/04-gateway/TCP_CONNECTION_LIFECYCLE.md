# TCP Connection Lifecycle

From **device perspective**: how a ReachFar pendant (V28C, V46, V48, V52) connects to the Guardian gateway, sends heartbeats, receives commands, and goes offline. This document covers packet flow, timings, error handling, and the state machine that keeps the mobile app in sync with real device status.

---

## Overview: Connection States

The device-gateway relationship has three states tracked in Firestore:

| State | Meaning | Firestore.connectionState | TCP | Heartbeat |
|-------|---------|---------------------------|-----|-----------|
| **Offline** | No active TCP and last heartbeat is stale (>10 min) | `offline` | ❌ closed | >10 min old |
| **Connecting** | TCP open, first 1–2 packets on this session not yet persistent | `connecting` | ✅ open | fresh |
| **Live** | TCP open and ≥2 packets persisted on this session | `live` | ✅ open | fresh |

The transition from **Offline** → **Connecting** → **Live** is **one-way per session**. A new TCP connection resets the counter.

---

## Phase 1: Device Initiates Connection

### Trigger
- Device powers on or regains cellular coverage
- Device initiates an outbound TCP connection to the gateway (server IP + port 9000)
  - V28C can be provisioned with a server IP via SMS command
  - Connection is raw TCP, no TLS/encryption at the protocol level

### Gateway: Accept Connection
```javascript
// server.js
const server = net.createServer((socket) => {
  const remote = `${socket.remoteAddress}:${socket.remotePort}`;
  console.log(`[tcp] connected ${remote}`);
  registerSession(socket);
  socket.on('data', (chunk) => { /* ... */ });
  socket.on('close', () => { /* ... */ });
});
```

**What happens:**
1. TCP socket is created and tracked in `sessions.js`
2. Session buffer initialized: `{ imei: null, protocolId: null, buffer: Buffer.alloc(0), lastPacketAt: Date.now() }`
3. An idle timeout is set: devices must send a packet within `tcpIdleMinutes` (default 12 min) or the socket is destroyed
4. No Firestore update yet—just TCP-layer state

### Key Timing
- **TCP idle timeout**: 12 minutes (configurable via `TCP_IDLE_MINUTES`)
  - If no packet arrives within this window, `socket.destroy()` is called
  - Protects against zombie sockets that carrier/ngrok may keep alive after device power-off

---

## Phase 2: First Packet & Handshake

### Device Sends First Packet

The device's very first packet is typically a **heartbeat (LK packet)** or a **location upload (UD)**. Both contain the 10-digit protocol ID.

#### Packet Format (ASCII)
```
[CS*YYYYYYYYYY*LEN*command,args...]
```
- `CS` = factory code (e.g., "SG", "3G")
- `YYYYYYYYYY` = 10-digit protocol ID (e.g., "9705314117")
- `LEN` = 4-char hex ASCII length of payload
- `command,args` = e.g., `LK,0,0,85` (heartbeat with 85% battery)

**Example heartbeat (LK)**
```
[SG*9705314117*0008*LK,0,0,85]
```
- Payload length: 8 bytes (`LK,0,0,85`)
- LEN = `0008` in hex

#### Gateway: Handshake Announcement

As soon as the gateway's frame parser decodes the first packet with an IMEI:

```javascript
// connection-handshake.js
async function maybeAnnounceConnecting(session, imei, devicePatch, ...) {
  if (session.handshakeAnnounced) return false;
  session.handshakeAnnounced = true;
  
  await upsertDevice(imei, {
    online: false,                    // ← Still offline from app perspective
    connectionState: 'connecting',    // ← New state announced
    connectingAt: new Date(),
  });
  onDeviceConnect(imei);              // ← Triggers device-presence monitor
}
```

**Firestore now shows:**
- `connectionState: "connecting"`
- `online: false` (app shows "Linking up" + satellite UI)
- `connectingAt: <timestamp>`

**Mobile app behavior:**
- Shows satellite icon (not a real location yet, but device is reachable)
- Does NOT update location pin until `connectionState` becomes `"live"`

### Gateway Sends Acknowledgment

For each incoming packet, the gateway immediately sends a frame-level ack (not TCP-level, but protocol-level):

```javascript
// protocol/gt06.js
function buildAckFrame(imei, command) {
  // [SG*IMEI*LEN*command]
  const content = command;
  const lenHex = content.length.toString(16).toUpperCase().padStart(4, '0');
  const ack = `[SG*${imei}*${lenHex}*${content}]`;
  return Buffer.from(ack, 'ascii');
}

// For LK heartbeat:
acks.push(buildAckFrame(protocolId, 'LK'));  // → [SG*9705314117*0002*LK]
```

The device **does not wait** for this ack before sending the next packet (acks are best-effort).

### Key Timing
- **Handshake debounce**: none
  - Announcement to Firestore is immediate and definitive per session
  - If TCP drops and reconnects, a new handshake is announced

---

## Phase 3: Persistent Session (Connecting → Live)

### The "Live Packets" Threshold

A session is promoted from `connecting` → `live` once **two packets** have been persisted to Firestore:

```javascript
// connection-live.js
const SESSION_LIVE_PACKETS = 2;

function buildSessionPersistPatch(session, patch) {
  session.persistCount = (session.persistCount || 0) + 1;
  if (session.persistCount < SESSION_LIVE_PACKETS) {
    return {
      ...patch,
      online: false,
      connectionState: 'connecting',  // ← Still not live
    };
  }
  return {
    ...patch,
    online: true,
    connectionState: 'live',          // ← Promoted!
  };
}
```

**Why two packets?**
- Absorbs single-packet network glitches during carrier handoff
- Ensures device is truly stable before the app moves the location pin and sounds alarms

**What counts as a packet?**
1. **Heartbeat (LK)**: battery + steps + rolls data
2. **Location (UD)**: full location with GPS/WiFi/LBS coordinates
3. **Alarm (AL)**: SOS button press or fall detection

After packet 2 persists:
- `connectionState: "live"` is written to Firestore
- `online: true`
- Mobile app updates location, shows live status, enables commands

### Example Timeline
```
T=0s    Device TCP connects, sends LK,0,0,85
        → Gateway announces connecting
        → Firestore: connectionState=connecting, online=false

T+1s    Device sends UD with GPS fix
        → persistCount = 1 (still connecting)
        → Firestore: online=false, connectionState=connecting

T+5s    Device sends LK heartbeat
        → persistCount = 2 (hit threshold!)
        → Firestore: online=true, connectionState=live
        → Mobile app shows live status + location pin
```

---

## Phase 4: Steady State (Live Session)

### Heartbeat Cycle

Once live, the device sends heartbeats (LK packets) approximately **every 5 minutes** (device firmware default). The gateway processes each one:

```javascript
// server.js - heartbeat event
if (event.type === 'heartbeat') {
  const gate = shouldPersist(event.imei, {
    eventType: 'heartbeat',
    batteryPercent: event.batteryPercent,
  });
  
  if (gate.persist || shouldForceSessionPersist(session)) {
    await persistDeviceState(event.imei, {
      online: true,
      lastHeartbeatAt: new Date(),
      batteryPercent: event.batteryPercent,
    }, gate.persist ? gate.reason : 'session_live', session);
  } else {
    recordSkip();
    await touchPresenceIfNeeded(event.imei, session);  // Refresh timestamp only
  }
}
```

#### Write-Gate: Don't Persist Every Heartbeat

By default, heartbeats are **write-gated** to Firestore no more than **every 5 minutes**:

```javascript
// config.js
writeGateHeartbeatMinutes: Number(process.env.WRITE_GATE_HEARTBEAT_MINUTES || 5),
```

**Why?**
- Devices send LK every ~5 min, but more often during movement
- Firestore billing is per write; persisting every packet is expensive
- Battery level changes slowly; once per 5 min is sufficient

**Example:**
```
T=0s    LK,0,0,95    → persist (first heartbeat)
T+1m    LK,0,0,94    → skip (write-gate active)
T+2m    LK,0,0,94    → skip
T+5m    LK,0,0,93    → persist (write-gate elapsed)
T+6m    LK,0,0,92    → skip
```

#### Presence Touch (When Write-Gate Skips)

If a heartbeat is write-gated (skipped), the gateway still refreshes `lastHeartbeatAt` in Firestore to keep the device marked as online:

```javascript
// server.js
async function touchPresenceIfNeeded(imei, session) {
  const patch = buildPresenceTouchPatch(session);
  if (!patch) return false;
  await upsertDevice(imei, patch);  // online: true, connectionState: live, lastHeartbeatAt: new Date()
  console.log(`[presence] touch ${imei}`);
  return true;
}

// connection-live.js
const PRESENCE_TOUCH_MS = 60_000;  // refresh every 1 min even if write-gate skips

function buildPresenceTouchPatch(session, now = Date.now()) {
  if (!sessionIsLive(session)) return null;
  const last = session.lastPresenceAt || 0;
  if (now - last < PRESENCE_TOUCH_MS) return null;
  session.lastPresenceAt = now;
  return {
    online: true,
    connectionState: 'live',
    lastHeartbeatAt: new Date(now),
  };
}
```

**Result:**
- App sees `lastHeartbeatAt` is fresh even if battery level didn't change
- Device stays marked "Online" in app
- Mobile user doesn't see false "Offline" flickers between write-gated packets

### Packet Ack Flow (Steady State)

```
Device                          Gateway
  |------ LK,0,0,85 ----→       [extract frame]
  |                              [decode IMEI + battery]
  |                              [send ack]
  |←----- [SG*IMEI*LEN*LK] -----  [persist to Firestore if gate permits]
  |
  | (wait 5 min)
  |
  |------ UD,ddmmyy,hhmmss,-20.0,S,57.5,E,15,120 ----→
  |←----- [SG*IMEI*LEN*UD] -----
```

---

## Phase 5: Commands & Downlink

### Command Queueing (Current: Synchronous Delivery)

Commands are **not queued**—they are sent immediately when the device has an active TCP session. If the device is offline, commands fail with a clear error:

```javascript
// commands.js
async function sendDeviceCommand(db, imei, type, params) {
  const builder = BUILDERS[type];
  const text = builder(params || {});
  
  if (TCP_ONLY_TYPES.has(type)) {
    const result = sendDownlinkCommand(imei, text);  // ← Immediate, no queue
    if (!result.ok) {
      throw new Error(
        `Device has no active connection right now — ${type} requires a live session`
      );
    }
    return { text, channel: 'tcp', result };
  }
  // SMS fallback for V28C commands
  const result = await sendSms(simNumber, text);
  return { text, channel: 'sms', simNumber, result };
}
```

### TCP-Only vs. SMS Commands

| Type | V28C Support | Channel | If Offline |
|------|--------------|---------|-----------|
| set_center_number | ✅ Vendor doc | SMS | Queued (device will get SMS) |
| set_sos_number | ✅ Vendor doc | SMS | Queued |
| set_fall_detection | ❌ V28C only | TCP | **Fails**: "no active session" |
| set_medication_reminder | ❌ V28C only | TCP | **Fails**: "no active session" |
| voice_monitor | ⚠️ Unverified (RF-V28) | SMS | Queued |
| ring_to_find | ⚠️ Unverified (RF-V28) | SMS | Queued |

### Downlink Packet Structure

```javascript
// downlink.js
function sendDownlinkCommand(imeiOrProtocolId, command) {
  const matches = findSocketsForDevice(imeiOrProtocolId);  // ← Find active TCP socket(s)
  if (matches.length === 0) {
    return { ok: false, error: 'no_active_session' };
  }
  
  const frame = buildAckFrame(protocolId, command);  // [SG*IMEI*LEN*command]
  
  for (const { socket } of matches) {
    socket.write(frame);  // ← Write directly to TCP
  }
  
  return { ok: true, sessions: matches.length };
}
```

**Example: Set center number**
```
Gateway → Device: [SG*9705314117*0013*pw,123456,center,+230123456#]
Device → Gateway: [SG*9705314117*0013*pw,123456,center,+230123456#]  (echo ack)
```

The device echoes the command back as confirmation. The gateway logs this but does not re-ack:

```javascript
// protocol/gt06.js
else if (event.type === 'command_echo') {
  console.log(
    `[gateway] ${event.protocolId || event.imei} echoed back ${event.command} (dropped, not re-acking)`
  );
}
```

---

## Phase 6: Device Goes Offline

### Trigger: TCP Close

When the device loses cellular coverage or powers off, the TCP connection closes:

```javascript
// server.js
socket.on('close', () => {
  const session = getSession(socket);
  console.log(`[tcp] disconnected ${remote} imei=${session?.imei}`);
  
  if (session?.imei) {
    maybeFlushDwell(session.imei, true);      // ← Flush dwell area if needed
    const journey = flushJourneyIfNeeded(...); // ← Flush current journey
    
    const reachedLive = (session.persistCount || 0) >= SESSION_LIVE_PACKETS;
    if (reachedLive) {
      scheduleDeviceOffline(session.imei, ..., config.offlineDebounceMs);
      // ↑ Schedule offline update (debounced)
    }
  }
  
  unregisterSession(socket);  // ← Remove from sessions map
});
```

### Offline Debounce: Grace Period

Instead of marking offline immediately, the gateway **waits** before writing `offline` to Firestore. This absorbs brief carrier handoff blips:

```javascript
// device-offline.js
const CONNECTING_GRACE_MS = 3 * 60 * 1000;  // 3 min

function scheduleDeviceOffline(imei, upsertDevice, debounceMs = 15_000, getDevice = null) {
  cancelPendingOffline(imei);  // ← Cancel any existing timer
  
  const timer = setTimeout(async () => {
    try {
      const device = await getDevice(imei);
      if (shouldSkipOfflineWrite(device)) return;  // ← Still connecting? Skip.
      
      await upsertDevice(imei, { online: false, connectionState: 'offline' });
    } catch (err) {
      console.error('[gateway] debounced offline update failed', err.message);
    }
  }, debounceMs);  // ← Default 15 seconds
  
  pendingOfflineTimers.set(imei, timer);
}

function shouldSkipOfflineWrite(device) {
  if (device.connectionState === 'connecting') return true;
  const connectingAt = asDate(device.connectingAt);
  if (connectingAt && Date.now() - connectingAt.getTime() < CONNECTING_GRACE_MS) {
    return true;  // ← Still within 3 min of handshake, don't mark offline yet
  }
  return false;
}
```

**Timeline:**
```
T=0s    TCP closes (no heartbeat for 10 min, or device powered off)
        → scheduleDeviceOffline scheduled for T+15s

T+3s    Device reconnects (brief carrier blip)
        → New TCP connection, new handshake
        → cancelPendingOffline called
        → Timer cleared, no offline write

T+10s   Still connected
        → Device is live again

---OR---

T=0s    TCP closes
        → scheduleDeviceOffline scheduled for T+15s

T+15s   Timer fires
        → Check if device still in "connecting" state
        → If yes, skip offline write (3 min grace)
        → If no, write offline to Firestore

T+20s   Mobile app sees online: false, last heartbeat is 20s old
        → Shows "Offline" UI
```

### Re-Connection Cancels Pending Offline

If the device reconnects **before** the debounce timer fires:

```javascript
// connection-handshake.js
async function maybeAnnounceConnecting(...) {
  if (cancelPendingOffline) cancelPendingOffline(imei);  // ← Kill the timer!
  // ...
}
```

The pending offline write is **cancelled**, and a new handshake is announced instead.

---

## Phase 7: Heartbeat Stale Detection

### Mobile App's Offline Detection

The mobile app has its own offline logic (independent of the gateway's Firestore writes):

```dart
// Flutter app logic
bool isOffline(device) {
  const STALE_MINUTES = 10;
  final lastHeartbeat = device.lastHeartbeatAt;
  if (lastHeartbeat == null) return true;
  
  return DateTime.now().difference(lastHeartbeat).inMinutes > STALE_MINUTES;
}
```

### Gateway's Presence Reconciliation

The gateway's intelligence monitor periodically reconciles stale heartbeats:

```javascript
// device-presence.js
function shouldMarkDeviceOffline(device, { tcpConnected, staleMinutes, now = new Date() }) {
  if (!tcpConnected) return true;  // ← TCP is closed → offline
  return isHeartbeatStale(device, staleMinutes, now);  // ← Heartbeat >10 min old → offline
}

function isHeartbeatStale(device, staleMinutes, now = new Date()) {
  const minutes = minutesSinceHeartbeat(device, now);
  if (minutes == null) return true;
  return minutes >= staleMinutes;
}
```

**Config:**
```javascript
// config.js
connectionStaleMinutes: Math.max(
  Number(process.env.CONNECTION_STALE_MINUTES || 10),
  Number(process.env.WRITE_GATE_HEARTBEAT_MINUTES || 5) + 2
),
// ↑ Ensures stale timeout > write-gate window
//   (default: 10 min, minimum 7 min if write-gate is 5 min)
```

**Why is stale timeout > write-gate window?**
- If write-gate skips for up to 5 min, heartbeat timestamp is old but device is still online
- Stale threshold must be high enough to not false-positive

---

## Full Timeline Example

```
Device                          Gateway                         Firestore
═══════════════════════════════════════════════════════════════════════════════════

T=0s    Power on
        TCP connect ──────────→  [tcp] connected <IP>:<port>
                                 registerSession
                                
        Send LK,0,0,95 ────────→ [extract LK frame]
                                 [decode 10-digit ID]
        ←────── [SG*ID*LEN*LK] ──← [send protocol ack]
                                 [handshake announcement]
                                 persistCount: 0
                                 ───────────────────→ connectionState: connecting
                                                        online: false
                                                        
        (wait 1s)
        
        Send UD,180726,120530,
        -20.12,S,57.45,E,15,120 ──→ [extract UD frame]
        ←────── [SG*ID*LEN*UD] ──← [location event]
                                 persistCount: 1
                                 (still connecting)
        
        (wait 5m)
        
        Send LK,100,0,94 ──────→  [LK heartbeat]
                                 persistCount: 2
                                 (hit SESSION_LIVE_PACKETS)
                                 ───────────────────→ connectionState: live
        ←────── [SG*ID*LEN*LK] ──←                    online: true
                                                        location: updated
                                                        lastHeartbeatAt: new
                                                        
        (wait 5m)
        
        Send LK,101,0,93 ──────→  [LK heartbeat]
                                 write-gate check
                                 (only 1 min since last
                                  persistent LK)
                                 → skip persist
                                 → touchPresenceIfNeeded
                                 ───────────────────→ lastHeartbeatAt: touched
        ←────── [SG*ID*LEN*LK] ──←
        
        (wait 5m)
        
        Send LK,102,0,92 ──────→  [LK heartbeat]
                                 write-gate: 5 min elapsed
                                 → persist
                                 ───────────────────→ batteryPercent: 92
                                                        lastHeartbeatAt: new
                                
        (device loses signal or powered off)
        TCP close ──────────────→ [tcp] disconnected
                                 reachedLive: true
                                 scheduleDeviceOffline
                                   (debounce 15s)
                                 unregisterSession
                                 
        (wait 15s)
        
                                 [debounce timer fires]
                                 shouldSkipOfflineWrite: false
                                 ───────────────────→ online: false
                                                        connectionState: offline
                                                        
        (wait 10m)
        
        Mobile app checks:
        lastHeartbeatAt is >10 min old
        → Shows "Offline" UI
        
═══════════════════════════════════════════════════════════════════════════════════
```

---

## Error Handling

### CRC Errors
Frames with invalid CRC are silently dropped:
```
[gateway] CRC mismatch — frame dropped
```
No ack is sent; device will retry.

### Parse Errors
Malformed frames trigger warnings but don't crash the session:
```
[gateway] parse error: <error_message>
[gateway] location parse failed (UD): GPS not fixed
```

### Idle Timeout
If a device has an open TCP but sends no packet within `tcpIdleMinutes` (default 12 min):
```javascript
session.idleTimer = setTimeout(() => {
  console.log(`[tcp] idle timeout imei=${session.imei}`);
  socket.destroy();
}, idleMs);
```
The socket is forcibly closed. On reconnect, a new session is created.

**Why 12 minutes?**
- Stationary devices (at home, at work) can go 5–10 min between heartbeats
- 12 min gives a 2 min safety margin before claiming "zombie"

### No Active Session for TCP-Only Commands
Commands that require a live TCP connection fail immediately if the device is offline:

```javascript
const result = sendDownlinkCommand(imei, text);
if (!result.ok) {
  throw new Error(
    `Device has no active connection right now — ${type} requires a live session (no SMS fallback exists for this command)`
  );
}
```

Examples: `set_fall_detection`, `set_medication_reminder` (V46/V48/V52 only).

---

## Protocol Details

### ReachFar GT06 Frame Format
```
[CS*YYYYYYYYYY*LEN*payload]

CS        = 2-char factory code (SG, 3G, etc.)
YYYYYYYYYY = 10-digit protocol ID (not full IMEI)
LEN       = 4-char uppercase hex, length of payload in bytes
payload   = command,arg1,arg2,...
```

### Common Commands
| Command | Source | Direction | Example |
|---------|--------|-----------|---------|
| **LK** | Device | Heartbeat | `LK,steps,rolls,battery` |
| **UD** | Device | Location | `UD,ddmmyy,hhmmss,lat,N/S,lng,E/W,speed,course` |
| **AL** | Device | Alarm | `AL,alarm_code` |
| **UD2** | Device | Blind-spot re-upload (after offline) | Same as UD, no ack |
| **pw** | Gateway | Set center number | `pw,123456,center,+230123456#` |
| **sos1/2/3** | Gateway | Set SOS number | `sos1,+230123456#` |
| **FALLDOWN** | Gateway | Enable/disable fall detection (V46+) | `FALLDOWN,1,0` |
| **TAKEPILLS** | Gateway | Medication reminder (V46+) | `TAKEPILLS,HH:MM-1-freq,...` |

---

## Configuration Reference

| Env Var | Default | Meaning |
|---------|---------|---------|
| `TCP_IDLE_MINUTES` | 12 | Close socket if no packet for this duration |
| `CONNECTION_STALE_MINUTES` | 10 (min 7) | Heartbeat older than this = offline |
| `WRITE_GATE_HEARTBEAT_MINUTES` | 5 | Persist heartbeats no more often than this |
| `PRESENCE_TOUCH_MS` | 60,000 (1 min) | Refresh `lastHeartbeatAt` even if write-gate skips |
| `OFFLINE_DEBOUNCE_MS` | 15,000 | Wait before writing `offline` to Firestore |
| `CONNECTING_GRACE_MS` | 180,000 (3 min) | Don't mark offline if still in "connecting" state |

---

## Key Invariants

1. **Handshake per session:** Each new TCP connection triggers `maybeAnnounceConnecting`, announcing "connecting" to Firestore immediately.

2. **Live after 2 packets:** A session is live (app can see location, send commands) only after ≥2 packets have been persisted.

3. **Write-gate protects Firestore:** Heartbeats are not persisted more often than every 5 minutes. Presence touches keep the device marked online in between.

4. **Offline debounce prevents flicker:** TCP close doesn't immediately mark offline; a 15-second window allows carrier handoff reconnects.

5. **Stale timeout > write-gate:** Heartbeat staleness is checked at ≥10 minutes to ensure write-gated packets don't trigger false offline.

6. **No command queue:** TCP-only commands fail immediately if the device has no active session. SMS commands are queued by Twilio.

7. **Acks are best-effort:** Protocol acks are sent but not guaranteed to reach the device. No retry loop.

---

## Troubleshooting

### "Linking up" UI Stuck
- Device sent a packet but hasn't sent a second one
- Check device logs: is LK/UD being sent every 5 min?
- Check gateway logs for write-gate or parse errors
- Check Firestore: is `persistCount` shown anywhere (it's not persisted, only in RAM)

### Offline/Online Flicker
- Device is reconnecting within the 15s debounce window
- This is normal for unstable cellular coverage
- If persistent, check `OFFLINE_DEBOUNCE_MS` config

### Commands Not Reaching Device
- For SMS commands (V28C): check Twilio logs
- For TCP commands (V46+): verify device has active TCP (`[tcp] connected`)
- For TCP-only commands: ensure device is `connectionState: live`, not `offline`

### High Firestore Costs
- Check `WRITE_GATE_HEARTBEAT_MINUTES`: if set too low, heartbeats persist too often
- Check if devices are sending location too frequently (device firmware setting)
- Review `PRESENCE_TOUCH_MS`: presence touches are full Firestore writes

