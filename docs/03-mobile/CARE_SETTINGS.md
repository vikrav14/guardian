# Care Settings — Mobile App Feature

**Last updated:** 2026-07-29

Guardian's care settings page lets guardians configure proactive wellbeing features on supported devices: fall detection, location reporting frequency, and medication reminders. All three features **require V46/V48/V52 hardware** with an active TCP connection to the gateway — there is no SMS fallback for any of these commands.

---

## Overview

Care settings apply to a single device and are managed per-device. The app displays a dedicated screen (`CareSettingsPage`) with three major sections:

1. **Fall Detection** — Enable/disable fall detection with sensitivity tuning and optional emergency call
2. **Location Updates** — Control how frequently the pendant reports its position
3. **Medication Reminders** — Create, edit, and enable/disable reminder schedules

All settings require **a live TCP session** between the pendant and the gateway to take effect. If the device goes offline, settings are queued and persist in Firestore as a cached request; they are applied the next time the pendant connects.

### Device Support

| Feature | V28C | V46/V48/V52 | Notes |
|---------|------|------------|-------|
| Fall Detection | ✗ | ✓ | TCP downlink only; no SMS equivalent |
| Location Reporting | ✗ | ✓ | TCP downlink only; no SMS equivalent |
| Medication Reminders | ✗ | ✓ | TCP downlink only; no SMS equivalent |

---

## 1. Fall Detection

### Overview

Fall detection uses the pendant's built-in accelerometer to sense sudden drops and impacts. When a fall is detected, the app can:

- Alert the guardian immediately via push notification
- Optionally auto-dial a pre-configured monitor number on the device
- Await user confirmation (disarm after 30 seconds if the wearer taps the device screen)

### UI Layout

**Card Header** (always visible):
- Emergency icon (circular red background)
- Title: "Fall detection"
- Subtitle: "Alerts the family if a fall is detected"
- Toggle switch: Enable/disable the feature

**Expanded Controls** (visible when enabled):
- Divider
- **Switch:** "Auto-dial monitor number on fall"
  - When enabled, the device calls a pre-configured SOS contact (set in Emergency Contacts) if a fall is detected
  - No additional configuration needed; uses the default SOS number already stored on the pendant
- **Slider:** "Sensitivity" (0 to 6)
  - Visual: "0 / 6" label on the right
  - Min (0): More sensitive to light bumps, higher false-alarm rate
  - Max (6): Requires a harder, more definitive fall to trigger
  - Increments: 7 levels (0, 1, 2, 3, 4, 5, 6)
- **Informational text:** "Lower is more sensitive (more false alarms); higher requires a harder fall to trigger."
- **Save button:** Sends settings to the pendant

### Device Command

```
FALLDOWN,<enabled>,<dialMonitorOnFall>
LSSET,<sensitivityLevel>+6
```

Two separate TCP downlink commands are sent (gateway combines them):

1. **FALLDOWN** command (Protocol section 24)
   - First parameter: `1` (enabled) or `0` (disabled)
   - Second parameter: `1` (auto-dial) or `0` (no auto-dial)
   - Example: `FALLDOWN,1,1` enables fall detection with auto-dial

2. **LSSET** command (Protocol section 25)
   - Sensitivity level (0–6)
   - Fixed second value: `6` (vendor requirement, not configurable)
   - Example: `LSSET,3+6` sets sensitivity to 3

### Firestore Schema

Device document (`devices/{imei}`):

```javascript
{
  fallDetection: {
    enabled: boolean,
    dialMonitorOnFall: boolean,
    sensitivityLevel: number // 0-6
  }
}
```

**Note:** This is a **cache of the last request sent**, not confirmed device state. The V46/V48/V52 protocol has no "read back my fall-detection config" command, so the app can only remember what it last asked the device to do.

### When Settings Take Effect

- **Immediately (if device online):** Settings are sent via TCP downlink as soon as the user taps "Save"
- **On reconnect (if device offline):** Settings persist in Firestore and are applied when the device next connects and establishes a live TCP session with the gateway
- **Confirmation:** App shows a snackbar: "Fall detection settings sent to pendant" (online) or "Could not reach pendant" (offline/error)

### Example Flow

```
User toggles "Fall detection" ON
  ↓
User sets sensitivity to 4
  ↓
User taps "Save"
  ↓
App calls DeviceService.updateFallDetectionPrefs(imei, enabled: true, dialMonitorOnFall: false, sensitivityLevel: 4)
  ↓
DeviceService sends deviceCommand to Firestore with type: 'set_fall_detection' + 'set_fall_sensitivity'
  ↓
Gateway receives commands, dispatches FALLDOWN,1,0 and LSSET,4+6 via TCP downlink
  ↓
Device receives, applies settings, acknowledges
  ↓
App updates local Device model's fallDetection cache
```

