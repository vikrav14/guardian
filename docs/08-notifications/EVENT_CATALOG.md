# Notification Event Catalog

Complete reference for all notification event types in Guardian. Each event describes its trigger conditions, recipients, message content, and which channels deliver notifications.

## Event Types

### geofence_enter

**Type:** `geofence_enter`

**Trigger Conditions:**
- Device location enters a guardian-configured safe zone (geofence)
- Safe zones are evaluated by:
  - GPS distance to geofence center (within configured radius in meters, default 150m)
  - WiFi SSID match (if geofence has a `wifiSsid` configured and device reports matching SSID)
- Transitions from outside to inside trigger the event (first location sample is seeded only, does not alert)
- Cooldown: 60 seconds per geofence to prevent alert flapping

**Recipients:**
- All guardian users who have linked the device's IMEI in `linkedImeis`
- Only guardians with active FCM tokens (app installed + notifications enabled)

**Message Content:**
- **Push Title:** "Entered safe zone"
- **Push Body:** "Entered safe zone: {geofence_name}"
- **Data Payload:**
  ```
  {
    imei: device IMEI,
    type: "geofence_enter",
    geofenceId: Firestore ID of the safe zone,
    geofenceName: User-configured name of the safe zone,
    distanceMeters: GPS distance to center (rounded),
    viaWifi: Boolean — true if triggered by WiFi SSID match,
    source: "gateway"
  }
  ```

**Notifications Sent:**
- ✅ Push notification to guardians (via FCM)
- ❌ SMS/WhatsApp to emergency contacts (not sent for entry events)

**Severity:** `info`

---

### geofence_exit

**Type:** `geofence_exit`

**Trigger Conditions:**
- Device location exits a guardian-configured safe zone (geofence)
- Transitions from inside to outside trigger the event (first location sample is seeded only)
- Cooldown: 60 seconds per geofence to prevent alert flapping
- Evaluated on every location update (UD, UD_LTE, UD_WCDMA commands from pendant)

**Recipients:**
- All guardian users who have linked the device's IMEI
- For SMS/WhatsApp: all emergency contacts registered on linked guardian accounts

**Message Content:**
- **Push Title:** "Left safe zone"
- **Push Body:** "Left safe zone: {geofence_name}"
- **SMS/WhatsApp Text:**
  ```
  Guardian GEOFENCE_EXIT: Left safe zone: {geofence_name}
  Device IMEI {imei}
  ```
- **Data Payload:**
  ```
  {
    imei: device IMEI,
    type: "geofence_exit",
    geofenceId: Firestore ID of the safe zone,
    geofenceName: User-configured name of the safe zone,
    distanceMeters: GPS distance to center (rounded),
    viaWifi: Boolean — true if triggered by WiFi SSID match,
    source: "gateway"
  }
  ```

**Notifications Sent:**
- ✅ Push notification to guardians (via FCM)
- ✅ SMS/WhatsApp to emergency contacts (one message per contact per event)

**Severity:** `warning`

**Notes:**
- WiFi SSID geofence matching: currently not functional in production. The GT06 protocol decoder (`gateway/src/protocol/gt06.js`) does not extract WiFi SSID from pendant packets because the vendor's protocol documentation (`docs/reference/`) does not document that packet layout. GPS distance matching is the only working trigger today.

---

### fall

**Type:** `fall`

**Trigger Conditions:**
- Pendant sends AL (alarm) command with bit 21 set in the alarm state field
- Indicates pendant has detected a possible fall event
- Binary representation: `alarmCode & (1 << 21) !== 0`
- Example alarm codes: 0x200000 (bit 21 only)

**Recipients:**
- All guardian users who have linked the device's IMEI
- For SMS/WhatsApp: all emergency contacts registered on linked guardian accounts

**Message Content:**
- **Push Title:** "Possible fall detected"
- **Push Body:** "Device {imei}"
- **SMS/WhatsApp Text:**
  ```
  Guardian FALL: Possible fall detected
  Device IMEI {imei}
  ```
- **Data Payload:**
  ```
  {
    imei: device IMEI,
    type: "fall",
    alarmType: "fall",
    alarmCode: Hex code from pendant,
    severity: "critical",
    location: { lat, lng, recordedAt, ... },  // if GPS was valid
    speedKmh: Device speed at time of alarm (if available),
    course: Compass heading in degrees (if available)
  }
  ```

**Notifications Sent:**
- ✅ Push notification to guardians (via FCM)
- ✅ SMS/WhatsApp to emergency contacts (urgent alert)

**Severity:** `critical`

