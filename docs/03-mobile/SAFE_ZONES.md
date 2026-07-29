# Safe Zones & Geofencing

Safe zones (geofences) are custom-named circular boundaries around places that matter — home, school, work, church — where you want to know when your loved one arrives or leaves. The app can track whether a wearer is inside or outside multiple zones simultaneously and alert you to changes.

## Overview

A safe zone consists of:

- **Name**: Home, School, Church, Work, Hiking area, or a custom label
- **Center**: Geographic coordinates (latitude, longitude) on a map
- **Radius**: A circular boundary in meters (50–5,000 m default range; typical values 150–500 m for home/school)
- **Linked Device**: Which pendant (IMEI) this zone monitors
- **WiFi SSID** (optional): A home WiFi network name that also counts as "inside" the zone
- **Active/Paused**: Toggle zones on and off without deleting them

The system continuously compares the pendant's live GPS location against all active zones and generates enter/exit events when the wearer crosses a boundary. Because GPS indoors is unreliable, a configured WiFi SSID can also mark the pendant as safely "inside" if it associates with that network.

---

## Creating a Safe Zone

### From the App

1. Open the **Safe Zones** screen (tap the shield icon in the nav bar).
2. Tap the **Add zone** button.
3. In the dialog, fill in:
   - **Device**: Select which pendant this zone tracks (must have at least one linked device).
   - **Zone name**: "Home", "School", "Grandma's house", etc. The name is used to infer a category and visual icon (Home → 🏠, School → 🎓, Church → ⛪).
   - **Radius (meters)**: How far from the center point the zone extends. Start with 150 m for a home or school; adjust up or down based on GPS drift and your comfort level.
   - **Home WiFi name** (optional): The SSID of your home or work network. If the pendant connects to this WiFi and you've configured it, the zone will consider the wearer "inside" even if GPS is stale or inaccurate indoors.

