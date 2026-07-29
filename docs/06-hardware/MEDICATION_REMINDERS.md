# Medication Reminders (TAKEPILLS Command)

**Last updated:** 2026-07-29

Medication reminders allow guardians to schedule time-based text prompts on the pendant to remind the wearer to take medication or perform other health tasks. This document covers the TAKEPILLS command, device scheduling, reminder delivery, limitations, and hardware requirements.

---

## Overview

The Guardian gateway sends medication reminders to supported GPS pendants using the **TAKEPILLS** command, a TCP downlink-only protocol message. The pendant stores the reminder schedule in its local memory and displays or voices the reminder text at the scheduled time.

| Aspect | Details |
|--------|---------|
| **Command** | TAKEPILLS (TCP downlink only) |
| **Supported Hardware** | V46, V48, V52 (TCP protocol); V28C not supported |
| **Delivery Channel** | TCP downlink only — no SMS fallback |
| **Scheduling** | Once, daily, or weekly (7-day bitmask) |
| **Display** | Device firmware dependent: text on screen, voice alert, buzzer, or combination |
| **Acknowledgement** | Device echoes command in next outbound packet |
| **Reliability** | Requires live TCP connection; fails immediately if device offline |

---

## The TAKEPILLS Command

### Format

```
TAKEPILLS,<time>-<enabled>-<frequency>[-<week>],<frequency>,<hexText>
```

### Parameters

- **`<time>`** — Reminder time in 24-hour format (HH:MM), e.g., `09:30`, `14:00`
- **`<enabled>`** — 1 (reminder active) or 0 (reminder suppressed but stored)
- **`<frequency>`** — Type of schedule:
  - `1` = Once (one-time reminder)
  - `2` = Daily (repeats every day at the specified time)
  - `3` = Weekly (repeats on selected days of the week)
- **`<week>`** — Required only if `frequency = 3` (weekly). A 7-digit mask (Sun–Sat):
  - `0110110` = Monday through Friday (skip Saturday and Sunday)
  - `1010101` = Odd days (Sun, Tue, Thu, Sat)
  - `1111111` = Every day (equivalent to daily, but uses weekly format)
  - Position order: `[Sun][Mon][Tue][Wed][Thu][Fri][Sat]`
- **`<hexText>`** — Reminder text encoded as **UTF-16BE hex** (4 hex characters per character, no separators)
  - `"daily"` → `006400610069006c0079`
  - `"take meds"` → `00740061006b0065002000 6d006500640073`

### Text Encoding (UTF-16BE)

The device requires reminder text in UTF-16BE hexadecimal format. This is handled automatically by the gateway's `textToHexUtf16()` function; the app sends plain text.

**Example encoding breakdown:**

```
Text: "meds"
Bytes in UTF-16BE:
  m = 006d
  e = 0065
  d = 0064
  s = 0073
Hex string: "006d0065006400 73"
```

The gateway performs this conversion internally; developers do not need to manually encode text.

---

## Command Examples

### One-Time Reminder

**At 09:30, remind once:**

```
TAKEPILLS,09:30-1-1,1,006d006500640073
```

Breaking down:
- Time segment: `09:30-1-1` (time, enabled=1, frequency=1 for "once")
- Frequency: `1`
- Hex text: `006d006500640073` (UTF-16BE for "meds")

### Daily Reminder

**At 14:00, every day:**

```
TAKEPILLS,14:00-1-2,2,0054006100 6b006500200069006e00730075006c0069006e
```

Breaking down:
- Time segment: `14:00-1-2` (time, enabled=1, frequency=2 for "daily")
- Frequency: `2`
- Hex text: UTF-16BE for "Take insulin"

### Weekly Reminder

**At 08:00, Monday–Friday (weekdays only):**

```
TAKEPILLS,08:00-1-3-0111110,3,00620006c006f006f00640020007000720065007300 730075007200650073
```

Breaking down:
- Time segment: `08:00-1-3-0111110` (time, enabled=1, frequency=3 for "weekly", week mask=0111110)
- Week mask `0111110`:
  - Position 0 (Sunday): `0`
  - Position 1 (Monday): `1`
  - Position 2 (Tuesday): `1`
  - Position 3 (Wednesday): `1`
  - Position 4 (Thursday): `1`
  - Position 5 (Friday): `1`
  - Position 6 (Saturday): `0`