---

## 2. Location Updates

### Overview

By default, the pendant sends its location on an irregular, long interval (often 15–30 minutes or longer). This setting lets guardians request more frequent updates for fresher tracking data — useful during outings or if the wearer is in an uncertain area.

### UI Layout

**Card Header** (always visible):
- Location icon (circular blue background)
- Title: "Location updates"
- Subtitle: "How often the pendant reports its position"

**Controls:**
- **Segmented button group:** Four presets
  - "30s" (30 seconds)
  - "1m" (60 seconds)
  - "2m" (120 seconds)
  - "5m" (300 seconds)
- **Informational text:** "More frequent updates give a fresher map but use more pendant battery. Without this set, the pendant's default interval is long and irregular."
- **Save button:** Sends interval to the pendant

### Device Command

```
UPLOAD,<seconds>
```

TCP downlink command (Protocol section II.1):
- Parameter: integer seconds (30–3600 range, though UI only exposes 30/60/120/300)
- Example: `UPLOAD,60` sets location reporting to every 60 seconds

### Firestore Schema

Device document (`devices/{imei}`):

```javascript
{
  locationReportingIntervalSeconds: number // 30-3600, user's last request
}
```

**Note:** Like fall detection, this is a **cache of the last request sent**, not confirmed device state.

### UI Presets vs. Protocol Range

The protocol supports any interval from 10 to 3600 seconds. The UI offers only four presets (30, 60, 120, 300) to keep things simple. These are hardcoded in the Flutter app:

```dart
static const _uploadIntervalPresets = [30, 60, 120, 300];
```

If a device has a saved interval not in the preset list (e.g., 90 seconds from an older version or manual API call), the UI defaults to 60 seconds when the page loads.

### When Settings Take Effect

- **Immediately (if device online):** Sent via TCP downlink as soon as the user taps "Save"
- **On reconnect (if device offline):** Persists in Firestore; applied when the device reconnects
- **Battery impact:** More frequent updates drain battery faster. 30-second updates can reduce battery life significantly; 300-second updates (5 minutes) is a reasonable balance

### Example Flow

```
User selects "1m" (60 seconds)
  ↓
User taps "Save"
  ↓
App calls DeviceService.updateLocationReportingInterval(imei, seconds: 60)
  ↓
Gateway receives 'set_upload_interval' command with seconds: 60
  ↓
Gateway dispatches UPLOAD,60 via TCP downlink
  ↓
Device receives, begins sending location every 60 seconds
  ↓
App caches locationReportingIntervalSeconds: 60 in Firestore
```

---

## 3. Medication Reminders

### Overview

Medication reminders let guardians schedule one-time or recurring prompts on the pendant to remind the wearer to take medication. Each reminder is a simple text message displayed or spoken on the device, accompanied by an optional buzzer alert.

Reminders can be:
- **Once:** Single occurrence at a specific date/time
- **Daily:** Every day at a set time
- **Weekly:** Specific days of the week at a set time (e.g., "Mon, Wed, Fri at 8:00 AM")

### UI Layout

**Card Header:**
- Medication icon (circular yellow/orange background)
- Title: "Medication reminders"
- Add button (circular "+" icon) to create a new reminder

**Reminder List** (from Firestore stream):
- Empty state: "No reminders yet. Tap + to add one."
- Each reminder tile shows:
  - **Time** (left): "HH:MM" (24-hour format, bold/large)
  - **Text & frequency** (center): 
    - Reminder text (e.g., "Blood pressure tablets")
    - Frequency label ("Once", "Daily", or "Weekly")
  - **Toggle switch:** Enable/disable the reminder (does not delete it)
  - **Delete button:** Remove the reminder

### Add/Edit Dialog

Launched when the user taps the "+" button:

**Fields:**

1. **Reminder text** (text input)
   - Label: "Reminder text"
   - Hint: "e.g. Blood pressure tablets"
   - Required field

2. **Time** (time picker)
   - Label: "Time"
   - Initial: 08:00
   - Format: HH:MM (24-hour)
   - User taps "08:00" to open Flutter's `TimePicker`

3. **Frequency** (segmented button)
   - Options: "Once", "Daily", "Weekly"
   - Default: "Daily"

4. **Week days** (dynamic, only for "Weekly")
   - Seven filter chips: "S" "M" "T" "W" "T" "F" "S"
   - Sunday through Saturday
   - Required if frequency is "Weekly"