4. **Choose location**: Tap "Choose on map" to open an interactive map.
   - The map shows the proposed circle, centered at your starting point (the device's current location or Quatre Bornes, Mauritius by default).
   - Drag the circle center to fine-tune the location.
   - You can also manually edit the radius on this screen.
   - Tap a point on the map to lock the center.
   - Return to the dialog to confirm.

5. Tap **Create** to save the zone to Firestore.

### Manual Location Selection

If the device has no GPS fix yet, or if you want to create a zone before getting a live location update:

1. Tap **Choose on map** in the create dialog.
2. The location picker shows your starting point and a preview of the zone radius.
3. Pan the map, tap the center point to move it, and adjust the radius using the control.
4. Once satisfied, return to the create dialog with your chosen coordinates.

### Device Requirements

- At least one device must be linked to your account before you can create a safe zone.
- The zone is tied to a specific IMEI; if you want the same zone to track multiple wearers, create separate zones (one per device).

---

## Editing a Safe Zone

### Adjusting Radius

1. Open the safe zone card.
2. Tap the **Edit** action (if available in the card menu).
3. Update the **Radius** field and save.

*(Note: Direct in-app radius editing UI may be added in a future release; for now, delete and recreate the zone with a new radius, or manage it via the Firestore console.)*

### Toggling Active/Paused

Each zone card displays a toggle switch:

- **On** (Active): The zone monitors live GPS and sends enter/exit alerts.
- **Off** (Paused): The zone is disabled; no alerts are generated, but the zone and its history remain saved.

Pause a zone seasonally (e.g., school zones during holidays) without losing its configuration.

### Changing the WiFi SSID

Edit the `wifiSsid` field in Firestore directly, or delete and recreate the zone with the new SSID. The app UI does not yet support inline editing of the WiFi field.

### Deleting a Zone

Tap the **Delete** action on the zone card. The zone and all associated alerts are permanently removed from Firestore.

---

## WiFi SSID Linking

### How It Works

When you link a zone to a home WiFi network (SSID), the system considers the wearer "inside" the zone if **either**:

1. **GPS says inside**: The pendant's GPS location is within the zone radius.
2. **WiFi says inside**: The pendant is currently associated with the configured WiFi network.

This dual-check is intentional: indoor GPS is often inaccurate or unreliable, so WiFi association can serve as a reliable "inside" signal for home zones.

### Configuration

1. When creating a zone, enter the **Home WiFi name** field with the exact SSID of your network (e.g., "MyRouter" or "HomeNet 5GHz").
2. The check is case-insensitive and ignores leading/trailing whitespace: `"  HomeNet  "` matches `"homenet"`.
3. Leave the field blank if the zone has no WiFi association.

### Current Limitation

**The GT06/V28C pendant does not currently report its WiFi SSID in any device packet decoded by the gateway.** The vendor documentation (docs/reference/V28C datasheet) does not document a packet format that includes WiFi information, and the gateway protocol decoder in `gateway/src/protocol/gt06.js` does not extract this field.

This means:

- The WiFi SSID field is accepted in the zone configuration and stored in Firestore.
- The WiFi matching logic is implemented and ready in `gateway/src/geofence.js`.
- **But on real hardware today, the pendant never reports WiFi, so the WiFi check never fires.**

The feature will become active once:

1. The pendant firmware or a future protocol version includes WiFi SSID in its GPS packets.
2. The gateway decoder is updated to extract and store `location.wifiSsid` in the device document.

For now, zones rely on GPS distance alone. WiFi configuration can be set up in advance and will activate automatically when hardware support is available.

### Testing in Simulation

The gateway's simulator (`npm run simulate`) generates fake locations near Quatre Bornes. It does not simulate WiFi SSID reports, so the WiFi feature cannot be tested in the simulator yet.

---

## Alert Types & Triggers

### Geofence Enter

Fired when the device crosses the zone boundary **into** the safe zone.

- **Type**: `geofence_enter`
- **Severity**: `info`
- **Message**: "Entered safe zone: [Zone Name]"
- **Payload**: Includes geofence ID, zone name, distance from center in meters, and a flag indicating if the enter was triggered by WiFi match.

**Who is notified:**
- **Guardians**: Push notification via FCM to all devices linked to the app.
- **Emergency contacts**: *Not notified* (enter alerts are considered routine information, not SOS).

### Geofence Exit

Fired when the device crosses the zone boundary **out of** the safe zone.

- **Type**: `geofence_exit`
- **Severity**: `warning`
- **Message**: "Left safe zone: [Zone Name]"
- **Payload**: Includes geofence ID, zone name, distance from center in meters, and WiFi match flag.

**Who is notified:**
- **Guardians**: Push notification via FCM to all linked app installs.
- **Emergency contacts**: *Not notified*.

### Alert Cooldown

To avoid "flapping" — repeated enter/exit alerts due to GPS jitter near a zone boundary — each zone+device combo has a **1-minute cooldown** per alert type (enter and exit are tracked separately). A second enter alert for the same zone cannot fire within 60 seconds of the first; same for exits.

---

## Zone Status & Dashboard

### Status Indicators

Each zone card shows one of five statuses:

| Status | Color | Meaning |
|--------|-------|---------|
| **SAFE** | Green | Device is inside the zone. |
| **OUTSIDE** | Orange/Amber | Device is outside the zone boundary. |
| **EMERGENCY** | Red | An active SOS or fall alert is associated with this zone. |
| **PAUSED** | Gray | Zone is toggled off; monitoring is suspended. |
| **NO GPS** | Orange/Amber | Device has no recent GPS fix; zone status cannot be determined. |

### Status Resolution Logic

The status is determined in priority order:

1. **Zone not active?** → **PAUSED**
2. **Active SOS or fall alert linked to this zone?** → **EMERGENCY**
3. **Device not linked to this zone?** → **UNKNOWN**
4. **Device has no fresh location?** → **UNKNOWN**
5. **Device location is invalid (0,0)?** → **UNKNOWN**
6. **Device is inside the zone radius?** → **SAFE**
7. **Device is outside the zone radius?** → **OUTSIDE**

Zones are de-duplicated on the dashboard (if two identical zone names exist for the same device, only the first is shown).

### Zone Card Information

Each zone card displays:

- **Zone name** and category icon (inferred from the name).
- **Current status** (SAFE, OUTSIDE, etc.) with color-coded badge.
- **Radius** in meters.
- **Mini map** showing the zone circle and the device's current location.
- **Last entered** timestamp: When the wearer most recently entered this zone.
- **Updated** timestamp: When the linked device last reported a location update.
- **Toggle switch** to pause/unpause the zone.
- **Delete button** to remove the zone.

---

## Map Visualization

### Location Picker Map

When creating or editing a zone on the map:

- A **circle** is drawn at the zone center with radius lines to the edge.
- The **circle color** is category-specific:
  - Home: Teal/accent
  - School: Purple
  - Church: Orange
  - Work: Gray
  - Hiking: Green
  - Other: Teal/accent
- You can **pan and zoom** to fine-tune the location.
- **Tap to select** a new center point.
- **Slider or +/- buttons** (if available) adjust the radius in real-time.

### Zone Mini-Map on Card

Each zone card includes a small map preview:

- The **zone circle** (gray outline) shows the boundary.
- A **marker** (or ring) shows the device's current location.
- Color indicates the status (green for safe, orange for outside, red for emergency).
- Tap the mini-map to open the full location picker for editing (if the UI supports it).

---

## Notification Recipients

### Guardians

All users with the linked device in their `linkedImeis` field receive:

- **Push notifications (FCM)** on their mobile app for geofence enter/exit alerts.
- **In-app alerts** visible on the Safe Zones screen and in the Alerts/Activity feed.

Push notifications are sent to all registered FCM tokens for that guardian (all their app installs across devices).

### Emergency Contacts

Emergency contacts (phone numbers added in Settings > Emergency Contacts) are **intentionally not sent geofence enter/exit alerts**. They receive SMS and WhatsApp only for:

- **SOS** (pendant SOS button pressed)
- **Fall** (fall detection triggered)
- **Critical-severity alerts** (if any other critical events are defined in future)

This narrower policy avoids alert fatigue for contacts who may only need to know about true emergencies, not routine zone transitions. Guardians always receive all alerts.

---

## Geofence Data Model

### Firestore Collection: `geofences/{geofenceId}`

```
geofences/
├── {geofenceId}/
│   ├── imei (string)              # Device IMEI this zone monitors
│   ├── name (string)              # "Home", "School", etc.
│   ├── active (boolean)           # Zone is enabled
│   ├── center (map)
│   │   ├── lat (number)           # Center latitude
│   │   └── lng (number)           # Center longitude
│   ├── radiusMeters (number)      # Radius in meters (50–5000)
│   ├── wifiSsid (string | null)   # Optional WiFi network name
│   ├── createdBy (string)         # Guardian UID who created it
│   ├── createdAt (timestamp)      # Created time
│   └── updatedAt (timestamp)      # Last updated time
```

### Security Rules

Zones are scoped to linked devices:

- A guardian can **create, read, update, delete** geofences only for IMEIs in their `linkedImeis` array.
- The gateway (Admin SDK) can read and write geofences without restrictions.
- See `firestore/rules.example` for the full security rules.

---

## Known Gaps & Future Work

### WiFi SSID Not Currently Decoded

As noted above, the pendant does not report WiFi SSID in its GPS packets today. The feature is structurally ready (logic in place, Firestore field exists) but will remain inactive until the hardware/protocol supports it.

### Limited Zone Editing

The current app allows you to:
- Create zones (set name, radius, center, WiFi SSID)
- Toggle active/paused
- Delete zones

The UI does not yet support inline editing of radius or SSID without delete/recreate. Workarounds:
- Edit the zone document directly in the Firestore console.
- Delete the zone and create a new one with updated values.

### No Multi-Device Zones

Each zone is tied to a single device IMEI. If you want to track two children in the same school zone, create two zone documents (one per child) with the same center and radius.

### Geofence History Not Persisted

The app shows the **last enter** timestamp on each zone card, but full geofence event history is only available in the Alerts/Activity feed. There is no dedicated "zone history" view.

### Zone Import/Export

Zones are not yet portable. You cannot export a zone configuration from one family account and import it into another. Create zones manually for each account, or manage them via Firestore.

---

## Testing

### Unit Tests

Run the geofence logic tests:

```bash
cd apps/mobile
flutter test test/safe_zone_logic_test.dart
```

This tests the Haversine distance calculation and zone status resolution logic.

### Gateway Geofence Tests

```bash
cd gateway
npm test -- geofence.test.js
```

Tests the geofence transition logic, cooldown, and WiFi matching (when available).

### Manual Testing

1. Start the gateway simulator:
   ```bash
   cd gateway
   npm run simulate
   ```
2. Create a safe zone in the app around Quatre Bornes (the simulator's location).
3. Observe enter/exit alerts in the Alerts feed as the simulated pendant moves in and out of the zone.

---

## References

- **Geofence Logic** (Flutter): `apps/mobile/lib/safe_zones/safe_zone_logic.dart`
- **Geofence Evaluation** (Gateway): `gateway/src/geofence.js`
- **Safe Zones Screen**: `apps/mobile/lib/screens/safe_zones_page.dart`
- **Zone Card Widget**: `apps/mobile/lib/widgets/safe_zones/safe_zone_card.dart`
- **Geofence Data Model**: `firestore/SCHEMA.md` (search for `geofences`)
- **Security Rules**: `firestore/rules.example`
