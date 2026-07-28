# Guardian System Overview

**Last updated:** 2026-07-29

Guardian is a family safety platform that turns GPS tracking data into meaningful reassurance for caregivers.

## The Big Picture

```
┌──────────────────┐
│  GPS Pendant     │
│  (V52 device)    │
│  4G LTE + GPS    │
└────────┬─────────┘
         │ Raw TCP packets (GT06)
         │
    ┌────▼──────────┐
    │  Gateway      │ Node.js process
    │  (TCP server) │ • Decodes packets
    └────┬──────────┘ • Writes to Firestore
         │            • Sends device commands
         │
    ┌────▼─────────────────┐
    │  Firestore + Auth    │ Firebase
    │  (real-time backend) │ • Document store
    └────┬────────┬────────┘ • Authentication
         │        │           • Cloud Messaging
         │        │
    ┌────▼──┐ ┌──▼─────────────┐
    │ App   │ │ Notifications   │
    │Flutter│ │ • Push (FCM)    │
    │       │ │ • SMS (Twilio)  │
    └───────┘ │ • WhatsApp      │
              └─────────────────┘
```

## Core Responsibilities

### GPS Pendant (V52)
- Sends location every 30–3600 seconds (configurable via `UPLOAD` command)
- Sends battery level, signal strength
- Reports alarms: SOS button, fall detection, geofence triggers
- Listens for TCP downlink commands

### Gateway (Node.js)
- Runs a TCP server listening on port 9000
- Decodes GT06-format packets
- Writes device data to Firestore
- Sends device commands via TCP downlink
- Evaluates geofences and triggers alerts
- Sends notifications via FCM, SMS, WhatsApp

### Firestore (Backend)
- Stores locations, devices, safe zones, users, alerts
- Enforces security rules (users can only see linked devices)
- Serves real-time location updates to the mobile app

### Mobile App (Flutter)
- Shows caregiver a live map with device location
- Lets users link devices and configure care settings
- Displays alerts and notifications
- Manages safe zones

## Key Data Flows

### A Location Update Flow

```
1. Device sends "UD" packet: GPS lat/lng, battery, timestamp
2. Gateway receives, decodes, extracts: {imei, lat, lng, battery, ...}
3. Gateway writes to Firestore: locations/{docId} + updates devices/{imei}.lastLocation
4. Mobile app watches locations collection, updates map marker in real-time
5. Gateway evaluates geofences (user's safe zones)
   • If exit detected: creates alerts/{docId}, sends push/SMS/WhatsApp
   • If entry detected: creates alert, sends notification (optional)
```

### A Device Command Flow

```
1. User opens Care Settings, changes fall detection to "on"
2. Mobile app writes to Firestore: devices/{imei}.fallDetection = true
3. Gateway watches deviceCommands collection, builds FALLDOWN command
4. Gateway waits for device to connect, sends TCP downlink
5. Device receives, acknowledges with LK heartbeat
6. If device detects fall: sends AL alarm, gateway generates alert
```

### An Offline Flow

```
1. Device loses 4G, can't reach gateway
2. Gateway marks: devices/{imei}.online = false (based on heartbeat timeout)
3. Mobile app shows last-known-location marker
4. When device reconnects: sends buffered location data (UD2 packet)
5. Gateway writes all buffered locations to Firestore
6. Mobile app updates map with full history
```

## Device Status Model

```
┌────────────────────────────────────────┐
│        Device Status Timeline           │
├────────────────────────────────────────┤
│                                         │
│  now - 5min           now - 1hr   now  │
│      │                   │         │   │
│      ▼                   ▼         ▼   │
│  Device was online, Device is   Device │
│  but no recent     offline from  is    │
│  heartbeat         gateway's     LIVE  │
│                    perspective        │
│                                        │
│  Status: OFFLINE   Status: STALE   ONLINE
└────────────────────────────────────────┘
```

### Online
- Device has checked in within ~5 minutes
- Live GPS location available
- App shows current marker position

### Stale
- Device was online, but no recent heartbeat
- Last location is displayed but may be outdated
- User is alerted that data may be old

