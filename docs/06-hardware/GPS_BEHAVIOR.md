# GPS Behavior and Accuracy

## Overview

Guardian's GPS positioning system uses two complementary methods to locate the pendant, each with distinct accuracy characteristics. The gateway automatically selects the best available fix based on device conditions and reports accuracy metadata so the app can communicate reliability to caregivers.

## Positioning Methods

### Satellite GPS (A Flag)

**Accuracy:** 5–10 meters typical, 1–3 meters in ideal conditions  
**Gateway field:** `accuracySource: 'gps'`  
**Protocol flag:** `A` (valid fix)  
**When available:** Clear sky, no tall buildings or dense foliage

Satellite GPS fixes come directly from the pendant's onboard receiver. These are preferred when available because they are precise and do not depend on external databases or API calls. The gateway stores them as-is with no additional processing (apart from the Mauritius hemisphere correction — see below).

**Limitations:**
- Slow fix acquisition (30 seconds to several minutes cold start)
- Cannot penetrate roofs or dense indoor environments
- Blocked or degraded by dense urban canyons, dense foliage, or tunnels
- May report incorrect hemisphere (see **Mauritius Hemisphere Correction** below)

**App labels:**
- Status shown as: "● Live location" or "Satellite GPS"
- No accuracy qualifier — caregivers assume precise positioning

### WiFi/Cellular Fallback (V Flag)

**Accuracy:** 100–400 meters typical, 30–500+ meters in poor network conditions  
**Gateway field:** `accuracySource: 'wifi'` or `accuracySource: 'lbs'`  
**Protocol flag:** `V` (valid WiFi/cell data, not satellite GPS)  
**When available:** Indoors, underground, or where satellite GPS is unavailable

When the pendant cannot acquire a satellite fix, it falls back to ambient WiFi MAC addresses or cellular tower IDs and sends them to the gateway. The gateway queries Google Geolocation API (or another reverse-geolocation service) to resolve lat/lng from these identifiers. This method is fast and works indoors, but accuracy degrades quickly as signal strength decreases or when the database lacks coverage for nearby networks.

#### WiFi Positioning (`accuracySource: 'wifi'`)

- Uses WiFi MAC addresses (and optional RSSI) from nearby access points
- Query result typically includes a `accuracy` field indicating radius of confidence
- Requires access points to be present within range and catalogued by Google

#### LBS Positioning (`accuracySource: 'lbs'` — Location-Based Services)

- Uses cell tower identity (MCC, MNC, LAC, Cell ID)
- Works anywhere with cellular coverage, even without WiFi
- Accuracy varies widely depending on cell density (urban vs. rural)
- Degraded significantly in areas with sparse tower deployment

**Limitations:**
- Slower than satellite GPS in resolution (depends on API latency, typically <1 second)
- Accuracy highly dependent on network/WiFi density at device location
- Cannot resolve coordinates if Google Geolocation API is unreachable or returns no result
- Requires gateway to have outbound HTTPS to Google (or to fallback provider)

**App labels:**
- Status shown as: "Approximate location"
- Caregivers should expect location to be off by 100–400 meters

## Accuracy Ranges: Quick Reference

| Method | Accuracy | Typical Use | Map Confidence |
|--------|----------|-------------|-----------------|
| **Satellite GPS (A flag)** | 5–10 m | Clear sky, outdoor routes | Precise — street-level |
| **WiFi (V flag)** | 50–200 m | Indoor, urban areas | Approximate — neighborhood level |
| **LBS (V flag)** | 200–400 m | Rural, sparse networks | Approximate — district level |
| **No fix** | Unknown | Pendant offline or silent | Last known only |

## Mauritius Hemisphere Correction

Guardian operates exclusively in Mauritius, which lies in the Southern Hemisphere (negative latitude). The V28C pendant's firmware contains a repeatable defect: genuine satellite GPS fixes report an incorrect hemisphere letter (positive latitude instead of negative).

### The Bug

Confirmed against real hardware (2026-07-28):
- Every A-flag (satellite) fix from deployed units reported wrong hemisphere
- The same device's WiFi/cell fallback positions (computed independently via Google Geolocation API) were always correctly negative
- This is a firmware defect, not sensor noise or intermittent

### The Fix

The gateway applies a deployment-specific correction in `src/fleet-hemisphere.js`:

```javascript
function correctFleetHemisphere(locEvent) {
  if (!locEvent || locEvent.accuracySource !== 'gps' || !locEvent.location) {
    return locEvent;  // Only correct genuine satellite fixes
  }
  const { lat } = locEvent.location;
  if (typeof lat !== 'number' || lat <= 0) return locEvent;  // Already negative or invalid
  return { ...locEvent, location: { ...locEvent.location, lat: -lat } };
}
```

**Important:** This correction is applied **only to genuine satellite GPS fixes** (`accuracySource: 'gps'`), never to WiFi/LBS-resolved fallback positions (which are already correct from Google's API).

### Caregiver Impact

With the correction in place, caregivers see accurate positions whether the pendant is using satellite GPS or WiFi/cellular fallback. The app makes no distinction — both flows go through the same correction gate.

## How the App Communicates Accuracy

### Location Status Labels (Device Formatters)

The Flutter app translates positioning source and freshness into human-readable status messages shown on the map and dashboard:

| Device State | App Label | Accuracy Signal |
|--------------|-----------|-----------------|
| Live, satellite GPS | "● Live location" or "Satellite GPS" | Precise (5–10 m) |
| Live, WiFi/LBS | "Approximate location" | Approximate (100–400 m) |
| Live, no location yet | "Waiting for location" | Unknown |
| Reconnecting | "Last known location" | Stale (time-dependent) |
| Offline | "Last known location" or "Location unavailable" | Stale / Unknown |

### Positioning Description (Device Model)

The app provides structured positioning metadata via `device.positioningDescription`:

```dart
DevicePositioningDescription? get positioningDescription {
  final source = accuracySource?.toLowerCase();
  return switch (source) {
    'gps' => const DevicePositioningDescription(
        label: 'satellite GPS',
        approximate: false,
      ),
    'wifi' => const DevicePositioningDescription(
        label: 'WiFi positioning',
        approximate: true,
      ),
    'lbs' => const DevicePositioningDescription(
        label: 'cell tower positioning',
        approximate: true,
      ),
    _ => null,
  };
}
```

This structure allows screens to conditionally highlight or badge approximate positions, helping caregivers calibrate trust in the location shown.

### Freshness Indicators

In addition to positioning source, the app communicates whether a location is recent ("live") or stale ("last known"):

- **Fresh location:** Recorded within ~8 minutes of the last heartbeat (online device)
- **Stale location:** Older than the freshness slack window, or device offline
- **No location:** Never had a fix, or all data is invalid/placeholder coordinates

```dart
// From device.dart
const Duration deviceLocationFreshnessSlack = Duration(minutes: 8);

bool get hasFreshLocation {
  if (location == null || !location.isValid) return false;
  if (!online) return true;  // Offline devices keep last known even if stale
  final contact = lastHeartbeatAt ?? updatedAt;
  if (contact != null &&
      contact.difference(location.recordedAt) > deviceLocationFreshnessSlack) {
    return false;  // Heartbeat too old relative to location
  }
  return true;
}
```

## Protocol Details: GT06 Decoding

### Location Data Field Structure

The GT06 protocol encodes locations in a standardized field sequence (Appendix I, shared across V28C and V46-V52):

```
[DDMMYY, HHMMSS, FLAG, LAT, LATDIR, LNG, LNGDIR, SPEED, COURSE, ...]
```

- **DDMMYY / HHMMSS:** Date and time (UTC)
- **FLAG:** `A` (satellite GPS valid) or `V` (WiFi/LBS data present, no satellite)
- **LAT / LATDIR:** Latitude as decimal + N/S hemisphere
- **LNG / LNGDIR:** Longitude as decimal + E/W hemisphere
- **SPEED:** Speed in km/h (optional, for some command types)
- **COURSE:** Heading in degrees (optional)
- **...:** LTE extras (WiFi MACs, signal strengths, cell tower info) if FLAG is `V`

### Parser Behavior

The gateway's `parseLocationData()` function (in `src/protocol/gt06.js`) handles both cases:

**A-flag (Satellite GPS):**
- Parses coordinates directly
- Sets `gpsValid: true`, `accuracySource: 'gps'`
- No external API call needed

**V-flag (WiFi/LBS):**
- Parses WiFi MAC addresses and signal strengths (if present)
- Parses cell tower info (MCC, MNC, LAC, Cell ID) if present
- Sets `gpsValid: false`, `needsGeolocation: true`
- Sets `accuracySource` based on what's available: `'wifi'` or `'lbs'`
- Returns structured WiFi/cell data for async geolocation

### Geolocation API Integration

When `needsGeolocation: true`, the gateway calls Google Geolocation API (`src/geolocate/google.js`):

```javascript
async function geolocateFromV({ wifiAccessPoints = [], cellTowers = [] } = {}) {
  // Cache by (WiFi MACs + cell tower IDs) hash — 10 min TTL
  // Sends payload to: https://www.googleapis.com/geolocation/v1/geolocate
  // Returns: { lat, lng, accuracyMeters }
}
```

**Caching:** Geolocation results are cached for 10 minutes by network signature (WiFi + tower hash) to reduce API calls and latency.

## Firestore Storage

Locations are stored with full fidelity for both satellite and fallback modes:

### Device Document (Live Position)

```
devices/{imei}
├─ location
│  ├─ lat: number
│  ├─ lng: number
│  ├─ altitude: number | null
│  ├─ recordedAt: timestamp
│  └─ satellites: number | null
├─ accuracySource: string  // 'gps' | 'wifi' | 'lbs'
├─ speedKmh: number | null
├─ course: number | null
└─ lastHeartbeatAt: timestamp
```

### Location History (Optional Subcollection)

When `WRITE_LOCATION_HISTORY=true` (off by default), older positions are persisted:

```
devices/{imei}/locations/{locationId}
├─ lat: number
├─ lng: number
├─ speedKmh: number | null
├─ accuracySource: string  // 'gps' | 'wifi' | 'lbs'
└─ recordedAt: timestamp
```

**Why separate?** The device document is frequently written (every fix, heartbeat, or write-gate pass). History is append-only and can be throttled independently to reduce Firestore costs.

## Known Limitations & Future Work

### Current Gaps

1. **No accuracy radius in device document:**  
   Satellite GPS doesn't include a confidence radius (the firmware doesn't report one). WiFi/LBS fallback receives `accuracyMeters` from Google's API but it is not currently persisted to Firestore. This prevents caregivers from seeing explicit confidence rings on the map.

