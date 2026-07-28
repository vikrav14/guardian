# Data Flow Diagrams

**Last updated:** 2026-07-29

## Location Update Flow

```
Device (V52)
    │ TCP packet: UD (location upload)
    │ Format: IMEI, lat, lng, speed, accuracy, battery, timestamp
    │
    ▼
Gateway (TCP server)
    │ Parse GT06 packet
    │ Extract: {imei, lat, lng, battery, gpsValid, timestamp}
    │
    ├─► Check WRITE_LOCATION_HISTORY env var
    │   │
    │   ├─► If TRUE: Write locations/{docId} (location history)
    │   │
    │   └─► If FALSE: Skip (don't store history, save bandwidth)
    │
    ├─► Update devices/{imei}.lastLocation (always)
    │
    ├─► Evaluate geofences
    │   │ For each safe zone:
    │   │ • Check if device is inside or outside
    │   │ • Compare to previous state
    │   │
    │   └─► If ENTERED or EXITED: Create alerts/{docId}
    │
    └─► Send notifications (if geofence triggered)
        │
        ├─► Push (FCM): To caregiver app
        │   Message: "Device exited 'Home' at 14:32"
        │
        └─► SMS/WhatsApp: To emergency contacts
            Message: "SOS: Device left home"
```

## Device Command Flow

```
Mobile App
    │ User opens Care Settings
    │ Toggles: "Fall Detection" ON
    │
    ▼
Firestore (Client-side write)
    │ Write: devices/{imei}.fallDetection = true
    │
    ▼
Gateway (watches deviceCommands collection)
    │ Sees new command request
    │ Builds TCP downlink packet: FALLDOWN,1,3
    │   (1 = enabled, 3 = sensitivity level)
    │
    ├─► Wait for device to connect (next heartbeat/location)
    │
    ├─► Send via TCP downlink
    │
    ├─► Device receives & processes
    │
    └─► Device sends LK heartbeat with echo:
        Message: "FALLDOWN:1,3"
        
Gateway (receives heartbeat)
    │ Check if echo matches requested state
    │ Update: devices/{imei}.commandStatus = "confirmed"
    │
    ▼
Mobile App (watches devices/{imei})
    │ Sees confirmtion
    │ Displays: "Fall Detection is ON"
```

## Alert Generation Flow

```
Gateway (processes any trigger)
    │
    ├─► Geofence Exit
    │   └─► Type: "geofence_exit", Severity: "warning"
    │
    ├─► Fall Detected
    │   └─► Type: "fall", Severity: "critical"
    │
    ├─► SOS Button Pressed
    │   └─► Type: "sos", Severity: "critical"
    │
    ├─► Low Battery (<20%)
    │   └─► Type: "low_battery", Severity: "warning"
    │
    └─► Device Offline (>2hrs since last heartbeat)
        └─► Type: "offline", Severity: "info"

    ▼
Write to alerts/{docId}
    {
      "imei": "869362...",
      "type": "geofence_exit",
      "severity": "warning",
      "location": {lat, lng},
      "message": "Left 'Home' safe zone",
      "createdAt": <timestamp>,
      "notificationSentAt": null
    }

    ▼
Firestore trigger → Cloud Function (or Gateway watcher)
    │
    ├─► Determine recipients
    │   ├─► Caregivers → Push (FCM)
    │   └─► Emergency contacts → SMS/WhatsApp
    │
    └─► Check shouldNotify vs shouldSms flags
        (Some alerts push to app only; others also SMS)

    ▼
┌─────────────────────────┬─────────────────────┐
│ FCM Push Notification   │ SMS/WhatsApp Alert  │
├─────────────────────────┼─────────────────────┤
│ To: Caregiver app       │ To: Emergency       │
│ Instant                 │ contact number      │
│ All alert types         │ SOS/fall/exit only  │
└─────────────────────────┴─────────────────────┘
```

## Device Status Flow

