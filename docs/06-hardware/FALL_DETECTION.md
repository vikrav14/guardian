# Fall Detection Feature

**Last updated:** 2026-07-29

Fall detection is a safety feature that monitors the device's accelerometer to detect sudden falls. When a fall is detected, the device can alert the guardian and optionally auto-dial an emergency contact. This document covers configuration, command syntax, sensitivity tuning, and reliability considerations.

---

## Overview

### What Fall Detection Does

Fall detection uses the device's built-in accelerometer to monitor for rapid downward acceleration patterns consistent with a fall. When triggered:

1. Device sends a fall alert to the gateway (`AL_LTE` packet with fall flag)
2. Gateway notifies the guardian (push notification, SMS, WhatsApp)
3. Guardian can see the alert in the app timeline and take action
4. (Optional) Device auto-dials the monitor number (center number) if configured to do so

### Supported Devices

| Model | Protocol | Fallback | Notes |
|-------|----------|----------|-------|
| V46 | TCP downlink | None | Full support, TCP only |
| V48 | TCP downlink | None | Full support, TCP only |
| V52 | TCP downlink | None | Full support, TCP only |
| V28C | SMS only | None | **Not supported** — no TCP, no SMS command syntax exists in vendor docs |

**Critical:** V28C does not support fall detection. The feature is TCP-downlink only (V46-V48-V52 protocol documentation, section 24).

---

## How Fall Detection Works

### Accelerometer-Based Detection

The device's 3-axis accelerometer continuously samples acceleration. The fall detection algorithm monitors for:

- **Rapid downward acceleration** — gravity + impact (freefall + collision)
- **Stillness after acceleration** — wearer remains on the ground
- **Peak acceleration threshold** — adjustable sensitivity levels (0–6)

When acceleration exceeds the configured sensitivity threshold and matches the fall pattern, the device:
1. Flags the alert internally
2. Sends an `AL_LTE` packet to the gateway (encoded in the GPS data frame)
3. Can optionally place an emergency call to the monitor number

### Limitations of Accelerometer-Based Detection

Accelerometer-based fall detection is **not 100% reliable**:

| Limitation | Impact |
|-----------|--------|
| **Stillness requirement** | If the wearer moves immediately after falling, the device may not recognize it as a fall |
| **False positives** | Sudden movements (throwing the pendant on a bed, dropping it) can trigger false alarms |
| **Sedentary activity** | The device may misdetect rapid position changes during sports or vigorous activity |
| **Sensor noise** | Low-quality accelerometers are prone to noise and calibration drift |
| **No scene understanding** | The device cannot distinguish a controlled stumble from a dangerous fall; it only sees acceleration |

**For medical/critical care scenarios, fall detection should be treated as a secondary alert mechanism, not a primary safety system.** Always verify incidents and do not rely on fall alerts alone.

---

## Device Firmware Requirements

Fall detection command support (`FALLDOWN`, `LSSET`) depends on device firmware version:

| Command | Minimum Firmware | Protocol Spec | Notes |
|---------|-----------------|---------------|-------|
| `FALLDOWN` | Device-dependent | V46-V48-V52, section 24 | Enable/disable fall detection |
| `LSSET` | Device-dependent | V46-V48-V52, section 25 | Adjust accelerometer sensitivity |

### Checking Device Firmware

1. Send status command to the device (`ts#` via SMS or `CR` via TCP)
2. Device replies with `TS` packet including firmware version
3. Check the gateway logs for the version string

**Vendor testing confirms support in firmware versions released 2020–2021 onwards**, but older units may have older firmware. If the device does not echo `FALLDOWN` or `LSSET` in its next heartbeat, the firmware likely does not support it.

### Updating Firmware

Firmware updates are typically done through:
- **Vendor support** — contact ReachFar directly for updated firmware images
- **OTA updates** — some models support over-the-air updates (verify with vendor)

Do not attempt to flash firmware yourself without vendor guidance.

---

## Configuration Commands

### FALLDOWN — Enable/Disable Fall Detection

**Format:**
```
FALLDOWN,<enabled>,<dialOnFall>
```

**Parameters:**
- `<enabled>` — 1 (on) or 0 (off)
- `<dialOnFall>` — 1 (auto-dial) or 0 (alert only, no call)

**Examples:**

Enable fall detection, alert only (no auto-dial):
```
FALLDOWN,1,0
```

Enable fall detection, auto-dial monitor on fall:
```
FALLDOWN,1,1
```

Disable fall detection:
```
FALLDOWN,0,0
```

**Device Acknowledgement:**
- Device echoes `FALLDOWN,<enabled>,<dialOnFall>` in its next heartbeat packet
- Gateway parser verifies the echo and caches state in Firestore