**Notes:**
- **Vendor documentation discrepancy:** The V28C protocol doc and V46-V48-V52 protocol doc state bit 22 = fall, but the V46-V48-V52 example doc's appendix says bit 21 = fall. Guardian uses bit 21 because it is already working in production.
- Fall detection accuracy depends on pendant sensor calibration and user context (may trigger on rapid movements, impacts, or actual falls).

---

### sos

**Type:** `sos`

**Trigger Conditions:**
- Pendant sends AL (alarm) command with bit 16 set in the alarm state field
- Indicates user pressed the SOS button or activated emergency response
- Binary representation: `alarmCode & (1 << 16) !== 0`
- Example alarm codes: 0x10000 (bit 16 only)

**Recipients:**
- All guardian users who have linked the device's IMEI
- For SMS/WhatsApp: all emergency contacts registered on linked guardian accounts

**Message Content:**
- **Push Title:** "SOS alert"
- **Push Body:** "Device {imei}"
- **SMS/WhatsApp Text:**
  ```
  Guardian SOS: SOS alert
  Device IMEI {imei}
  ```
- **Data Payload:**
  ```
  {
    imei: device IMEI,
    type: "sos",
    alarmType: "sos",
    alarmCode: Hex code from pendant,
    severity: "critical",
    location: { lat, lng, recordedAt, ... },  // if GPS was valid
    speedKmh: Device speed at time of alarm (if available),
    course: Compass heading in degrees (if available)
  }
  ```

**Notifications Sent:**
- ✅ Push notification to guardians (via FCM)
- ✅ SMS/WhatsApp to emergency contacts (urgent alert)

**Severity:** `critical`

**Notes:**
- Highest priority event; should trigger immediate guardian response
- Can be triggered by user pressing the SOS button on the pendant or through app command (`SOS1`, `SOS2`, `SOS3`)
- Location data at time of SOS is included if GPS fix was valid

---

### low_battery

**Type:** `low_battery`

**Trigger Conditions:**
- Pendant sends AL (alarm) command with bit 17 set in the alarm state field
- Indicates device battery level has fallen below critical threshold (device-configured, typically <10%)
- Binary representation: `alarmCode & (1 << 17) !== 0`
- Example alarm codes: 0x20000 (bit 17 only)

**Recipients:**
- All guardian users who have linked the device's IMEI
- Emergency contacts do not receive SMS/WhatsApp for this event (non-urgent)

**Message Content:**
- **Push Title:** "Pendant battery low"
- **Push Body:** "Device {imei}"
- **Data Payload:**
  ```
  {
    imei: device IMEI,
    type: "low_battery",
    alarmType: "low_battery",
    alarmCode: Hex code from pendant,
    severity: "warning",
    location: { lat, lng, recordedAt, ... },  // if GPS was valid
  }
  ```

**Notifications Sent:**
- ✅ Push notification to guardians (via FCM)
- ❌ SMS/WhatsApp to emergency contacts (informational, not urgent)

**Severity:** `warning`

**Notes:**
- Battery level is separately reported via heartbeat (`LK` command) and stored in `devices/{imei}.batteryPercent`; this alarm indicates the battery state crossed a critical threshold
- Guardian should configure charging or battery replacement
- Device may have limited operation time remaining (typically hours to 1-2 days depending on usage)

---

### offline

**Type:** `offline`

**Trigger Conditions:**
- Device has not sent a heartbeat (`LK` command or location `UD*` command) within the configured offline threshold (default: `INTELLIGENCE_OFFLINE_MINUTES`, typically 15-30 minutes)
- Evaluated by the intelligence system in `gateway/src/firestore.js` on a periodic schedule (default: `INTELLIGENCE_CHECK_INTERVAL_MS`, typically 60 seconds)
- Trigger conditions:
  1. Device `online` flag is currently true
  2. Time since last heartbeat exceeds threshold
  3. No open offline alert already exists for this device
- Once triggered, device is marked `online: false`, `connectionState: "offline"`

**Recipients:**
- All guardian users who have linked the device's IMEI
- Emergency contacts do not receive SMS/WhatsApp for this event (informational)

**Message Content:**
- **Push Title:** "Device offline" (context-dependent; see examples below)
- **Push Body:** Message varies by reason (connection loss, GPS stale, etc.)
- **SMS/WhatsApp:** Not sent for offline events
- **Data Payload:**
  ```
  {
    imei: device IMEI,
    type: "offline",
    severity: "warning" or "critical",
    title: Generated title with context,
    message: Descriptive message with minutes offline,
    payload: {
      source: "intelligence",
      facts: [ /* array of device state facts */ ],
      confidence: Confidence score (0-1),
      minutesSinceHeartbeat: Number of minutes since last contact
    }
  }
  ```

**Notifications Sent:**
- ✅ Push notification to guardians (via FCM)
- ❌ SMS/WhatsApp to emergency contacts