- Frequency: `3`
- Hex text: UTF-16BE for "blood pressures"

---

## Device Scheduling

### How the Device Processes Reminders

1. **Receive:** Device receives TAKEPILLS frame via TCP downlink
2. **Parse:** Device extracts time, frequency, week mask, and text
3. **Store:** Device stores reminder in local (non-volatile) memory
4. **Echo:** Device sends back a TAKEPILLS echo in its next outbound packet (heartbeat)
5. **Trigger:** At the scheduled time(s), device displays/speaks the reminder text
6. **Display:** Presentation depends on device firmware (see "Display & Alerts" section below)

### Time Zones

**Critical assumption:** The pendant uses **local device time** (set during device setup). The guardian app does not set or synchronize device time; it only sends reminder times in HH:MM format. If the device's clock is incorrect, reminders will trigger at wrong times.

**Verification needed:** Confirm with the hardware vendor whether:
- Device time is set via SMS command (e.g., `ts#`) or defaults to cellular network time
- Device supports timezone configuration
- Device drifts over time without re-sync

---

## Display & Alerts

### Device Firmware Support

The V46/V48/V52 pendant can display medication reminders, but the exact presentation depends on device firmware:

| Display Method | Expected Behavior | Verified? | Notes |
|----------------|-------------------|-----------|-------|
| **Screen display** | Text message appears on LCD | Not confirmed | Device must have a display |
| **Voice alert** | Text is spoken aloud via speaker | Not confirmed | Device must have speaker and TTS or prerecorded audio |
| **Buzzer/vibration** | Audible or tactile alert | Not confirmed | Usually paired with screen or voice |
| **LED indicator** | Light blinks to draw attention | Not confirmed | Optional supplementary alert |

**⚠️ Unverified:** Guardian's implementation sends the command and expects acknowledgement, but has not validated on real hardware whether the device actually displays the text, speaks it, or uses a combination of alerts. This must be confirmed during hardware testing (see "Hardware Verification" section).

### Text Limitations

- **Maximum length:** Vendor documentation does not specify a character limit for reminder text. The gateway currently has no validation. Test with your device to determine safe length.
- **Special characters:** UTF-16BE encoding supports Unicode, but the device may only render ASCII or a limited character set. Test with your device.
- **Non-Latin scripts:** Reminders in Arabic, Chinese, Cyrillic, etc., will be hex-encoded correctly, but the device's display/speaker must support rendering those scripts.

---

## Reminder Management

### Creating a Reminder

From the Guardian app (Care Settings screen):

1. **Tap "Medication Reminders"** → **Add reminder**
2. **Fill in:**
   - Reminder text (e.g., "Take blood pressure tablets")
   - Time (24-hour format, e.g., 14:30)
   - Frequency: Once, Daily, or Weekly
   - If weekly: select days of the week (Mon–Fri, specific days, etc.)
3. **Tap "Save"** → App writes to Firestore and enqueues command
4. **Gateway receives command** and sends TAKEPILLS frame to device
5. **Device echoes** the command in its next packet
6. **App confirms** and displays reminder in the Care Settings list

### Modifying a Reminder

**Toggle enable/disable:**
- Tap the reminder's toggle switch
- App sends a new TAKEPILLS command with `enabled=0` or `enabled=1`
- Device updates the reminder's active status without deleting it

**Edit text, time, or frequency:**
- App UI currently requires delete-and-recreate (the mobile code does not support in-place edits)
- Delete the old reminder; create a new one with updated values
- Firestore tracks the change; gateway enqueues the old and new commands

**Delete a reminder:**
- Tap the reminder's delete button
- App deletes the Firestore record
- **Note:** Device has no "delete reminder" command, so the device still has the old reminder in memory
- Future work: implement a delete command or full device sync on app launch

### Limitations & Known Gaps

#### 1. No Delete Command

The vendor's protocol does not include a "delete reminder" command. When a guardian deletes a reminder from the app:

- The Firestore record is removed
- The app shows the reminder as deleted
- **The device still has the old reminder in its memory**
- If the guardian recreates a reminder with the same time/frequency, the device may have duplicates