**Actions:**
- Cancel button
- Save button (disabled until text is entered and, if weekly, at least one day is selected)

### Firestore Schema

Collection: `medicationReminders/{reminderId}`

```javascript
{
  imei: string,              // Target device
  time: string,              // "HH:MM" 24-hour format
  frequency: number,         // 1 (once) | 2 (daily) | 3 (weekly)
  text: string,              // Reminder text: "Blood pressure tablets"
  enabled: boolean,          // true by default
  week: string | null,       // "1010110" (7-digit Sun-Sat mask) — only if frequency === 3
  createdBy: string,         // User's uid
  createdAt: timestamp,
  updatedAt: timestamp
}
```

### Device Command

```
TAKEPILLS,<timeSegment>,<frequency>,<hexText>
```

TCP downlink command (Protocol section 28):

**Example sends:**

- **Once at 14:30:**
  ```
  TAKEPILLS,14:30-1-1,1,<hexText>
  ```

- **Daily at 08:00:**
  ```
  TAKEPILLS,08:00-1-2,2,<hexText>
  ```

- **Weekly (Mon, Wed, Fri) at 09:00:**
  ```
  TAKEPILLS,09:00-1-3-0110110,3,<hexText>
  ```

**Parameters breakdown:**

1. **Time segment** format: `HH:MM-<enabled>-<frequency>[-<weekMask>]`
   - `HH:MM`: Time in 24-hour format
   - `<enabled>`: `1` (on) or `0` (off) — always 1 when created, can be toggled later
   - `<frequency>`: `1` (once), `2` (daily), or `3` (weekly)
   - `<weekMask>`: 7-digit Sun→Sat on/off mask (only for frequency 3), e.g., `1010110` = Sun, Tue, Thu

2. **Frequency** (second parameter): Mirrors the frequency digit from the time segment (always `1`, `2`, or `3`)

3. **Text** (third parameter): Reminder text encoded as **UTF-16BE hex** without separators
   - Example: "daily" → `006400610069006c0079`
   - The gateway handles this encoding automatically when receiving a `set_medication_reminder` command
   - App sends plain text; gateway encodes it

### Text Encoding (Gateway Responsibility)

The app sends plain reminder text (e.g., "Blood pressure tablets"); the gateway's `textToHexUtf16()` function converts it to the device's required format:

```javascript
function textToHexUtf16(text) {
  let hex = '';
  for (const ch of String(text)) {
    hex += ch.codePointAt(0).toString(16).padStart(4, '0');
  }
  return hex;
}

// Example: "daily" → "006400610069006c0079"
```

The device stores reminders in this hex format; the app only handles plain text.

### Firestore Command Schema

When a reminder is created/updated, the app writes to the `deviceCommands` collection:

```javascript
{
  imei: string,
  type: 'set_medication_reminder',
  params: {
    time: '08:00',            // HH:MM
    frequency: 2,             // 1|2|3
    text: 'Blood pressure tablets',
    week: null,               // or "1010110" if frequency === 3
    enabled: true
  },
  status: 'pending',
  createdBy: string,
  createdAt: timestamp,
  completedAt: null
}
```

### When Settings Take Effect

- **Immediately (if device online):** Command sent via TCP downlink as soon as the user taps "Save" in the dialog
- **On reconnect (if device offline):** Command persists in `deviceCommands` queue; gateway delivers it once the device reconnects
- **Confirmation:** App shows snackbar on success or error; closes the dialog on success
- **Toggle enable/disable:** Toggling a reminder's switch sends a new `set_medication_reminder` command with `enabled: false/true`; the device updates the reminder in-place
- **Delete:** Deletes the Firestore record; does **not** send a delete command to the device (device has no "delete reminder" command). Future app re-syncs may need to handle orphaned reminders on the device.

### Frequency Labels

App-side labels (used in the UI and exported via `MedicationReminder.frequencyLabel`):

| frequency | label |
|-----------|-------|
| 1 | "Once" |
| 2 | "Daily" |
| 3 | "Weekly" |

### Example Flow

```
User taps "+" to add a reminder
  ↓
Dialog opens, user enters:
  Text: "Insulin"
  Time: 07:00
  Frequency: "Daily"
  ↓
User taps "Save"
  ↓
App calls MedicationReminderService.create(
    imei: "123456789012345",
    time: "07:00",
    frequency: 2,
    text: "Insulin",
    week: null
  )
  ↓
Service writes medicationReminders/{id} document + enqueues deviceCommands entry
  ↓
Gateway receives 'set_medication_reminder' command
  ↓
Gateway encodes text to hex-UTF16: "Insulin" → "0049006e00730075006c0069006e"
  ↓
Gateway dispatches TAKEPILLS,07:00-1-2,2,0049006e00730075006c0069006e via TCP downlink
  ↓
Device receives, stores reminder, acknowledges
  ↓
App closes dialog, re-streams updated reminder list
```