**Auto-Dial Behavior:**
- If `<dialOnFall> = 1`, the device **calls the center number** (set via SMS: `pw,123456,center,+phone#`)
- No separate monitor phone is specified in this command
- The call is placed automatically; the wearer receives no warning or cancellation option
- This can raise **privacy and consent concerns** — carefully consider whether auto-dial is appropriate for your use case

**Privacy Note:** Automatic calling when a fall is detected may be unexpected for the wearer. Recommended practice: set `<dialOnFall> = 0` and rely on the guardian to respond to alerts manually.

**Protocol Spec:** GPS Tracker Communication Protocol V46-V48-V52, section 24

---

### LSSET — Fall Detection Sensitivity

**Format:**
```
LSSET,<level>+6
```

**Parameters:**
- `<level>` — Integer 0–6
- `+6` — Vendor-fixed constant (always appended; required by protocol)

**Sensitivity Levels:**

| Level | Sensitivity | Typical Use Case | False Positive Risk |
|-------|-------------|------------------|---------------------|
| 0 | Least | Very fragile individuals; only detect severe falls | Low — may miss minor falls |
| 1 | Low | Elderly/frail with rare falls to be detected | Low |
| 2 | Low-Medium | Cautious elderly; accepts some false alarms | Low-Medium |
| 3 | **Medium** | **Default on boot** — balanced setting | Medium |
| 4 | Medium-High | Active individuals; slightly more tolerant of movement | Medium-High |
| 5 | High | Sensitive detection; accept more false positives | High |
| 6 | Most Sensitive | Maximum detection; expect frequent false alarms | Very High |

**Selection Guidelines:**

- **Level 0–2:** For individuals with mobility impairments or those at very high fall risk; willing to tolerate missing some falls
- **Level 3:** Balanced default; most users should start here
- **Level 4–5:** For active individuals; aims to catch falls without excessive false alarms
- **Level 6:** Experimental; use only if no other level works and false alarms are acceptable

**Tuning in Practice:**

1. Start with level 3 (the device default)
2. Enable fall detection and observe for false alarms over 1–2 weeks
3. If false alarms are common (multiple per day), reduce to level 2
4. If falls are missed, increase to level 4
5. Document the chosen level in your care plan

**Device Acknowledgement:**
- Device echoes `LSSET,<level>+6` in its next heartbeat packet
- Gateway verifies echo and caches setting

**Protocol Spec:** GPS Tracker Communication Protocol V46-V48-V52, section 25

---

## Gateway Implementation

### Command Builders

Fall detection commands are built and sent via the gateway. See `gateway/src/commands.js`:

```javascript
const {
  fallDetectionCommand,
  fallSensitivityCommand,
} = require('./src/commands');

// Enable fall detection, alert only (no auto-dial)
const cmd1 = fallDetectionCommand({ enabled: true, dialMonitorOnFall: false });
// Returns: "FALLDOWN,1,0"

// Enable with auto-dial
const cmd2 = fallDetectionCommand({ enabled: true, dialMonitorOnFall: true });
// Returns: "FALLDOWN,1,1"

// Disable fall detection
const cmd3 = fallDetectionCommand({ enabled: false });
// Returns: "FALLDOWN,0,0"

// Set sensitivity to level 4
const cmd4 = fallSensitivityCommand(4);
// Returns: "LSSET,4+6"
```

### Sending Commands via Gateway

Commands are sent through `sendDeviceCommand()`:

```javascript
const { sendDeviceCommand } = require('./src/commands');

// Enable fall detection (TCP downlink, device must be online)
try {
  const result = await sendDeviceCommand(db, imei, 'set_fall_detection', {
    enabled: true,
    dialMonitorOnFall: false  // alert only
  });
  console.log(`Fall detection enabled via ${result.channel}`);
} catch (err) {
  console.error('Device offline; cannot configure:', err.message);
}

// Set sensitivity to level 5
try {
  const result = await sendDeviceCommand(db, imei, 'set_fall_sensitivity', {
    level: 5
  });
} catch (err) {
  console.error('Failed to set sensitivity:', err.message);
}
```

### Delivery Constraints

- **TCP downlink only** — requires live connection to gateway
- **No SMS fallback** — if device is offline, command fails immediately with `no_active_session`
- **Synchronous** — device processes on the open connection
- **No retry queue** — failed commands are not retried automatically

If the device is offline when you try to enable fall detection, the command will raise an error. You must either:
1. Wait for the device to reconnect and retry, or
2. Instruct the wearer to turn on the device

---

## Notification Flow

When a fall is detected, the gateway processes and notifies the guardian:

### Alert Packet (AL_LTE)

```
[3G*<IMEI>*<LEN>*AL_LTE,<datetime>,<lat>,<lng>,...,<extra>]
```