**Workaround:** Manually clear device reminders via the vendor's admin tools, or design UI to prompt the user to reset the device when switching major configurations.

#### 2. Device Not Connected at Reminder Time

If the device is offline during a scheduled reminder time:

- The reminder does not trigger (the device is not listening)
- No alert is queued or retried
- When the device reconnects, the app does not know the reminder was missed

**Workaround:** Design UX to show guardians whether the device is currently online before setting critical reminders.

#### 3. Device Memory Limits

Vendor documentation does not specify how many reminders the device can store. A device with 100 reminders created by multiple guardians (in a family) might run out of memory.

**Workaround:** Test memory limits during hardware verification; document max reminder count.

#### 4. Reminder Sync Gap

If a reminder is created while the device is offline:

1. App writes to Firestore (reminder appears in list)
2. App enqueues command
3. Device is offline, so command fails
4. Reminder stays in Firestore but device never receives it
5. When device reconnects, there is no automatic retry; the guardian must manually toggle or re-save the reminder to re-send the command

**Workaround:** Future work: implement a command queue that retries failed TCP commands on reconnection.

---

## Delivery & Acknowledgement

### TCP Downlink Only

Medication reminders use the **TCP downlink channel**, which means:

- Device must have an active, live TCP connection to the gateway
- If the device is offline, the command fails immediately with `no_active_session`
- **No SMS fallback exists**
- **No queuing or retry mechanism** — the command is lost if the device is not connected

### Device Echo Verification

When the device receives a TAKEPILLS command, it sends back an echo in its next outbound packet:

```
TAKEPILLS,<timeSegment>,<frequency>,<hexText>
```

The gateway's parser receives this echo and **currently does not automatically verify** it matches the sent command. The app caches the desired state and assumes success if the send did not error.

**Future improvement:** Implement echo matching to detect:
- Device reboot before acknowledgement
- Device ignoring the command
- Command corruption during transmission

---

## Reliability & Error Handling

### Device Offline Errors

When sending a medication reminder to an offline device:

```javascript
try {
  await sendDeviceCommand(db, imei, 'set_medication_reminder', {
    time: '09:30',
    frequency: 2,  // daily
    text: 'Take your meds'
  });
} catch (error) {
  // Error: "Device has no active connection right now — set_medication_reminder requires
  // a live session (no SMS fallback exists for this command)"
}
```

The app must handle this error and inform the guardian that the device is offline.

### Command Validation

The gateway's `medicationReminderCommand()` builder validates inputs before sending:

- **Time format:** Must be valid HH:MM in 24-hour format (00:00–23:59)
- **Frequency:** Must be 1, 2, or 3
- **Week mask:** If frequency=3, must be a 7-digit string of 0s and 1s
- **Text:** Must not be empty; max length untested (recommend <100 chars)

Invalid inputs raise an error before the command is sent.

### Device Firmware Dependencies

The reliability of medication reminders depends on:

1. **Device firmware version** — Must support TAKEPILLS command parsing
2. **Device time accuracy** — Clock drift causes reminders to trigger at wrong times
3. **Device storage** — Firmware may limit the number of stored reminders
4. **Device display/speaker** — Firmware must be configured to show/speak the text
5. **Device power** — Low battery may suppress non-critical alerts (unverified)

None of these have been confirmed on real hardware yet.

---

## Hardware Requirements & Verification

### Supported Models

| Model | TCP Protocol | TAKEPILLS | Notes |
|-------|--------------|-----------|-------|
| **V28C** | ✗ No | ✗ | SMS only; no TCP downlink |
| **V46** | ✓ Yes | ✓ | Full support (unverified on real hardware) |
| **V48** | ✓ Yes | ✓ | Full support (unverified on real hardware) |
| **V52** | ✓ Yes | ✓ | Full support (unverified on real hardware) |

### What the Device Must Support

For medication reminders to work end-to-end, the pendant must:

1. **Parse TAKEPILLS frames** — Understand the TCP downlink protocol structure
2. **Store reminder schedules** — Retain time, frequency, week mask, and text in memory
3. **Keep accurate time** — Have a real-time clock (RTC) that stays synchronized
4. **Trigger at scheduled times** — Wake or check the clock at the reminder time
5. **Display or speak text** — Render text on screen or convert to speech
6. **Send echo packets** — Acknowledge the command in the next outbound heartbeat

### Unverified Aspects

The following have **not been tested on real hardware** and must be confirmed:

- [ ] Device actually displays reminder text on its screen
- [ ] Device speaks reminder text aloud (if it has TTS or audio)
- [ ] Buzzer/vibration alerts trigger alongside display/voice
- [ ] Device time stays synchronized (or drifts significantly)
- [ ] Device can store more than 10 reminders without errors
- [ ] Long reminder text (>50 chars) renders correctly
- [ ] Unicode/non-ASCII text encodes and displays correctly
- [ ] Device behavior when offline during scheduled reminder time
- [ ] Device behavior when it reboots with stored reminders
- [ ] Simultaneous reminders (multiple at same time) are handled correctly

**See GitHub Issue #12** for ongoing verification work.

---

## Gateway Implementation

### Command Builder

Located in `gateway/src/commands.js`:

```javascript
const { medicationReminderCommand, textToHexUtf16 } = require('./src/commands');

// Build a medication reminder command
const command = medicationReminderCommand({
  time: '14:30',      // HH:MM, required
  frequency: 1,       // 1=once, 2=daily, 3=weekly, required
  week: '0111110',    // 7-digit mask, required if frequency=3
  text: 'Take blood pressure medication',  // Plain text, required
  enabled: true       // Optional; defaults to true
});

// Returns: "TAKEPILLS,14:30-1-1,1,0054006100 6b006500200069006e00..."
```

### Sending a Reminder

```javascript
const { sendDeviceCommand } = require('./src/commands');

// Send medication reminder to device
const result = await sendDeviceCommand(db, imei, 'set_medication_reminder', {
  time: '09:30',
  frequency: 2,    // daily
  text: 'Take insulin'
});

// If device is online: returns { text: "TAKEPILLS,...", channel: 'tcp', result }
// If device is offline: throws error "Device has no active connection..."
```

### Text Encoding

```javascript
const { textToHexUtf16 } = require('./src/commands');

const hex = textToHexUtf16('take meds');
// Returns: "00740061006b0065002000 6d006500640073"

// Used internally by medicationReminderCommand(); no manual encoding needed
```

---

## Testing & Verification

### Unit Tests

Gateway command tests (located in `gateway/test/commands.test.js`):

```bash
cd gateway
npm test -- --grep "medication"
```

Tests cover:
- Command format generation
- Parameter validation (time, frequency, week mask)
- UTF-16BE hex encoding
- Error cases (invalid times, bad frequencies, missing required fields)

### Integration Tests

No integration tests exist yet (requires a real or simulated device connected to the gateway).

### Manual Testing

#### 1. Build a Daily Reminder Command

```javascript
const cmd = medicationReminderCommand({
  time: '08:00',
  frequency: 2,  // daily
  text: 'Take morning medication'
});

console.log(cmd);
// TAKEPILLS,08:00-1-2,2,00540061006b0065...
```

#### 2. Send to Simulated Device

```bash
npm run simulate
```

Then, from app or manual test:

```javascript
await sendDeviceCommand(db, SIMULATOR_IMEI, 'set_medication_reminder', {
  time: '14:30',
  frequency: 1,  // once
  text: 'Take your meds'
});
```

Check the simulator's console output for echo packets.

#### 3. Test on Real Hardware (Future)

When a real device is available:

1. Link device to test account in Firestore
2. Expose gateway to the internet (via tunnel or production server)
3. Device connects to gateway
4. Send medication reminder via Care Settings UI
5. **Verify the device displays the text at the scheduled time**
6. Document any differences from expected behavior

---

## Debugging

### Command Not Sending (Device Offline)

**Error:** `Device has no active connection right now — set_medication_reminder requires a live session`

**Cause:** Device does not have an active TCP connection to the gateway.

**Solution:**
- Ensure device is powered on and has cellular data
- Check gateway connectivity logs for device connection status
- Ask the guardian to ensure the device is online before setting reminders

### Device Not Acknowledging