### Medication Reminders on V46/V48/V52 Only

Medication reminders are **V46/V48/V52 exclusive**:
- **V28C:** No equivalent SMS command in the vendor's documentation; feature is unavailable
- **Newer models:** Protocol support confirmed in vendor's "GPS Tracker Communication Protocol V46-V48-V52 2021-12-20" document and validated against example packet captures

---

## Setting Effective Timestamps

### Device Document Updates

When settings are successfully sent, the app updates the device document in Firestore with a cache of the request:

```javascript
// For fall detection:
devices/{imei}.fallDetection = {
  enabled: true,
  dialMonitorOnFall: false,
  sensitivityLevel: 3
}

// For location reporting:
devices/{imei}.locationReportingIntervalSeconds = 60

// For medication reminders: stored in separate collection
medicationReminders/{id} = {
  imei: "...",
  time: "08:00",
  frequency: 2,
  text: "...",
  enabled: true,
  createdAt: <timestamp>,
  updatedAt: <timestamp>
}
```

### Device Command Timestamp

Each command sent to a device is logged in the `deviceCommands` collection:

```javascript
deviceCommands/{id} = {
  imei: string,
  type: string,
  params: object,
  status: 'pending' | 'sending' | 'sent' | 'failed',
  createdAt: <timestamp when app sent the request>,
  completedAt: <timestamp when gateway ACK'd delivery or failed>,
  result: { text, channel, result }
}
```

### When "Effective" Means What

1. **App saves to Firestore** (`createdAt`): The request is recorded
2. **Gateway picks up command** (moments later): Begins TCP delivery attempt
3. **Device receives and ACKs** (`completedAt`): Gateway sets `status: 'sent'`
4. **Device applies setting:** Next time the device processes packets, it applies the new config

**Latency:** If the device is online, settings usually take effect within **1–3 seconds**. If offline, they apply as soon as the device reconnects (which may be hours or days later).

### No "Read-Back" Confirmation

There is **no** device command to read back what settings are currently active on the pendant. The app can only remember what it last **asked** the device to do (cached in Firestore). If a setting fails to transmit or the device resets, the app's cached value and the device's actual state can drift. QA should verify settings by:
- Observing pendant behavior (fall detection triggering, location updates arriving at the interval set)
- Checking Firestore `deviceCommands` status logs
- Comparing against the last known request in `devices/{imei}` cache fields

---

## Error Handling & Offline Scenarios

### Device Offline

- User taps "Save"
- App attempts to send command
- Gateway has no active TCP session for the device
- App shows snackbar: **"Could not reach pendant"**
- **Command is NOT queued** — the app discards the request
- User must retry once the device is back online

**Current behavior:** TCP-downlink-only commands (fall detection, location reporting, medication reminders) fail immediately if the device isn't connected. There is no persistent queue; the user must manually re-save settings after the device reconnects.

### Medication Reminder Sync Gap

If a reminder is added while the device is offline:
1. Reminder is written to Firestore (`medicationReminders` collection)
2. Command is queued to `deviceCommands` with `status: 'pending'`
3. Gateway picks it up once the device reconnects
4. App's reminder list shows the reminder immediately (from Firestore stream)
5. Device receives the command and stores the reminder

**Potential issue:** If the device resets before receiving the reminder command, the device will not have that reminder but the app's Firestore record persists. This is not currently handled; it's a known gap (see CLAUDE.md notes on family invites and feature gaps).

---

## UI State & Validation

### Fall Detection

- **Toggle:** Enables/disables the feature
- **Sensitivity slider:** Only visible when fall detection is enabled
- **Auto-dial switch:** Only visible when fall detection is enabled
- **Save button:** Disabled if `_savingFall` is true (while a request is in flight)

### Location Updates

- **Segmented button:** One of four presets must always be selected
- **Save button:** Disabled if `_savingInterval` is true

### Medication Reminders

- **Add dialog text field:** Required (validation on save)
- **Time picker:** Defaults to 08:00, user can change
- **Frequency segment:** Defaults to "Daily"
- **Week days:** Only appear when frequency is "Weekly"; at least one must be selected if using weekly
- **Save button in dialog:** Disabled until:
  - Reminder text is not empty
  - If weekly: at least one day is selected
- **List:** Streams from Firestore; shows loading spinner until data arrives

---

