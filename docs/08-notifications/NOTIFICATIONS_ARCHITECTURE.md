# Guardian Notifications Architecture

## Overview

Guardian uses a multi-channel notification system to alert guardians and emergency contacts about device events. Notifications flow from the gateway (where device state changes are detected) through Firestore (source of truth) to end users via:

- **Firebase Cloud Messaging (FCM)** — push notifications to guardian app devices
- **Twilio SMS** — text messages to emergency contacts
- **Twilio WhatsApp** — WhatsApp messages to emergency contacts

The system is intentionally asymmetric: guardians receive all alerts (for full situational awareness), while emergency contacts receive only the most critical events (to avoid alert fatigue and privacy considerations).

---

## Components

### Firebase Cloud Messaging (FCM)

**Purpose:** Real-time push notifications to guardian app devices.

**Location:** `gateway/src/push.js`

**Key behavior:**
- Finds all guardians linked to a device via `users/{uid}.linkedImeis`
- Collects FCM tokens from `users/{uid}.fcmTokens` (registered when app starts)
- Sends to all tokens using `admin.messaging().sendEachForMulticast()`
- Automatically prunes stale/invalid tokens that FCM reports as unregistered
- Returns summary: `{ sent, pruned, error? }`

**Configuration:**
- Requires Firebase Admin SDK initialized (FIREBASE_PROJECT_ID + service account JSON)
- No env vars control FCM behavior itself; FCM credentials come from the service account

**Example notification payload:**
```json
{
  "notification": {
    "title": "SOS alert",
    "body": "Device 861397053141170"
  },
  "data": {
    "imei": "861397053141170",
    "type": "sos"
  }
}
```

### Twilio SMS & WhatsApp

**Purpose:** Synchronous messaging to emergency contacts for critical events.

**Location:** `gateway/src/notify.js`

**Key behavior:**
- Finds all emergency contacts in `users/{uid}.emergencyContacts` for guardians linked to a device
- Normalizes phone numbers to E.164 format ("+230..." for Mauritius, "+{country}..." for others)
- Sends SMS or WhatsApp via Twilio API
- Always logs delivery attempts to `notificationLogs` collection for auditability
- Returns results per contact per channel: `{ ok: boolean, reason?: string }`

**Configuration:**
```
TWILIO_ACCOUNT_SID           # Twilio account SID
TWILIO_AUTH_TOKEN            # Twilio auth token
TWILIO_FROM_SMS              # Twilio SMS sender phone (e.g., +16175551234)
TWILIO_WHATSAPP_FROM         # Twilio WhatsApp sandbox sender (e.g., whatsapp:+14155552671)
NOTIFY_SMS=true              # Enable/disable SMS (default: true)
NOTIFY_WHATSAPP=true         # Enable/disable WhatsApp (default: true)
```

**Skipped notifications:**
- If `TWILIO_ACCOUNT_SID` or `TWILIO_AUTH_TOKEN` missing → skipped, logged as `{ skipped: true, reason: 'twilio_not_configured' }`
- If `NOTIFY_SMS=false` → SMS disabled for all alerts
- If `NOTIFY_WHATSAPP=false` → WhatsApp disabled for all alerts

**Example message:**
```
Guardian SOS: Device alarm: sos
Device IMEI 861397053141170
```

---

## Alert Types

All alerts are created in Firestore at `alerts/{alertId}` and include:
- `imei` — device IMEI
- `type` — alert classification
- `severity` — `critical`, `warning`, or `info`
- `message` — human-readable description
- `payload` — structured event data
- `createdAt` — server timestamp
- `notifyStatus` — delivery state: `pending` → `sending` → `sent` | `failed` | `skipped`

### SOS Alert

**Trigger:** User presses the pendant's SOS button.

**Source:** Hardware alarm packet (bit 16 of alarm state).

**Properties:**
- `severity: critical`
- `message: Device alarm: sos`
- Guardians: **full push notification**
- Emergency contacts: **SMS + WhatsApp** (critical event)

**Payload example:**
```json
{
  "type": "sos",
  "severity": "critical",
  "alarmType": "sos",
  "alarmCode": "0x10001",
  "lat": -20.1609,
  "lng": 57.5012,
  "gpsAccuracy": 25,
  "timestamp": 1626352800
}
```

### Fall Detection

**Trigger:** Pendant's accelerometer detects a fall.

**Source:** Hardware alarm packet (bit 21 of alarm state).

**Properties:**
- `severity: critical`
- `message: Possible fall detected`
- Guardians: **full push notification**
- Emergency contacts: **SMS + WhatsApp** (critical event)