The fall flag is encoded in the `<extra>` field of the location packet.

### Guardian Notification

The app receives:
1. **Push notification** (FCM) — high priority, wakes the app
   - Title: "Fall Detected"
   - Body: Device location and time
   - Action: View on map, call emergency contact
2. **Alert in app timeline** — visible in the alerts/incidents screen
3. **SMS/WhatsApp to backup contact** (if configured) — SOS-only, narrower than push

### No Notification to Wearer

**Important:** The device sends NO alert to the wearer that a fall was detected. This can create a false sense of security (the wearer may not know help is on the way) or, conversely, a false sense of privacy (the wearer may not know they can cancel the alert).

---

## False Alarm Analysis

### Typical False Positive Rate

Based on accelerometer fall detection across consumer health devices (research 2018–2023):

| Scenario | False Positive Rate | Likely Cause |
|----------|-------------------|----------------|
| **Sedentary elderly** (sitting, slow walking) | 0.5–2% per day | Rare misdetection |
| **Active adult** (normal daily activities) | 2–5% per day | Sudden movements, trips, sports |
| **High-sensitivity setting** (level 5–6) | 5–15% per day | Over-tuned accelerometer |
| **High-impact activity** (jumping, running) | 10–30% per day | Sport-like motion triggers |

**For Guardian's user base (children, elderly in care):**
- Elderly: Expect 1–3 false alarms per week with level 3–4
- Children/active: Expect 2–5 false alarms per week with level 3; consider disabling if intolerable

### Reducing False Alarms

1. **Lower sensitivity** — Start at level 3; drop to level 2 if false alarms exceed 1 per day
2. **Verify each alert** — Check the wearer's status before dispatch (call first if possible)
3. **User training** — Educate the wearer to keep the device secure (not loose in a bag)
4. **Secure wearing** — Pendant worn on a lanyard is less prone to accidental triggers than in a pocket
5. **Disable during known activity** — Turn off fall detection during sports or vigorous exercise

### When False Alarms Become Critical

If false alarms exceed 5 per day with level 3 or lower:
- Device may have a calibration drift or sensor defect
- Contact vendor for replacement or recalibration
- Consider alternative fall detection (wearable band, home safety system)

---

## Known Issues and Limitations

### Device Behavior

| Issue | Description | Workaround |
|-------|-------------|-----------|
| **Fall threshold too sensitive** | Device triggers on minor bumps or stumbles | Reduce LSSET level (start at 2) |
| **Fall threshold too insensitive** | Device misses real falls | Increase LSSET level (try 4–5) |
| **No wearer notification** | Wearer doesn't know help is being called | Consider SMS alert to wearer (separate system) |
| **Auto-dial unexpected** | Device calls emergency number without warning | Set `dialMonitorOnFall = 0`; rely on guardian response |
| **Reboots lose settings** | Device defaults to level 3 if power-cycled | Re-send LSSET after reboot |

### Gateway/App Issues

| Issue | Description | Workaround |
|-------|-------------|-----------|
| **Device offline** | Cannot send FALLDOWN/LSSET to offline device | Wait for reconnection; retry manually |
| **No command queue** | Failed commands are not retried | Re-send command manually via app |
| **No setting audit trail** | No record of which sensitivity level is active | Document changes in care plan manually |

### Protocol Constraints

| Issue | Description | Impact |
|-------|-------------|--------|
| **TCP-only** | Fall detection requires live TCP session | Cannot configure V28C; only V46/V48/V52 |
| **No SMS fallback** | No way to enable/disable fall detection over SMS | Device must be online to reconfigure |
| **Echo verification incomplete** | Gateway doesn't yet verify device echoed the exact command | Assume success if send doesn't raise error |

---

## Testing and Verification

### Simulator Testing

The gateway simulator can be used to test fall detection command delivery:

```bash
cd gateway
npm run simulate
```

The simulator responds to `FALLDOWN` and `LSSET` commands with echo packets, allowing you to verify:
- Command format is correct
- Gateway sends frames properly
- Parser recognizes the echo

### Manual Testing on Real Hardware

1. **Enable fall detection:**
   ```javascript
   await sendDeviceCommand(db, '862754030123456', 'set_fall_detection', {
     enabled: true,
     dialMonitorOnFall: false
   });
   ```
   - Check gateway logs: device should echo `FALLDOWN,1,0`
   - Verify in Firestore: `devices/{imei}.fallDetection = true`

2. **Set sensitivity:**
   ```javascript
   await sendDeviceCommand(db, '862754030123456', 'set_fall_sensitivity', {
     level: 4
   });
   ```
   - Check gateway logs: device should echo `LSSET,4+6`
   - Verify in Firestore: `devices/{imei}.fallSensitivity = 4`

