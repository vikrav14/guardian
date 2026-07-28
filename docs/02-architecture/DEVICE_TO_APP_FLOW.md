# Device-to-App Real-Time Sync

**Last updated:** 2026-07-29

Guardian uses Firestore's real-time sync to keep the mobile app up-to-date whenever the device sends new data.

## Architecture

```
GPS Pendant (V52)
    │ TCP packet: UD (location)
    │
    ▼
Gateway (Node.js)
    │ 1. Parse GT06 packet
    │ 2. Extract location, battery, timestamp
    │ 3. Write to Firestore
    │
    ▼
Firestore (real-time database)
    │ Write: locations/{docId}
    │ Update: devices/{imei}.lastLocation
    │ Update: devices/{imei}.online
    │
    ▼ Firestore triggers subscribers
    │
    ▼
Mobile App (Flutter listening)
    │ 1. Watch: devices/{imei}
    │ 2. Watch: locations/ (filtered by imei)
    │ 3. Update UI in real-time
    │
    ▼
Caregiver sees:
    • Map marker moves to new location
    • Last-update timestamp refreshes
    • Battery percentage updates
    • Device status changes (online → offline)
```

## Real-Time Listeners in the App

The mobile app uses Firestore listeners to keep data fresh:

### Device Listener
```dart
// Listen to a single device
FirebaseFirestore.instance
  .collection('devices')
  .doc(imei)
  .snapshots()
  .listen((snapshot) {
    // Update: online status, battery, last location
    updateDeviceCard(snapshot.data());
  });
```

**Data received:**
- `online`: bool
- `batteryPercent`: int
- `lastLocation`: {lat, lng, timestamp, gpsValid}
- `lastHeartbeat`: timestamp
- Device settings (fall detection, location interval, etc.)

### Location Listener
```dart
// Listen to location history
FirebaseFirestore.instance
  .collection('locations')
  .where('imei', isEqualTo: imei)
  .orderBy('createdAt', descending: true)
  .limit(100)
  .snapshots()
  .listen((snapshot) {
    // Update map with location history
    updateLocationHistory(snapshot.docs);
  });
```

**Data received:**
- `lat`, `lng`: GPS coordinates
- `gpsValid`: bool (satellite vs. fallback)
- `accuracy`: meter radius
- `timestamp`: device time
- `createdAt`: gateway receive time
- `batteryPercent`: at time of location

### Alerts Listener
```dart
// Listen to alerts for this device
FirebaseFirestore.instance
  .collection('alerts')
  .where('imei', isEqualTo: imei)
  .orderBy('createdAt', descending: true)
  .limit(50)
  .snapshots()
  .listen((snapshot) {
    // Show alerts, trigger notifications
    displayAlert(snapshot.docs);
  });
```

**Data received:**
- `type`: "geofence_exit", "fall", "sos", "low_battery", "offline"
- `severity`: "info", "warning", "critical"
- `message`: Human-readable description
- `createdAt`: When alert was generated

## Latency Breakdown

From device to app display:

```
Device sends location (UD packet)
    │
    ├─► Network latency: ~100–500ms
    │
    ▼
Gateway receives & parses
    │
    ├─► Processing time: ~10–50ms
    │
    ▼
Firestore write
    │
    ├─► Firestore latency: ~100–500ms
    │
    ▼
Firestore broadcasts update to connected clients
    │
    ├─► Network latency: ~100–500ms
    │
    ▼
Mobile app receives & renders
    │
    ├─► App processing: ~50–200ms
    │
    ▼
Caregiver sees map marker move

Total: 400–2000ms (0.4–2 seconds, typically ~1 second)
```

## Map Marker Behavior

The mobile app displays the device location with different states:

```
┌─────────────────────────────────────────────────┐
│ Device Online & Location Recent (< 5 min)       │
├─────────────────────────────────────────────────┤
│ Marker: Blue/green dot (active)                 │
│ Label: "Updated 1 min ago"                      │
│ Action: Click to see device card                │
│ Line: Draw route from history                   │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│ Device Offline (> 5 min, < 2 hrs)               │
├─────────────────────────────────────────────────┤
│ Marker: Gray dot (faded)                        │
│ Label: "Last seen 1 hour ago"                   │
│ Action: Click to see last-known-location info   │
│ Line: Show route from before going offline      │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│ Device Long-Offline (> 2 hrs)                   │
├─────────────────────────────────────────────────┤
│ Marker: Very faded / striped                    │
│ Label: "Last seen 8 hours ago"                  │
│ Action: Click to show concern prompt            │
│ Warning: "Device hasn't checked in for 8hrs"    │
└─────────────────────────────────────────────────┘
```