### Offline
- Device hasn't checked in for several hours
- Only last-known-location is shown
- Notifications may be delayed or unavailable

## Location Accuracy

Guardian distinguishes between two types of locations:

### Satellite GPS (`gpsValid: true`)
- Accurate within ~5–10 meters
- Requires clear sky view
- Takes longer to acquire indoors
- Preferred for precise tracking

### WiFi / Cellular Fallback (`gpsValid: false`)
- Approximate within ~100–400 meters
- Works indoors and in urban canyons
- Fast and power-efficient
- Used when GPS is unavailable

**App behavior:** The mobile app shows a visual indicator (green dot vs. blue dot) to communicate accuracy to the caregiver. Never assume approximate locations are precise.

## Security Model

### Access Control
- Users authenticate via Firebase Auth (email + password)
- Each user has a list of linked IMEIs: `users/{uid}.linkedImeis`
- Firestore security rules enforce: users can only read locations for linked devices

### Data Ownership
- Device data is owned by the user who linked it
- Emergency contacts can receive SMS/WhatsApp alerts but cannot see the map
- Multiple users can link the same device (shared family access)

### No Payment Enforcement
- Subscription tier exists in Firestore but is not enforced
- All features are available to all users (for now)
- Future: tiers will gate features based on `users/{uid}.subscriptionTier`

See [`05-data/SECURITY_MODEL.md`](../05-data/SECURITY_MODEL.md) for details.

## Notification Flow

Notifications go to two audiences:

### Push Notifications (FCM)
**Recipient:** Caregiver (via mobile app)  
**Events:** All alerts (geofence, fall, SOS, low battery, device offline)  
**Delivery:** ~instant

### SMS / WhatsApp
**Recipient:** Emergency contacts (configured in device settings)  
**Events:** Subset only (SOS, fall, geofence exit, low battery)  
**Delivery:** Seconds to minutes (depends on Twilio)

This distinction is intentional — emergency contacts get critical alerts only, not every location update.

## Command & Control

Device commands are sent via **TCP downlink only**. No SMS fallback.

| Command | Purpose | Requires | Verification |
|---------|---------|----------|---|
| UPLOAD | Set location reporting interval (30s–3600s) | Live TCP connection | Device echoes interval |
| FALLDOWN | Enable/disable fall detection with sensitivity | Live TCP connection | Device echoes setting |
| TAKEPILLS | Schedule medication reminders | Live TCP connection | Device echoes schedule |
| CR | Force GPS update every 30s for 3 minutes | Live TCP connection | None (best-effort) |
| FIND | Ring to locate device (audible alert) | Live TCP connection | None (best-effort) |
| monitor | Enable voice monitoring (unverified) | Live TCP connection | Unverified |

**Important:** The app cannot confirm device compliance. It caches the desired state in Firestore and assumes acceptance if the device echoes the command. If the device reboots or loses connection before echoing, the command may not take effect.

## Key Constraints

1. **Gateway is local-only** — Must be exposed (via tunnel or public IP) for real devices to connect
2. **Device commands are TCP-only** — Requires live connection; no SMS fallback
3. **Subscription tiers not enforced** — All features available to all users
4. **Location history is optional** — Gated by `WRITE_LOCATION_HISTORY` env var in gateway
5. **No read-back mechanism** — App state is inferred; device state cannot be confirmed
6. **Offline command buffering not implemented** — Commands sent while offline are lost

---

## Next Steps

- **Understand data flow:** See [DATA_FLOW.md](DATA_FLOW.md)
- **Device-to-app communication:** See [DEVICE_TO_APP_FLOW.md](DEVICE_TO_APP_FLOW.md)
- **Security details:** See [SECURITY_MODEL.md](SECURITY_MODEL.md)
- **Mobile app structure:** See [`../03-mobile/MOBILE_OVERVIEW.md`](../03-mobile/MOBILE_OVERVIEW.md)
- **Gateway internals:** See [`../04-gateway/GATEWAY_OVERVIEW.md`](../04-gateway/GATEWAY_OVERVIEW.md)