```
Device (Heartbeat every ~5 min)
    │ TCP packet: LK (keep-alive/heartbeat)
    │
    ▼
Gateway
    │ Receive & echo LK
    │ Update: devices/{imei}.lastHeartbeat = now()
    │ Update: devices/{imei}.online = true
    │
    ▼ (if 5+ minutes since last heartbeat)
    │
    └─► Mark: devices/{imei}.online = false
        devices/{imei}.offline_since = <timestamp>

    ▼
Mobile App (watches devices/{imei})
    │
    ├─► online = true
    │   Display: "Device online" (green indicator)
    │   Show live location updates
    │
    ├─► online = false (< 1hr offline)
    │   Display: "Device offline"
    │   Show last-known-location
    │   Show time since last update: "2 hours ago"
    │
    └─► online = false (> 6hrs offline)
        Display: "Device offline for 6+ hours"
        May suggest "Check device battery" or "Check signal"
```

## Data Ownership Flow

```
User (guardian@example.com) signs up
    │
    ▼
Firestore: users/{uid}
    {
      "email": "guardian@example.com",
      "linkedImeis": [],
      "subscriptionTier": "free",
      "emergencyContacts": []
    }

    ▼
User links device (via IMEI)
    │
    ▼
Firestore: users/{uid}.linkedImeis.push(869362...)

    ▼
Firestore: devices/{imei}
    {
      "imei": "869362...",
      "ownerId": "{uid}",  // Linked user
      "linkedUsers": ["{uid}"],  // Multiple caregivers possible
      "lastLocation": {lat, lng, ...},
      "batteryPercent": 85,
      "online": true,
      ...
    }

    ▼
Firestore security rules check:
    │
    └─► Can I read locations/{doc}?
        IF doc.imei in users/{uid}.linkedImeis
        THEN allow read
        ELSE deny read
```

## Offline Buffering Flow

```
Device (loses 4G connection)
    │ App tries to send: UD packet
    │ No TCP connection available
    │ Store locally: [GPS coords, battery, timestamp]
    │ Keep buffering...
    │
    ├─► After 30min: Buffer has 6 locations
    │
    ├─► After 1hr: Buffer has 12 locations
    │
    └─► Reconnects to 4G
        │
        ▼
        Send all buffered locations as UD2 packets
        
        Gateway receives UD2 (blind-spot upload)
        │ Mark each location: source = "buffered"
        │
        ▼
        Write to Firestore: locations/{docId} for each
        
        ▼
        Mobile app shows location history:
        "Device was at these 12 locations 1 hour ago"
```

## Geofence Evaluation Flow

```
Firestore: devices/{imei}
    {
      "safeZones": [
        {
          "id": "zone_home",
          "name": "Home",
          "lat": -20.1234,
          "lng": 57.5678,
          "radius": 100
        },
        {
          "id": "zone_work",
          "name": "Work",
          "lat": -20.2000,
          "lng": 57.6000,
          "radius": 200
        }
      ]
    }

Gateway (receives location)
    │ For each safe zone:
    │ • Calculate distance = haversine(device_lat/lng, zone_lat/lng)
    │ • inside = distance < radius
    │
    ▼
Compare to previous state:
    │ was_inside = devices/{imei}.safeZones[zone].inside
    │ now_inside = distance < radius
    │
    ├─► If was_inside=true, now_inside=false
    │   │ GEOFENCE EXIT
    │   ▼
    │   Create alert:
    │   {
    │     "type": "geofence_exit",
    │     "zone": "Home",
    │     "severity": "warning",
    │     "shouldNotify": true,
    │     "shouldSms": true
    │   }
    │
    ├─► If was_inside=false, now_inside=true
    │   │ GEOFENCE ENTER
    │   ▼
    │   Create alert:
    │   {
    │     "type": "geofence_enter",
    │     "zone": "Home",
    │     "severity": "info",
    │     "shouldNotify": true,
    │     "shouldSms": false  ← No SMS for entry
    │   }
    │
    └─► Else: No state change, no alert
```

---

## Related Documentation

- [SYSTEM_OVERVIEW.md](SYSTEM_OVERVIEW.md) — High-level architecture
- [DEVICE_TO_APP_FLOW.md](DEVICE_TO_APP_FLOW.md) — Real-time sync details
- [SECURITY_MODEL.md](SECURITY_MODEL.md) — Access control & data privacy
- [`../04-gateway/GATEWAY_OVERVIEW.md`](../04-gateway/GATEWAY_OVERVIEW.md) — Gateway implementation
- [`../05-data/FIRESTORE_OVERVIEW.md`](../05-data/FIRESTORE_OVERVIEW.md) — Firestore collections
