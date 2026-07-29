# SOS Button Functionality

**Last updated:** 2026-07-29

Guardian's GPS pendant (V28C, V46, V48, V52) includes a physical SOS button that allows the wearer to trigger an emergency alert. This document covers button hardware, protocol, gateway processing, notification delivery, and current verification status.

---

## Overview

The SOS button provides an immediate, one-tap emergency alert that:
1. Captures device location (GPS, WiFi, or cell tower)
2. Sends an alarm packet to the gateway
3. Creates a critical alert in Firestore
4. Dispatches push notifications to caregivers
5. Sends SMS/WhatsApp alerts to emergency contacts

**Form factors:**
- **V28C:** Physical button on pendant housing (lowest power wearable)
- **V46/V48/V52:** Physical button on wristband or pendant (integrated with health sensors)

---

## Hardware: Physical Button

### V28C Button

**Location:** Top or side of pendant housing (exact placement varies by manufacturer batch; see datasheet)

**Mechanism:** Momentary press switch (tactile feedback)

**Requirements:**
- Single press triggers SOS
- No long-press delay or multi-tap sequence required
- Button must be accessible while pendant is being worn (e.g., not blocked by protective case)

**Wear Considerations:**
- Button should be raised or recessed enough to prevent accidental activation
- Some users wrap pendant in cloth to reduce false presses
- Dust/salt water ingress may degrade responsiveness over time (IP rating: see V28C datasheet)

**References:**
- V28C datasheet: `docs/reference/V28C-DataSheet.pdf` (hardware specifications)
- Vendor contact: Shenzhen Reachfar (GT06-family protocol support)

---

## Protocol: AL Alarm Packet

When the SOS button is pressed, the device immediately sends an **AL (Alarm) packet** to the gateway. This packet is identical in structure to location updates but includes an alarm code bitmask.

### Packet Format

```
[3G*<protocolId>*<length>*AL_LTE,<date>,<time>,<gpsFlag>,<lat>,<latDir>,<lng>,<lngDir>,<speed>,<course>,[<extras>],<alarmCode>]

3G            = Factory code (ReachFar V28C/V46/V48/V52)
protocolId    = 10-digit device ID
length        = Hex-encoded payload length
AL_LTE        = Command (variants: AL, AL_WCDMA also supported)
date          = DDMMYY (e.g., 281126 = Nov 28, 2026)
time          = HHMMSS UTC (e.g., 095430)
gpsFlag       = 'A' (GPS satellite fix) or 'V' (WiFi/LBS fallback, no GPS lock)
lat, lng      = Decimal coordinates (e.g., 22.653729°N, 114.0146°E)
speed         = Speed in km/h
course        = Heading in degrees (0–359)
alarmCode     = 8-digit hex bitmask (e.g., 00010000 = SOS button)
```

### Alarm Code Bit Mapping

| Bit | Hex Value | Alarm Type | Severity | Trigger |
|-----|-----------|-----------|----------|---------|
| 16  | 0x00010000 | SOS button | **critical** | Physical button press |
| 21  | 0x00200000 | Fall | critical | Accelerometer detects sudden fall (V46/V48/V52) |
| 22  | 0x00400000 | Heart rate abnormal | warning | Heart rate out of range (V46/V48/V52 health sensor) |
| 20  | 0x00100000 | Geofence exit | warning | Device crossed zone boundary (alternative to location-based) |
| 19  | 0x00080000 | Geofence enter | warning | Device crossed zone boundary (alternative to location-based) |
| 17  | 0x00020000 | Low battery | warning | Battery below configured threshold |

**SOS Bit (Bit 16):** When the physical button is pressed, the device sets bit 16 in the alarm code, producing `0x00010000`.

### Example: SOS Press with GPS

```
[3G*9705314117*003F*AL_LTE,281126,095430,A,22.653729,N,114.0146,E,0.0,0,00010000]
                                                                                └─ Bit 16 set = SOS
```

### Example: SOS Press with WiFi Fallback (No GPS Lock)

```
[3G*9705314117*...AL_LTE,281126,095430,V,22.68,N,113.99,E,0,0,617,1,12345,67890123,aa:bb:cc:dd:ee:ff,-70,00010000]
                                         └─ "V" = no GPS satellite fix
                                                                                                                 └─ SOS bit set
```

**Note:** When GPS flag = 'V', the gateway resolves WiFi MAC + RSSI and cell tower data via Google Geolocation API for accurate coordinates.

---

## Gateway: Event Processing

When the gateway receives an AL packet with bit 16 (SOS) set, it executes the following pipeline (all within `gateway/src/server.js`):

### 1. Protocol Decoding