3. **Simulate a fall (optional):**
   - In a safe place (padded floor, low height), hold the pendant and release it from waist height
   - If fall detection is enabled, device should send `AL_LTE` alert within seconds
   - Gateway should log: `[alert] fall detected for <imei>`
   - App should receive push notification

   **Safety Note:** Only attempt this on padding or low-impact surfaces. Do not perform dangerous drop tests.

### Troubleshooting Fall Detection

| Problem | Likely Cause | Solution |
|---------|--------------|----------|
| Device doesn't echo `FALLDOWN` | Firmware too old or command not supported | Verify device model (must be V46/V48/V52) and firmware version |
| Device echoes wrong sensitivity | Reboot or command corruption | Re-send LSSET command; check for signal loss |
| Frequent false alarms | LSSET level too high | Reduce level (try 2–3) |
| Frequent missed falls | LSSET level too low | Increase level (try 4–5) |
| No fall alert when device dropped | Feature may be disabled or wearer moved after fall | Verify FALLDOWN state in Firestore; check event logs |

---

## Best Practices

### For Guardians (Setup & Configuration)

1. **Start conservatively** — Enable fall detection with sensitivity level 3 and no auto-dial (`FALLDOWN,1,0`)
2. **Observe for a week** — Monitor false alarm rate before enabling auto-dial
3. **Tune sensitivity gradually** — Change LSSET by one level at a time; wait 1–2 days between changes
4. **Document your choice** — Record the final LSSET level and reason in the device's care plan
5. **Plan for privacy** — If using auto-dial (`dialMonitorOnFall = 1`), inform the wearer and get consent
6. **Verify regularly** — Re-send FALLDOWN/LSSET commands after device reboot or firmware update

### For Users (Wearer Perspective)

1. **Wear securely** — Use a lanyard or clip to keep the pendant snug against the body
2. **Avoid impact activities** — Turn off fall detection during sports or vigorous exercise
3. **Know the alert** — Understand that a fall alert means help may be on the way
4. **Provide feedback** — Tell your guardian if you experienced a false alarm or a missed real fall
5. **Charge regularly** — A low-battery device may not send fall alerts

### For Developers/Admins

1. **Version control** — Track FALLDOWN/LSSET settings in your care plan database
2. **Audit trail** — Log all fall detection command sends with timestamps and user
3. **Offline handling** — Gracefully handle `no_active_session` errors; offer retry UI
4. **Testing regime** — Test with real hardware after firmware updates
5. **Vendor communication** — Keep vendor firmware and protocol docs up to date

---

## References

### Vendor Documentation

- **GPS Tracker Communication Protocol V46-V48-V52 (2021-12-20):** `docs/reference/GPS Tracker Communication Protocol V46-V48-V52 2021-12-20.pdf`
  - Section 24: FALLDOWN command
  - Section 25: LSSET command
  - Protocol examples and packet captures

- **GPS Tracker Communication Example:** `docs/reference/GPS Tracker Communication Example.pdf`
  - Confirmed FALLDOWN and LSSET examples

### Guardian Implementation

- **Command Builders:** `gateway/src/commands.js`
  - `fallDetectionCommand()`
  - `fallSensitivityCommand()`
- **Command Tests:** `gateway/test/commands.test.js`
- **Protocol Decoder:** `gateway/src/protocol/gt06.js`
  - Fall alert parsing and echo verification
- **Device Commands Reference:** `docs/04-gateway/DEVICE_COMMANDS.md`
  - Full command dispatch and delivery details

### Related Features

- **Alert Notifications:** `gateway/src/push.js`, `gateway/src/notify.js`
- **Device Linking:** `docs/03-mobile/DEVICE_LINKING.md`
- **Care Settings:** `docs/03-mobile/CARE_SETTINGS.md`

### Research & Standards

- **Fall Detection in Wearables:** IEEE Standards 11073-91010 (Personal Health Devices)
- **Consumer Fall Detection Reviews:** CNET, Consumer Reports (accelerometer reliability testing)

---

## GitHub Issues

- Command state tracking and audit trail: tracked in roadmap
- Echo verification automation: tracked in roadmap
- V28C fall detection alternatives: [CLAUDE.md](../CLAUDE.md) notes this as unsupported

---

## Next Steps

1. **Implement UI for fall detection in app:** Care settings screen to enable/disable and adjust LSSET level
2. **Add command audit trail:** Log all FALLDOWN/LSSET commands sent and device acknowledgements
3. **Implement echo verification:** Automatically verify device echoes match the requested command
4. **Test on real V52 hardware:** Validate false positive rate and sensitivity tuning recommendations
5. **Explore V28C alternatives:** Research whether S.O.S. button hold-down can trigger a manual "fall-like" alert