**Payload example:**
```json
{
  "type": "fall",
  "severity": "critical",
  "alarmType": "fall",
  "alarmCode": "0x200000",
  "lat": -20.1609,
  "lng": 57.5012,
  "gpsAccuracy": 25,
  "timestamp": 1626352800
}
```

**Note:** Fall detection accuracy depends on hardware calibration and environment. False positives may occur (e.g., sudden jumps, impacts). Guardians should follow up before calling emergency services.

### Geofence Exit

**Trigger:** Device leaves a guardian-defined "safe zone."

**Source:** Gateway evaluates distance to geofence center using Haversine formula.

**Properties:**
- `severity: warning`
- `message: Left safe zone: {name}`
- Guardians: **full push notification**
- Emergency contacts: **SMS + WhatsApp** (important event)

**Payload example:**
```json
{
  "type": "geofence_exit",
  "severity": "warning",
  "geofenceId": "gf_abc123",
  "geofenceName": "Home",
  "distanceMeters": 247,
  "viaWifi": false,
  "source": "gateway"
}
```

**Cooldown:** 60 seconds per zone to prevent flapping alerts (e.g., GPS jitter causing repeated exits/re-entries).

**WiFi fences:** Zones can match by GPS distance *or* WiFi SSID association (whichever fires first for indoor accuracy). Currently, WiFi SSID extraction is not implemented in the GT06 protocol decoder (`gateway/src/protocol/gt06.js`), so only GPS matching works.

### Geofence Enter

**Trigger:** Device enters a guardian-defined "safe zone."

**Source:** Gateway evaluates distance to geofence center.

**Properties:**
- `severity: info`
- `message: Entered safe zone: {name}`
- Guardians: **full push notification**
- Emergency contacts: **not notified** (positive event, no urgency)

**Payload example:**
```json
{
  "type": "geofence_enter",
  "severity": "info",
  "geofenceId": "gf_abc123",
  "geofenceName": "School",
  "distanceMeters": 45,
  "viaWifi": false,
  "source": "gateway"
}
```

**Cooldown:** 60 seconds per zone.

### Low Battery

**Trigger:** Device battery drops below threshold (~20%).

**Source:** Hardware alarm packet (bit 17 of alarm state). The exact threshold is configured on the pendant itself, not in the gateway.

**Properties:**
- `severity: warning`
- `message: Pendant battery low`
- Guardians: **full push notification**
- Emergency contacts: **not notified** (informational, not an emergency)

**Payload example:**
```json
{
  "type": "low_battery",
  "severity": "warning",
  "alarmType": "low_battery",
  "alarmCode": "0x20000",
  "batteryPercent": 18
}
```

**Best practice:** Guardians should charge the pendant promptly. Gateway continues tracking; no functionality is disabled at low battery until device power-off.

### Offline Alert

**Trigger:** Device has not sent a location or heartbeat for `INTELLIGENCE_OFFLINE_MINUTES` (default 10 min), and the gateway's intelligence layer determines the loss is real (not a temporary carrier blip).

**Source:** `gateway/src/intelligence/index.js` based on connection state and confidence heuristics.

**Properties:**
- `severity: warning` or `critical` (based on confidence)
- `message: Device offline; ...` (includes context: "last location {time} ago", "possible low signal", etc.)
- Guardians: **full push notification**
- Emergency contacts: **not notified** (operational event, not immediate danger)

**Payload example:**
```json
{
  "type": "offline",
  "severity": "warning",
  "source": "intelligence",
  "facts": [
    "Device silent for 10 min",
    "Last known location: Home, 8 min ago",
    "Usual movement pattern: stationary during school hours"
  ],
  "confidence": 0.87
}
```

**Cooldown:** 30 minutes between offline alerts for the same device (via `INTELLIGENCE_OFFLINE_ALERT_COOLDOWN_MINUTES`).

**Reconciliation:** When a device reconnects after being marked offline, Firestore rules reconcile the state and clear the offline marker.

---

## Recipients

### Guardians

**Who:** Users linked to a device via the app (device owner or family member).

**Where:** `users/{uid}.linkedImeis` contains the device IMEI.

**Receives:** All alert types (SOS, fall, geofence_exit, geofence_enter, low_battery, offline).

**Channel:** FCM push notifications only (app must be installed with notifications enabled).

**Data visibility:** Full Firestore access to device, alerts, locations, journeys, etc. (scoped by security rules to `linkedImeis`).

### Emergency Contacts

**Who:** Phone numbers registered in a guardian's `users/{uid}.emergencyContacts` array.

**Where:** Specified per guardian, associated with a device via the linking guardian.

**Receives:** Critical events only (SOS, fall, geofence_exit).