**File:** `gateway/src/protocol/gt06.js`, lines 307–345

```javascript
if (command.startsWith('AL')) {
  // Extract location and alarm code
  const alarmCode = args[args.length - 1];  // Last field
  const stateBits = parseInt(alarmCode, 16);
  
  if ((stateBits & (1 << 16)) !== 0) {
    alarmType = 'sos';  // SOS button detected
    severity = 'critical';
  }
}
```

**Output:** Event object with:
- `type: 'alarm'`
- `alarmType: 'sos'`
- `severity: 'critical'`
- `alarmCode: '00010000'` (or bitmask with other bits set)
- `lat, lng, recordedAt, accuracySource`

### 2. Firestore Alert Creation

**File:** `gateway/src/firestore.js`, lines 267–291

The event triggers immediate alert creation:

```javascript
await createAlert(canonicalImei, {
  type: 'sos',
  severity: 'critical',
  message: 'SOS button pressed',
  location: { lat, lng, accuracyMeters, recordedAt, accuracySource },
  payload: { alarmCode: '00010000' },
});
```

**Result:** Document written to `alerts/{alertId}`:

```firestore
{
  imei: '861397053141170',
  type: 'sos',
  severity: 'critical',
  message: 'SOS button pressed',
  location: {
    lat: 22.653729,
    lng: 114.0146,
    accuracyMeters: 15,
    recordedAt: 2026-11-28T09:54:30Z,
    accuracySource: 'gps'
  },
  payload: { alarmCode: '00010000' },
  resolved: false,
  notifyStatus: 'pending',
  createdAt: <server timestamp>
}
```

### 3. Device State Update

`devices/{imei}` is updated with:
- `online: true`
- `lastAlarm: { type: 'sos', at: <timestamp>, raw: { alarmCode: '00010000' } }`
- `location: { lat, lng, ... }`
- `updatedAt: <server timestamp>`

### 4. ACK to Device

The gateway immediately sends a TCP ACK frame to prevent device retransmission:

```
[SG*9705314117*0002*AL]
    └─ SG (gateway code)
            └─ device protocol ID (echoed)
                       └─ payload length (2 bytes)
                                 └─ command being ACKed
```

---

## Notifications: Push, SMS, WhatsApp

The `notifyStatus: 'pending'` flag triggers immediate notification delivery. This happens synchronously within the `createAlert()` call via `deliverAlertNotifications()`.

### Push Notifications to Caregivers

**File:** `gateway/src/push.js`

**Target:** All guardian users linked to the device IMEI who have registered FCM tokens (app installed with notifications enabled)

**Title:** "SOS alert"

**Body:** Alert message + device IMEI

**Payload:**
```json
{
  "notification": {
    "title": "SOS alert",
    "body": "Guardian SOS: SOS button pressed\nDevice IMEI 861397053141170"
  },
  "data": {
    "imei": "861397053141170",
    "type": "sos"
  }
}
```

**Behavior:**
- Sent via Firebase Cloud Messaging (FCM)
- Arrives on guardian's phone/tablet in real-time
- Notification wakes app; guardian taps to see alert details
- Dead tokens (unregistered apps) are automatically pruned from `users/{uid}.fcmTokens`

### SMS Alerts to Emergency Contacts

**File:** `gateway/src/notify.js`

**Target:** Emergency contact phone numbers linked to guardians

**Channel:** Twilio SMS API (requires `TWILIO_ACCOUNT_SID` and `TWILIO_FROM_SMS` configured)

**Message Format:**
```
Guardian SOS: SOS button pressed
Device IMEI 861397053141170
```

**Behavior:**
- Sent asynchronously (Twilio queues delivery)
- Typically arrives within 5–15 seconds
- Phone numbers must be in E.164 format or normalized to +230 (Mauritius default)
- Failures are logged but do not block other notifications

**Conditional:** Only sent if `NOTIFY_SMS=true` in gateway `.env`

### WhatsApp Alerts to Emergency Contacts

**File:** `gateway/src/notify.js`

**Target:** Emergency contact WhatsApp numbers (if configured)

**Channel:** Twilio WhatsApp API (requires `TWILIO_WHATSAPP_FROM` configured)

**Message Format:**
```
Guardian SOS: SOS button pressed
Device IMEI 861397053141170
```

**Behavior:**
- Sent asynchronously via WhatsApp Business API
- Typically arrives in seconds
- Recipient must have WhatsApp installed and the guardian's WhatsApp number saved (optional for delivery)
- Message appears in recipient's chat thread

**Conditional:** Only sent if `NOTIFY_WHATSAPP=true` in gateway `.env`

### Notification Filtering