## Testing Checklist

### Fall Detection

- [ ] Toggle fall detection on/off; verify snackbar feedback
- [ ] Adjust sensitivity slider; verify "0/6" through "6/6" display correctly
- [ ] Enable auto-dial; toggle it on/off; verify UI updates
- [ ] Tap "Save"; if device is online, check `deviceCommands` log in Firestore for `set_fall_detection` + `set_fall_sensitivity` entries
- [ ] Verify `devices/{imei}.fallDetection` cache is updated
- [ ] Test with device offline; confirm "Could not reach pendant" error

### Location Updates

- [ ] Tap each preset (30s, 1m, 2m, 5m); verify selection updates
- [ ] Tap "Save"; if device is online, check Firestore for `set_upload_interval` command
- [ ] Verify `devices/{imei}.locationReportingIntervalSeconds` is cached
- [ ] Once saved, monitor the device's location update frequency in the app's map view
- [ ] Test with device offline; confirm error

### Medication Reminders

- [ ] Tap "+" to open add dialog
- [ ] Enter reminder text; set time to 14:30; select "Once"
- [ ] Tap "Save"; if device is online, verify `medicationReminders/{id}` is created and `deviceCommands` entry is logged
- [ ] Verify reminder appears in the list with correct time, text, and frequency label
- [ ] Toggle reminder on/off; verify enabled field updates and a new command is sent
- [ ] Tap delete; verify reminder is removed from list and Firestore
- [ ] Test daily reminders (set for tomorrow; verify command format)
- [ ] Test weekly reminders: select Mon, Wed, Fri; verify week mask is "0110110" in the command
- [ ] Test with device offline; confirm error and that reminder still appears in Firestore (partial success)

---

## API Reference (Dart Services)

### DeviceService

```dart
Future<void> updateFallDetectionPrefs(
  String imei, {
  required bool enabled,
  required bool dialMonitorOnFall,
  required int sensitivityLevel,
})
```

Sends `set_fall_detection` and `set_fall_sensitivity` commands.

```dart
Future<void> updateLocationReportingInterval(
  String imei, {
  required int seconds,
})
```

Sends `set_upload_interval` command.

### MedicationReminderService

```dart
Stream<List<MedicationReminder>> watchForDevice(String imei)
```

Real-time stream of reminders for a device.

```dart
Future<void> create({
  required String imei,
  required String time,
  required int frequency,
  required String text,
  String? week,
})
```

Creates a reminder and enqueues the device command.

```dart
Future<void> setEnabled(MedicationReminder reminder, bool enabled)
```

Toggles a reminder on/off and sends an update command.

```dart
Future<void> delete(String reminderId)
```

Deletes a reminder from Firestore. Does not send a device delete command (device has no such command).

---

## Known Limitations & Future Work

1. **No setting readback:** The app caches the last request but cannot confirm device state. If a device resets or loses power between setting saves, the app's cache and device state can drift.

2. **No persistent queue for offline devices:** If the device is offline when settings are saved, the request is discarded immediately. Users must manually re-save after the device reconnects.

3. **No medication reminder sync recovery:** If a device loses a reminder that was sent to it, there is no automatic re-sync. App and device can drift.

4. **Limited protocol support:** V46/V48/V52 only. V28C users cannot access fall detection, custom location intervals, or medication reminders.

5. **Unverified commands:** The `voice_monitor` (monitor phone call) and `ring_to_find` commands are borrowed from third-party documentation for a related but different hardware model (RF-V28). They are flagged unverified in code comments and in the app UI.

6. **Text encoding:** All reminder text is encoded as UTF-16BE hex by the gateway. Very long text or special Unicode characters may fail; no length validation is currently enforced.

7. **Week mask validation:** The app allows selecting 0–7 days for a weekly reminder. Selecting 0 days is prevented by UI validation, but selecting all 7 is effectively a "daily" reminder and is not optimized to use frequency 2.

---

## See Also

- [SCHEMA.md](../../firestore/SCHEMA.md) — Firestore data model (devices, medicationReminders, deviceCommands)
- [gateway/src/commands.js](../../gateway/src/commands.js) — Device command builders and TCP dispatch
- [gateway/src/downlink.js](../../gateway/src/downlink.js) — TCP downlink delivery
- [apps/mobile/lib/services/guardian_services.dart](../../apps/mobile/lib/services/guardian_services.dart) — DeviceService and related Firestore access
- V46/V48/V52 Protocol Doc — `docs/reference/` (vendor PDF, in the repo under reference/)
- [CareSettingsPage source](../../apps/mobile/lib/screens/care_settings_page.dart)