**Channels:** SMS + WhatsApp (or both disabled if Twilio not configured).

**Data visibility:** None. Emergency contacts get a formatted message only; no app access or Firestore reads.

**Example contact:**
```json
{
  "name": "Mom",
  "phone": "+23057501200",
  "whatsapp": "+23057501200"
}
```

**Design rationale:** Emergency contacts are kept in the loop only for immediate threats to avoid alert fatigue (low-battery, geofence_enter, offline would be noise). SMS/WhatsApp ensures notifications reach recipients who may not have the Guardian app installed.

---

## Delivery Channels

### Channel Selection by Alert Type

| Alert Type | Guardians (FCM) | Emergency Contacts (SMS/WhatsApp) |
|---|---|---|
| SOS | ✓ | ✓ |
| Fall | ✓ | ✓ |
| Geofence Exit | ✓ | ✓ |
| Geofence Enter | ✓ | ✗ |
| Low Battery | ✓ | ✗ |
| Offline | ✓ | ✗ |

### FCM Push Notification Flow

1. **Event detected** (SOS, fall, geofence, low-battery, offline) → gateway calls `createAlert()`
2. **Alert created** in Firestore (`alerts` collection) with `notifyStatus: pending`
3. **Immediate delivery** via `deliverAlertNotifications()`:
   - Transaction claims the alert (sets `notifyStatus: sending`)
   - `notifyGuardianDevices()` queries all guardians linked to the IMEI
   - FCM sends to all tokens in parallel
   - Dead tokens are pruned from `users/{uid}.fcmTokens`
   - Alert status updated to `sent` or `failed`
4. **Retry watcher** (`startPendingAlertWatcher()`) catches any alerts left in `pending` state and retries delivery every ~5 seconds

**Reliability:**
- Best-effort delivery; FCM does not guarantee receipt.
- App must have registered an FCM token (happens on first app start if notifications enabled).
- Device must have network connectivity.
- Tokens expire or become stale; gateway automatically cleans them up.

### SMS/WhatsApp Delivery Flow

1. **Alert is SOS, fall, or geofence_exit** → `shouldSms(alert)` returns true
2. **Call `notifyEmergencyContacts()`**:
   - Query all emergency contacts for guardians linked to the IMEI
   - Normalize phone numbers to E.164
   - For each contact, attempt SMS and/or WhatsApp in parallel
3. **Twilio request**:
   - HTTP POST to `https://api.twilio.com/.../Messages.json`
   - Basic auth with Account SID + auth token
   - Request includes: To, From, Body
4. **Log result** to `notificationLogs/{id}`:
   - Contact name, phone, guardian UID
   - Status for each channel (sms/whatsapp)
   - OK/failed/skipped with reason

**Reliability:**
- Requires Twilio credentials configured and funded account.
- SMS/WhatsApp delivery depends on carrier/service availability.
- No built-in retry (if Twilio request fails, alert is recorded as failed).
- All attempts logged in Firestore for audit trail.

---

## Configuration

### Environment Variables

#### Firebase & Firestore

```bash
FIRESTORE_DISABLED=false              # Disable all Firestore reads/writes (default: false)
FIREBASE_PROJECT_ID=my-project        # Firebase project ID
GOOGLE_APPLICATION_CREDENTIALS=/path  # Path to service account JSON
WRITE_LOCATION_HISTORY=false          # Write device location history (default: false)
```

#### Notifications

```bash
TWILIO_ACCOUNT_SID=ACxxxxx            # Twilio account SID (required for SMS/WhatsApp)
TWILIO_AUTH_TOKEN=xxxxxx              # Twilio auth token (required for SMS/WhatsApp)
TWILIO_FROM_SMS=+16175551234          # SMS sender phone number
TWILIO_WHATSAPP_FROM=whatsapp:+1415555 # WhatsApp sender (usually Twilio sandbox)
NOTIFY_SMS=true                       # Enable SMS notifications (default: true)
NOTIFY_WHATSAPP=true                  # Enable WhatsApp notifications (default: true)
```

#### Intelligence & Offline

```bash
INTELLIGENCE_OFFLINE_MINUTES=10       # Time until offline alert (default: 10)
INTELLIGENCE_OFFLINE_ALERT_COOLDOWN_MINUTES=30  # Offline alert cooldown (default: 30)
INTELLIGENCE_CHECK_INTERVAL_MS=60000  # How often to re-evaluate offline state
TCP_IDLE_MINUTES=12                   # Close idle TCP after this (default: 12)
TCP_SILENT_SECONDS=720                # Close TCP with no packets (default: 12 min = 720 sec)
OFFLINE_DEBOUNCE_MS=15000             # Wait before marking offline (absorbs reconnect blips)
```