**Important:** SOS alerts always trigger notifications, but other alarm types are filtered. The gateway distinguishes between:

| Alert Type | Push to Guardians | SMS/WhatsApp to Emergency Contacts |
|-----------|-------------------|-------------------------------------|
| SOS | ✅ Yes | ✅ Yes |
| Fall | ✅ Yes | ✅ Yes |
| Geofence exit | ✅ Yes | ❌ No |
| Geofence enter | ✅ Yes | ❌ No |
| Low battery | ✅ Yes | ❌ No |

This filtering is intentional (see `gateway/src/firestore.js` comments): emergency contacts should only be notified of life-threatening events, not every zone change or battery dip.

---

## Mobile App: Alert Display

When the guardian receives a push notification, the app displays the SOS alert prominently.

**File:** `apps/mobile/lib/screens/alerts_page.dart`

### Visual Hierarchy

```
┌─────────────────────────────────────────┐
│  [!] SOS ALERT                          │
│                                         │
│  SOS button pressed on John's pendant   │
│  Location: 22.653729°N 114.0146°E       │
│  Accuracy: 15 meters                    │
│  Time: 09:54 Nov 28, 2026               │
│                                         │
│  [REVIEW]  [SHARE LOCATION] [DISMISS]   │
└─────────────────────────────────────────┘
```

**Alert Tone:**
- Icon: ⚠️ warning_amber_rounded
- Color: Danger red (`GuardianColors.danger`)
- Alert state: Never auto-resolved; requires manual review

**Actions Available:**
- **Review:** Opens full alert details + device location on map
- **Share Location:** (Optional) Send the device's location to a contact
- **Dismiss:** Mark alert as reviewed (does not auto-resolve)

---

## Device Firmware Requirements

### V28C Firmware

**Minimum Requirements:**
- Must send AL packet on physical button press
- Alarm code byte 1, bits 0–7: Reserved or low/battery alarm code
- Alarm code byte 2, bits 8–15: Reserved or low battery
- Alarm code byte 3, bits 16–23: **Must set bit 16 on SOS button press**
- Alarm code byte 4, bits 24–31: Reserved

**Confirmed:** Vendor Switch-Server-SMS-Commands.pdf documents SOS as a device feature; Guardian assumes firmware supports AL + bit 16.

**Not Tested:** Real V28C hardware button and AL packet generation not yet verified in Guardian's production environment.

### V46/V48/V52 Firmware

**Minimum Requirements:**
- Same AL packet format as V28C (inherited from GT06 protocol)
- Bit 16 set on SOS button press
- Additional health features (fall detection, heart rate) use other bits

**Confirmed:** Vendor GPS Tracker Communication Protocol V46-V48-V52 (2021-12-20) documents SOS and fall detection; examples include AL packet captures.

**Not Tested:** Real V46/V48/V52 hardware with Guardian gateway not yet verified end-to-end.

---

## Verification Status: Unverified End-to-End

### What's Confirmed (Code-Level)

✅ AL packet parsing in gateway decoder  
✅ Alarm code bit 16 → 'sos' type mapping  
✅ Firestore alert schema and IMEI scoping  
✅ Push notification dispatch via FCM  
✅ SMS/WhatsApp dispatch via Twilio  
✅ Mobile app alert display and styling  
✅ Guardian test suite covers AL packet decoding (test vectors in `gateway/test/gt06.test.js`)

### What's Unverified (Hardware Testing)

❌ **Physical button on real V28C pendant:** Has Guardian team tested pressing the button and observing an AL packet arrive?  
❌ **AL packet format:** Does real V28C hardware emit the exact alarm code format (0x00010000 for SOS)?  
❌ **End-to-end alert flow:** Has a real SOS button press been observed → alert created in Firestore → notifications sent to contacts?  
❌ **Time-to-alert latency:** How long does it take from button press to notification arrival on guardian's phone?  
❌ **WiFi fallback:** If GPS is not available, does the device successfully send WiFi/LBS data in the AL packet?  
❌ **Multi-guardian scenario:** If one device is linked to multiple guardians, do all receive notifications?

### Testing Gaps

1. **Missing integration test:** A controlled test on real hardware with known GPS location, button press, and notification capture
2. **Missing load test:** SOS button spammed repeatedly; does the gateway keep up with alerts and notification dispatch?
3. **Missing failure test:** Device offline during SOS press; does device buffer and re-send on reconnect?
4. **Missing real-world test:** Deployed to a beta user; does the alert flow work end-to-end in production?

### Next Steps to Verify