**Severity:** `warning` (typical) or `critical` (if offline >60 minutes)

**Examples:**
- Device in low-signal area: "Network connectivity issue — offline for 12 minutes. Last known location: Quatre Bornes, 15 min ago."
- Pending connection: If device is in `connectionState: "connecting"`, alert message notes it is attempting to reconnect.
- Stale location: If last GPS fix is older than 4 hours, message notes last known location is stale.

**Notes:**
- Offline events are created only once per device (prevented by `hasOpenOfflineAlert` check) until the device comes back online or alert is manually resolved
- Alerts can be marked `resolved: true` by guardian through the app UI
- Cooldown system avoids creating duplicate offline alerts in rapid succession
- Once device reconnects and sends heartbeat, `online` flag reverts to true and `disconnectedAt` is cleared

---

### location_stale (Not Implemented)

**Type:** `location_stale`

**Status:** ❌ **Not yet implemented**

**Proposed Trigger Conditions:**
- Device is online but has not sent a new location update within a configured threshold (proposed: `LOCATION_STALE_MINUTES`, e.g., 20-30 minutes)
- Differs from offline: device is still sending heartbeats but not location data
- Would indicate GPS/LTE positioning is not working, even though device has network connectivity

**Proposed Recipients:**
- Guardians linked to device
- Emergency contacts (SMS/WhatsApp) — TBD if urgent enough

**Proposed Severity:** `warning`

**Notes:**
- Currently no location staleness monitoring exists in the gateway
- Requires:
  1. Tracking timestamp of last valid location update separately from heartbeat
  2. Periodic check for location update staleness
  3. Alert creation logic with cooldown to prevent flapping
  4. Clear distinction from offline (device may be functional but unable to determine position)
- Candidate for future enhancement — see GitHub issues for related discussions

---

## Notification Delivery Flow

### Push Notifications (Guardian Devices)

1. Alert is created in Firestore (`collections/alerts/{alertId}`)
2. `gateway/src/firestore.js:deliverAlertNotifications()` checks if alert type is in `shouldNotify()` list
3. If alert should notify:
   - Transactional claim: mark alert as `notifyStatus: "sending"`
   - `gateway/src/push.js:notifyGuardianDevices()` queries for all users with linked IMEI
   - For each user with at least one FCM token, push via Firebase Cloud Messaging
   - Tokens that fail (not registered, invalid) are pruned from `users/{uid}.fcmTokens`
   - Alert marked as `notifyStatus: "sent"` with `notifiedAt` timestamp
4. If alert creation fails: `notifyStatus: "failed"` with `notifyError` reason

### SMS/WhatsApp to Emergency Contacts

1. Same alert processing as above
2. `gateway/src/firestore.js:deliverAlertNotifications()` checks if alert type is in `shouldSms()` list (only SOS, fall, geofence_exit)
3. If alert should SMS:
   - `gateway/src/notify.js:notifyEmergencyContacts()` queries for all emergency contacts linked to guardians who linked the device
   - For each emergency contact, sends SMS and/or WhatsApp via Twilio
   - Message format: `Guardian {TYPE}: {message}\nDevice IMEI {imei}`
   - Supports phone number normalization (Mauritius default country code +230)
   - Logs all delivery attempts (success, failure, rate limit, account misconfiguration)
4. Results always written to `collections/notificationLogs/{logId}`

### Alert Watcher (Retry Logic)

- Background listener watches `collections/alerts` for `notifyStatus: "pending"`
- Runs if alert creation was deferred (e.g., app-initiated SOS from mobile)
- Re-attempts delivery for any pending alerts every time a new alert arrives
- Prevents delivery from being permanently stuck if first attempt failed

---

## Recipient Scoping

### Guardians

- Query: `users/{uid}.linkedImeis` contains device IMEI
- FCM delivery requires: `users/{uid}.fcmTokens` is non-empty array
- Privacy enforcement: Firestore security rules in `firestore/rules.example` scope all reads through `linkedTo(imei)` check

### Emergency Contacts

- Query: For each guardian linked to device, collect `users/{guardianUid}.emergencyContacts[]`
- Each contact must have a valid `phone` field (normalized to E.164 format)
- Optional `whatsapp` field overrides phone number for WhatsApp delivery
- SMS/WhatsApp require Twilio configuration:
  - `NOTIFY_SMS=true` (enable SMS channel)
  - `NOTIFY_WHATSAPP=true` (enable WhatsApp channel)
  - `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` (credentials)
  - `TWILIO_FROM_SMS`, `TWILIO_WHATSAPP_FROM` (sender identities)

---

## Configuration

### Gateway Environment Variables