### Example .env

```bash
# Firebase
FIREBASE_PROJECT_ID=guardian-prod
GOOGLE_APPLICATION_CREDENTIALS=/etc/guardian/service-account.json

# Twilio
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_FROM_SMS=+16175551234
TWILIO_WHATSAPP_FROM=whatsapp:+14155552671
NOTIFY_SMS=true
NOTIFY_WHATSAPP=true

# Intelligent offline detection
INTELLIGENCE_OFFLINE_MINUTES=10
INTELLIGENCE_OFFLINE_ALERT_COOLDOWN_MINUTES=30

# TCP timeouts
TCP_IDLE_MINUTES=12
OFFLINE_DEBOUNCE_MS=15000
```

---

## Notification Flow (End-to-End)

### Scenario: Geofence Exit

```
1. Device sends location packet
   └─ Gateway receives via TCP
      └─ Parser extracts lat/lng, IMEI
         └─ Geofence evaluator: device 247m from "Home" (now outside)
            └─ createAlert() with type: 'geofence_exit'
               └─ Alert doc created in Firestore with notifyStatus: 'pending'
                  ├─ deliverAlertNotifications() starts
                  │  ├─ Query guardians linked to IMEI
                  │  │  └─ Collect FCM tokens
                  │  └─ sendEachForMulticast() → FCM
                  │     ├─ Device 1: ✓ sent
                  │     ├─ Device 2: ✓ sent
                  │     └─ Stale token pruned
                  ├─ notifyEmergencyContacts() starts
                  │  ├─ Query emergency contacts
                  │  │  └─ Mom: +23057501200 (SMS + WhatsApp)
                  │  │  └─ Dad: +23057502300 (SMS only)
                  │  ├─ sendSms(Mom) → Twilio → ✓
                  │  ├─ sendWhatsApp(Mom) → Twilio → ✓
                  │  ├─ sendSms(Dad) → Twilio → ✓
                  │  └─ notificationLogs entry created
                  └─ Alert notifyStatus: 'sent'

2. Guardian receives push: "Left safe zone: Home"
3. Emergency contacts receive SMS/WhatsApp
4. Guardian can view alert in app with full context (map, time, etc.)
```

### Scenario: Offline Alert

```
1. Device goes silent (no packet for 10+ min)
   └─ Intelligence watcher runs (every 60s)
      └─ Evaluates: connection state, last packet time, movement patterns
         └─ Confidence ≥ threshold → offline is real (not just a blip)
            └─ createAlert() with type: 'offline'
               ├─ Check: no open offline alert exists (avoid duplicates)
               └─ Alert created with confidence facts in payload
                  └─ deliverAlertNotifications()
                     └─ notifyGuardianDevices() → FCM
                        └─ Guardian sees "Device offline; last seen 12 min ago"
                           └─ Can try ping, check last location on map, etc.

2. 30-min cooldown: another offline alert won't fire until then
3. Device reconnects
   └─ TCP session established
      └─ First packet received
         └─ Device marked online
            └─ reconcileStaleOnlineFlags() clears offline marker
```

---

## Limitations & Known Issues

### Push Notifications (FCM)

1. **App must be installed** with notifications enabled; cold-start time if not running.
2. **No delivery guarantee** — FCM is best-effort; network issues or carrier filters may prevent delivery.
3. **Token staleness** — FCM tokens expire or become invalid over time; app must refresh on each start.
4. **No deep linking** — notifications don't automatically open alert detail; user taps notification → app.

### SMS/WhatsApp (Twilio)

1. **Requires Twilio account** with active subscription and sufficient balance.
2. **No delivery guarantee** — carrier delays, network issues, or filtering may prevent delivery.
3. **Carrier rate limits** — high-volume alerts to the same number may be throttled or blocked.
4. **Cost** — SMS and WhatsApp carry per-message charges (Mauritius typically $0.05–$0.15/SMS).
5. **WhatsApp sandbox** — requires contact to have interacted with the WhatsApp number first (one-way initiations are limited).

### Alert Deduplication

1. **No automatic suppression** if the same event fires multiple times (e.g., device flaps in/out of geofence). Cooldown windows prevent rapid fire, but sustained events may still send duplicate alerts.
2. **No correlation** between app-initiated SOS (user taps button in app) and hardware SOS (button on pendant); both create separate alerts.

### Offline Intelligence

1. **Delayed** — 10-minute default delay before offline alert fires (configurable but bounded by carrier packet loss patterns).
2. **Confidence-based** — heuristics may mis-classify brief disconnections as false positives or miss real offline events in unusual movement patterns.
3. **No user override** — guardian cannot manually mark device as offline or suppress offline alerts.