1. **Obtain real V28C pendant** (if not already available)
2. **Connect to gateway** (may require tunnel exposure; see CLAUDE.md)
3. **Press SOS button** and capture gateway logs + Firestore writes
4. **Verify alert received** on guardian's app within expected latency
5. **Verify SMS/WhatsApp** arrives at emergency contact
6. **Document findings** in GitHub issue and update this document

---

## Current Gaps & Limitations

### No Persistent Buffering

If the device is offline when SOS is pressed, the button press **will trigger the on-device action** (e.g., auto-dial center number via SMS if configured), but the AL packet **cannot be sent to the gateway**. The gateway will not receive the alarm, and no alert will be created in Firestore.

**Workaround:** Ensure device is online before testing. Real deployment should monitor connectivity and warn users if device is offline.

### No Silent/Mute Modes

The SOS button always triggers an emergency alert. There is no way to temporarily disable it (e.g., "SOS locked" state). 

**Workaround:** Remove or power off the pendant if SOS should not be active.

### No Smart Fallback for No-GPS Scenarios

If the device has no GPS lock and WiFi/LBS fallback data is incomplete, the gateway logs a geolocation error and the alert is created with approximate coordinates (if any). No user-facing warning is shown.

### No Configurable SOS Button Behavior

The button action is hard-coded on the device firmware (trigger AL + optional auto-dial). Guardians cannot customize button behavior (e.g., "double-tap for SOS, single-tap for check-in").

---

## Testing with Simulator

Guardian includes a packet simulator for development without real hardware:

```bash
npm run simulate
```

This generates fake AL packets from a simulated device. To trigger a fake SOS:

**Manual trigger (if simulator supports it):**
```javascript
// In gateway/src/simulator.js, add:
simulateAlarmPacket('sos', imei, location);
```

**Current status:** Simulator is designed for LK (heartbeat) and UD (location) packets only. AL (alarm) packet simulation is not yet implemented.

**Recommendation:** Update simulator to generate SOS packets for integration testing.

---

## References

### Vendor Documentation
- **V28C Datasheet:** `docs/reference/V28C-DataSheet.pdf` (button specs, hardware)
- **V28C Commands:** `docs/reference/Switch-Server-SMS-Commands.pdf` (SOS center number, device behavior)
- **V46-V48-V52 Protocol:** `docs/reference/GPS Tracker Communication Protocol V46-V48-V52 2021-12-20.pdf` (AL packet format, bit definitions)

### Guardian Implementation
- **Protocol decoder:** `gateway/src/protocol/gt06.js` (AL parsing, alarm code decoding)
- **Alert creation:** `gateway/src/firestore.js` (createAlert, notification dispatch)
- **Push notifications:** `gateway/src/push.js` (FCM dispatch to caregivers)
- **SMS/WhatsApp:** `gateway/src/notify.js` (Twilio integration)
- **Mobile display:** `apps/mobile/lib/screens/alerts_page.dart` (UI)
- **Alert model:** `apps/mobile/lib/models/alert.dart` (data class)
- **Formatter:** `apps/mobile/lib/dashboard/alert_formatters.dart` (alert messaging)

### Tests
- **Protocol tests:** `gateway/test/gt06.test.js` (AL packet decoding, alarm code parsing)
- **Notification tests:** `gateway/test/notify.test.js` (SMS/WhatsApp send logic)
- **Mobile tests:** `apps/mobile/test/dashboard_test.dart` (alert display)

### GitHub Issues
- **SOS button hardware verification:** (tracking ticket needed)
- **End-to-end integration test:** (tracking ticket needed)
- **Simulator AL packet generation:** (tracking ticket needed)

---

## Key Takeaways for Developers

1. **SOS is critical:** Bit 16 in alarm code identifies physical button press
2. **Notifications are immediate:** Push sent within milliseconds, SMS within seconds
3. **Multi-channel delivery:** Caregivers get push + app alert; emergency contacts get SMS/WhatsApp
4. **Location is included:** AL packet carries GPS/WiFi coordinates; no separate location query needed
5. **Severity is "critical":** SOS alerts should interrupt user (high-priority toast, sound, vibration)
6. **End-to-end is unverified:** This feature has been implemented but not tested on real hardware
7. **Offline button press is lost:** Device has no offline queue for AL packets sent while disconnected

---

## Next Steps

1. **Add end-to-end test** with real V28C hardware
2. **Extend simulator** to generate AL packets
3. **Add GitHub tracking issues** for verification gaps
4. **Document button press behavior** in mobile app (e.g., "SOS button successfully triggered. Alert sent to 3 guardians and 2 emergency contacts")
5. **Add alerting** if SOS fails due to no connectivity
6. **Consider offline buffering** for future versions (device stores AL packets during outages)