| Variable | Type | Default | Purpose |
|----------|------|---------|---------|
| `INTELLIGENCE_OFFLINE_MINUTES` | Number | 15 | Threshold for marking device offline |
| `INTELLIGENCE_CHECK_INTERVAL_MS` | Number | 60000 | How often to check device offline status |
| `INTELLIGENCE_OFFLINE_ALERT_COOLDOWN_MINUTES` | Number | 60 | Min minutes between duplicate offline alerts |
| `WRITE_LOCATION_HISTORY` | Boolean | false | Write location to `devices/{imei}/locations` subcollection |
| `NOTIFY_SMS` | Boolean | false | Enable SMS delivery to emergency contacts |
| `NOTIFY_WHATSAPP` | Boolean | false | Enable WhatsApp delivery to emergency contacts |
| `TWILIO_ACCOUNT_SID` | String | N/A | Twilio account ID (if SMS/WhatsApp enabled) |
| `TWILIO_AUTH_TOKEN` | String | N/A | Twilio auth token (if SMS/WhatsApp enabled) |
| `TWILIO_FROM_SMS` | String | N/A | SMS sender phone number (Twilio number) |
| `TWILIO_WHATSAPP_FROM` | String | N/A | WhatsApp sender ID (Twilio WhatsApp number) |

### Firestore Schema

**alerts** collection:
```javascript
{
  imei: string,                 // Device IMEI
  type: string,                 // Event type (sos, fall, geofence_exit, etc.)
  severity: string,             // critical | warning | info
  title: string,                // Short title
  message: string,              // User-facing message
  payload: object,              // Event-specific data
  resolved: boolean,            // Has guardian marked as resolved?
  resolvedAt: timestamp,        // When it was resolved
  notifyStatus: string,         // pending | sending | sent | failed | skipped
  notifiedAt: timestamp,        // When notification was delivered
  notifyError: string,          // Error reason if notifyStatus = failed
  createdAt: timestamp          // Server timestamp
}
```

**notificationLogs** collection:
```javascript
{
  imei: string,
  alertType: string,
  message: string,
  contactCount: number,         // How many emergency contacts were contacted
  results: [
    {
      name: string,
      phone: string,
      channels: {
        sms: { ok: boolean, reason?: string },
        whatsapp: { ok: boolean, reason?: string }
      }
    }
  ],
  createdAt: timestamp
}
```

---

## Testing & Simulation

### Gateway Simulator

Start the gateway in simulator mode to generate fake pendant data:

```bash
cd gateway
npm run simulate
```

This generates synthetic heartbeats, location updates, and alarm events for a demo IMEI near Quatre Bornes, Mauritius.

### Creating Alerts Manually

Via Firestore Console or SDK:
```javascript
// Create a test alert
await db.collection('alerts').add({
  imei: '868203123456789',
  type: 'geofence_exit',
  severity: 'warning',
  title: 'Left safe zone',
  message: 'Left safe zone: Home',
  payload: { geofenceId: '...', geofenceName: 'Home' },
  notifyStatus: 'pending',
  createdAt: new Date()
});
```

The alert watcher will pick up the `notifyStatus: "pending"` and deliver it.

### Testing Without Twilio

Set `NOTIFY_SMS=false` and `NOTIFY_WHATSAPP=false` to skip SMS/WhatsApp delivery. Alerts will still be created and pushed to guardians; only the emergency contact SMS/WhatsApp step is skipped. Delivery attempts are logged to `notificationLogs` with `reason: "NOTIFY_SMS=false"`, etc.

---

## Known Issues & Gaps

- **WiFi geofence matching:** Currently dead code. The pendant does not report WiFi SSID in protocol packets because the vendor docs do not document that field. GPS distance matching is the only active trigger.
- **Location staleness monitoring:** Proposed but not implemented. No way to alert if device is online but GPS/LBS positioning has stopped working.
- **Offline alert cooldown:** One offline alert per device until resolved. If alert is never marked resolved, no new offline alerts are created even if device goes offline again after reconnecting.
- **Emergency contact SMS scope:** Intentionally narrower than push notifications (SOS/fall/exit only, not enter/low_battery). This is by design but should be documented in user-facing copy.

---

## Glossary

| Term | Definition |
|------|-----------|
| **IMEI** | 15-digit International Mobile Equipment Identity — unique device ID |
| **Protocol ID** | 10-digit device ID sent in protocol packets (not the full IMEI) |
| **Geofence** | Circular safe zone with center coordinates, radius, and optional WiFi SSID |
| **Heartbeat** | `LK` command sent by pendant to confirm device is powered and connected |
| **Cooldown** | Time window during which duplicate alerts for the same trigger are suppressed |
| **FCM** | Firebase Cloud Messaging — push notification service |
| **Twilio** | SMS/WhatsApp delivery service |
| **E.164** | International phone number format: `+{countryCode}{number}` |