### WiFi Geofencing

1. **Not currently implemented** — GT06 protocol decoder (`gateway/src/protocol/gt06.js`) does not extract WiFi SSID from device packets, so zones cannot match by WiFi alone.
2. **GPS only** — geofence evaluation relies on GPS accuracy, which may be poor indoors or in urban canyons.

### Emergency Contact Coverage

1. **Requires phone number** — emergency contacts must have a valid E.164 phone number; WhatsApp requires country code.
2. **No app-only option** — emergency contacts only receive SMS/WhatsApp, not push notifications.
3. **One-directional** — emergency contacts do not have app access or Firestore visibility.

---

## Testing & Debugging

### Dry-Run Mode (Firestore Disabled)

```bash
FIRESTORE_DISABLED=true npm start
```

All alerts are logged to console instead of written to Firestore. Notifications are still attempted but logged with `[notify]` prefix. Useful for:
- Testing alert logic without Firestore costs.
- Validating geofence transitions, offline detection, etc.
- Debugging without touching production data.

### Twilio Test Credentials

Twilio provides test account SID and auth token for sandbox testing. Replace with real credentials for production SMS/WhatsApp delivery.

### Simulating Events

```bash
npm run simulate
```

Runs a fake pendant near Quatre Bornes, Mauritius, with hardcoded IMEI and fake SOS/fall/geofence events. Useful for end-to-end testing.

### Notification Logs

All SMS/WhatsApp attempts are logged to `notificationLogs` collection:
```
db.collection('notificationLogs').orderBy('createdAt', 'desc').limit(10)
```

Each entry shows:
- IMEI, alert type, message text
- Per-contact results: SMS (ok/failed/skipped), WhatsApp (ok/failed/skipped)
- Twilio response status and body (truncated)

---

## Best Practices

### For Developers

1. **Always check `shouldNotify()`** and **`shouldSms()`** before assuming an alert will trigger notifications. These lists are the source of truth.
2. **Test offline detection** with real TCP timeout behavior; do not rely on rapid disconnects to trigger offline alerts.
3. **Monitor notificationLogs** for failed SMS/WhatsApp attempts; high failure rates indicate Twilio issues.
4. **Prune stale FCM tokens** proactively; register a background task to clean up tokens older than 30 days.

### For Guardians

1. **Enable push notifications** in app settings to receive alerts immediately.
2. **Verify emergency contacts** have correct phone numbers and country codes; test SMS/WhatsApp delivery.
3. **Check battery status** regularly; low-battery alerts give ~20 min warning before shutdown.
4. **Review geofence radius** settings; too-small zones cause false exits.
5. **Test SOS button** periodically to confirm it triggers an alert.

### For Operations

1. **Monitor FCM token registration rate** — sudden drops indicate app crashes or uninstalls.
2. **Monitor Twilio balance and usage** — set alerts for low balance to avoid service interruption.
3. **Retain notificationLogs** for audit; check for patterns of failed SMS/WhatsApp.
4. **Scale Twilio account** for high-volume scenarios (e.g., school field trip with many devices).

---

## Future Enhancements

- **SMS delivery receipts** — Twilio callback to confirm SMS was delivered.
- **Email alerts** — add SendGrid or AWS SES for guardian email notifications.
- **Notification preferences** — per-guardian, per-device alert type filtering (e.g., "mute geofence_enter").
- **Quiet hours** — suppress non-critical alerts during night hours (e.g., geofence_enter).
- **In-app notification history** — query and display past alerts in app UI.
- **Real-time alert status** — WebSocket or polling to show delivery status to user.
- **Fallback retry** — if SMS fails, try email or vice versa.
- **WiFi geofencing** — decode WiFi SSID from GT06 packets and match zones by SSID.

---

## References

- **FCM Documentation:** https://firebase.google.com/docs/cloud-messaging
- **Twilio SMS API:** https://www.twilio.com/docs/sms
- **Twilio WhatsApp:** https://www.twilio.com/docs/whatsapp
- **GT06 Protocol:** `gateway/src/protocol/gt06.js`, `docs/04-gateway/GT06_PROTOCOL.md`
- **Geofence Logic:** `gateway/src/geofence.js`
- **Offline Intelligence:** `gateway/src/intelligence/index.js`
- **Source Code:**
  - Push notifications: `gateway/src/push.js`
  - SMS/WhatsApp notifications: `gateway/src/notify.js`
  - Alert creation & delivery orchestration: `gateway/src/firestore.js`
  - Configuration: `gateway/src/config.js`