**Symptom:** Command is sent, but device never echoes the TAKEPILLS packet.

**Possible causes:**
- Device firmware does not support TAKEPILLS
- Device received malformed frame (unlikely; gateway framing is tested)
- Device is powered off or disconnected during the send
- Device stores command but device firmware is too old to echo

**Debugging:**
- Check gateway logs for the outbound frame
- Monitor device's TCP session for incoming/outgoing packets
- Verify device firmware version against vendor's protocol documentation

### Reminder Never Triggers

**Symptom:** Reminder is set and stored, but device does not display text at the scheduled time.

**Possible causes:**
- Device time is incorrect or significantly drifted
- Device firmware does not include reminder trigger logic
- Device is powered off at the scheduled time
- Reminder was sent with `enabled: 0` (disabled)
- Device display/speaker is broken or misconfigured

**Debugging:**
- Manually query device for current time (if vendor provides a command)
- Check device system settings for reminder alert configuration
- Power cycle device to confirm reminders still exist after reboot

---

## References

### Vendor Documentation

- **V46/V48/V52 Protocol:** `docs/reference/GPS Tracker Communication Protocol V46-V48-V52 2021-12-20.pdf` (Section 28: TAKEPILLS)
- **Vendor Example Captures:** `docs/reference/GPS Tracker Communication Example.pdf`

### Guardian Implementation

- **Command Builders:** `gateway/src/commands.js` (functions `medicationReminderCommand()`, `textToHexUtf16()`)
- **Command Dispatch:** `gateway/src/downlink.js` (TCP framing and delivery)
- **Command Tests:** `gateway/test/commands.test.js`
- **Mobile UI:** `apps/mobile/lib/screens/care_settings_page.dart` (reminder creation/editing)
- **Mobile Service:** `apps/mobile/lib/services/medication_reminder_service.dart` (Firestore sync)
- **Data Model:** `firestore/SCHEMA.md` (collection `medicationReminders/{id}`)

### GitHub Issues

- **Hardware verification:** Issue #12 (pedometer/step count; extends to reminder verification)
- **Text encoding edge cases:** No dedicated issue yet
- **No delete command:** Mentioned in CLAUDE.md known gaps
- **Command queuing for offline devices:** No dedicated issue yet

---

## Next Steps & Future Work

1. **Verify on real hardware**
   - Test TAKEPILLS command on V46, V48, V52 pendant
   - Confirm text displays on screen or is spoken
   - Document maximum reminder count
   - Test text encoding with special characters

2. **Implement delete reminder command**
   - Vendor research: does V46/V48/V52 protocol include a delete/clear command?
   - If yes, implement and test
   - If no, consider alternative (device reset, manual clearing)

3. **Add command queuing**
   - Queue failed TCP commands for retry on device reconnection
   - Retry with exponential backoff
   - Allow guardians to see pending commands in the app

4. **Improve error messaging**
   - Show guardians when a device is offline before they create a reminder
   - Suggest re-sending the command after device reconnects
   - Log command failures to device history

5. **Add reminder history**
   - Track when reminders were actually triggered on the device (if device supports reporting)
   - Show guardians which reminders have been delivered, pending, or failed

6. **Support smart pill boxes**
   - Research whether the pendant can pair with external pill boxes
   - If yes, design protocol for sync and compliance tracking
   - See GitHub Issue #29 for context

---

## Glossary

| Term | Definition |
|------|------------|
| **TAKEPILLS** | TCP downlink command that schedules medication reminders on the pendant |
| **TCP Downlink** | Real-time command channel from gateway to device (requires live connection) |
| **Echo** | Device's acknowledgement of a command, sent in the next outbound packet |
| **UTF-16BE** | Unicode encoding (16-bit Big-Endian); used for reminder text on device |
| **Week Mask** | 7-digit string (0s and 1s) representing days of the week (Sun–Sat) |
| **Enabled Flag** | 1 or 0: whether the reminder is currently active or paused |
| **Frequency** | 1 (once), 2 (daily), or 3 (weekly) — how often the reminder triggers |
| **RTC** | Real-Time Clock; the device's built-in time-keeping module |
| **TTS** | Text-To-Speech; software that converts text to spoken audio |