## Location Lag Issue

In some cases, the map marker shows stale location for several minutes after the device actually moves.

**Root cause:** Firestore listener batches updates. If the device doesn't send a new location, the marker doesn't move.

**Symptoms:**
- Marker stays at old coordinates despite device moving
- Timestamp shows old time ("Updated 31 min ago")
- Marker "jumps" to new location when next update arrives

**Solution:** When care settings has `locationReportingIntervalSeconds = 5*60` (5 minutes), device sends location every 5 minutes, keeping marker fresh.

**Workaround for stale data:**
- User can tap "Refresh" to force a location update via `CR` command
- Or manually open device card to see "Last known location: <time ago>"

See [`../04-gateway/LOCATION_PIPELINE.md`](../04-gateway/LOCATION_PIPELINE.md) for gateway-side details.

## Notification Delivery

When a critical alert is generated, notifications flow to caregivers via multiple channels:

```
Alert created in Firestore: alerts/{docId}
    ├─► Type: "sos", Severity: "critical"
    │
    ├─► Trigger 1: FCM Push Notification
    │   │ Recipient: Caregiver (via mobile app)
    │   │ Delivery: ~instant
    │   │ Content: "SOS! Device location: <lat, lng>"
    │   │ Action: Tap to open map
    │   │
    │   └─► App displays notification banner
    │
    ├─► Trigger 2: SMS/WhatsApp via Twilio
    │   │ Recipient: Emergency contact phone number
    │   │ Delivery: ~5–30 seconds
    │   │ Content: "SOS: Device location link + coordinates"
    │   │
    │   └─► Contact receives SMS/WhatsApp message
    │
    └─► Trigger 3: In-app Alerts tab
        │ Shows all alerts for this device
        │ Color-coded: green (info), yellow (warning), red (critical)
        │
        └─► Caregiver can see full alert history
```

## Device Status Synchronization

The app keeps track of device state in real-time:

```
Firestore: devices/{imei}
    {
      "online": true,
      "batteryPercent": 85,
      "lastHeartbeat": 1690824000,
      "lastLocation": {
        "lat": -20.1234,
        "lng": 57.5678,
        "accuracy": 15,
        "gpsValid": true,
        "timestamp": 1690824000
      },
      "fallDetection": true,
      "fallSensitivity": 3,
      "locationReportingIntervalSeconds": 300,
      "safeZones": [...]
    }

App Listener
    │
    ├─► Render device card:
    │   • Status: Online (green) or Offline (gray)
    │   • Battery: 85% + icon
    │   • Last update: "Updated 2 min ago"
    │   • Fall detection: Toggle switch [ON]
    │   • Reporting interval: "Every 5 minutes"
    │
    └─► Render Dodo character state:
        • Online + linked: Happy Dodo
        • Offline: Sleeping Dodo
        • Linking: Loading Dodo
        • Listening (voice monitor): Alert Dodo
```

## Edge Cases

### Device Connects While App is Closed
```
1. Device sends location
2. Gateway writes to Firestore
3. App is not listening (closed)
4. Background service (FCM) receives push notification
5. User opens app
6. Firestore listeners reconnect
7. App receives latest location
8. Map updates to show current position
```

### Device Sends Duplicate Location
```
1. Device sends: UD packet with timestamp T
2. Gateway receives & writes to Firestore
3. Device reconnects, sends same location again
4. Gateway deduplicates (checks timestamp):
   IF location.timestamp == lastReceived.timestamp
      THEN skip write (no duplicate)
      ELSE write new location
5. App only sees one update
```

### Offline Device Reconnects with Buffered Data
```
1. Device was offline for 1 hour
2. Device reconnects, sends UD2 packet (buffered locations)
3. Gateway writes each buffered location to Firestore
4. App listener receives multiple location updates
5. Map shows "rewind" animation or history playback
6. Latest marker shows current position
```

---

## Related Documentation

- [SYSTEM_OVERVIEW.md](SYSTEM_OVERVIEW.md) — High-level architecture
- [DATA_FLOW.md](DATA_FLOW.md) — Data flow diagrams
- [SECURITY_MODEL.md](SECURITY_MODEL.md) — Access control
- [`../03-mobile/MOBILE_OVERVIEW.md`](../03-mobile/MOBILE_OVERVIEW.md) — Mobile app structure
- [`../04-gateway/LOCATION_PIPELINE.md`](../04-gateway/LOCATION_PIPELINE.md) — Gateway implementation
- [`../05-data/FIRESTORE_OVERVIEW.md`](../05-data/FIRESTORE_OVERVIEW.md) — Firestore schema