2. **WiFi SSID not populated from real devices:**  
   The protocol decoder has a placeholder for WiFi SSID in genuine packets, but real V28C units never send it. This feature is structurally present but data-dead. Verify with vendor before enabling.

3. **No on-device indication for "listen in" (voice monitor):**  
   If voice monitoring is enabled, the wearer has no way to know they're being listened to. This is a privacy/consent issue, not a technical gap.

4. **Gateway is localhost-only:**  
   Real pendant hardware connects over cellular and cannot reach `127.0.0.1`. For production, the gateway must be exposed (tunnel for testing, real public IP/DNS for production).

### Future Enhancements

- Persist `accuracyMeters` from Google Geolocation API to Firestore for visual confidence rings
- Support GNSS alternatives (GLONASS, Galileo) if/when vendor firmware adds them
- Add Kalman filtering to reduce position jitter in noisy network environments
- Implement geofence breach detection with accuracy-weighted thresholds

## Testing & Validation

### With Real Hardware

1. **Satellite GPS:** Take the pendant outdoors, wait 1–2 minutes for fix, confirm positions within 5–10 m of known location (e.g., street address)
2. **WiFi fallback:** Place pendant indoors near strong WiFi, observe fix accuracy typically 50–200 m depending on local network density
3. **Cell tower fallback:** Move to rural area with weak/no WiFi, verify positions resolve within cell tower accuracy (200–400 m typical)
4. **Hemisphere:** Verify all A-flag fixes show negative latitude (Southern Hemisphere)

### With Simulator

Run `npm run simulate` in `gateway/` to generate fake locations around Quatre Bornes, Mauritius. Simulator alternates between satellite and fallback modes to test both code paths.

## References

- **V28C Protocol:** `docs/reference/V28C-GPS-Datasheet.pdf` (GT06 base spec)
- **V46–V52 Protocol:** `docs/reference/V46-V52-Protocol-2021-12-20.pdf` (extended commands, shared Appendix I)
- **Geolocation API:** [https://developers.google.com/maps/documentation/geolocation/overview](https://developers.google.com/maps/documentation/geolocation/overview)
- **Code:**
  - Gateway protocol decoder: `gateway/src/protocol/gt06.js`
  - Hemisphere correction: `gateway/src/fleet-hemisphere.js`
  - Geolocation API integration: `gateway/src/geolocate/google.js`
  - Journey builder: `gateway/src/journey-builder.js`
  - Flutter device model: `apps/mobile/lib/models/device.dart`
  - Flutter status labels: `apps/mobile/lib/dashboard/device_formatters.dart`
