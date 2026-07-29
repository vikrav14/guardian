# Battery Behavior & Location Reporting Intervals

Battery monitoring and location reporting interval configuration are critical for balancing safety (frequent tracking) against device longevity (power conservation). This document covers how the V28C, V46, V48, and V52 pendants report battery status and how to tune the reporting interval for your use case.

---

## Battery Percentage Reporting

Every device sends battery status as part of its **heartbeat packet (LK)**, regardless of whether a location fix was obtained.

### How Battery is Reported

**Packet type:** `LK` (Link Keep-Alive heartbeat)

**Payload format:**
```
LK,steps,rolls,battery_percent

battery_percent = 0–100 (integer)
```

**Example heartbeat with battery:**
```
[3G*9705314117*000B*LK,0,0,85]
                        └─ 85% battery
```

### Battery Updates in Firestore

The gateway updates `devices/{imei}.batteryPercent` whenever a heartbeat arrives, regardless of whether a location was persisted. This means:

1. **Frequency:** Battery refreshes at **every heartbeat interval** (e.g., every 60 seconds if UPLOAD=60)
2. **Always available:** Even if GPS is not yet locked or location updates are throttled, battery % appears in Firestore
3. **Cache invalidation:** If battery changes between heartbeats, the device upserts `devices/{imei}` with the new value

**Schema reference:** See `firestore/SCHEMA.md` — `devices/{imei}.batteryPercent`

**Accuracy:** The device measures internal battery voltage and reports it as a percentage. Accuracy is ±2–3% in typical conditions; jumps of 5–10% can occur after extended idle periods (the battery voltage recovers).

---

## Low-Battery Alarm

When the device's internal battery voltage drops below the manufacturer's threshold, the device itself generates a **low-battery alarm packet**.

### How the Alarm Works

**Device behavior:** The V28C, V46, V48, and V52 each have a **hardcoded battery threshold** (typically around 20% for consumer GPS trackers, confirmed to be a device-side setting). When the battery percentage equals or falls below this threshold, the device sends an `AL` (alarm) packet with alarm code **0x00020000** (low battery).

**Packet type:** `AL` (Alarm)

**Payload example:**
```
AL,0,0,20,<alarmCode>,<lat>,<lng>,...
              └─ alarm code 0x00020000 = low battery
```

**Gateway handling:**
1. The `gateway/src/protocol/gt06.js` decoder parses the alarm code
2. If bit 17 is set (0x00020000), it classifies this as a `low_battery` alarm
3. Firestore writes an alert record to `alerts/{alertId}` with:
   - `type: 'low_battery'`
   - `severity: 'warning'`
   - `createdAt: <timestamp>`
   - `batteryPercent: <at time of alarm>` (if included in the packet)
4. Push notification sent to guardians (FCM)
5. SMS/WhatsApp sent to emergency contacts (if configured; see SMS narrowing note in [CLAUDE.md](../../CLAUDE.md))

### Threshold & Configuration

**Important:** The low-battery threshold is **set by the device manufacturer**, not by Guardian. The pendant itself decides when to send the alarm. You cannot adjust this threshold via SMS or TCP commands in the V28C.

For the **V46/V48/V52** models, vendor protocol docs may include a command to adjust the battery threshold, but this is **not documented** in the materials Guardian currently has access to. **Do not guess at this command** — verify with the vendor first.

**Typical threshold:** 20% (standard for consumer GPS trackers), but confirmation with your specific device variant is recommended.

---

## Location Reporting Interval Configuration

The **reporting interval** controls how frequently the device sends location updates and heartbeats. Shorter intervals mean more power consumption but faster alert detection; longer intervals preserve battery but increase response time.

### UPLOAD Command

**Command name:** `UPLOAD`  
**Transport:** TCP downlink only (requires live device connection; no SMS equivalent)  
**Syntax:** `UPLOAD,<seconds>`  
**Valid range:** 10–3600 seconds (≈ 3 seconds to 1 hour)

**Example:**
```javascript
// Send to device via downlink:
UPLOAD,60
// Device now sends LK + UD packets every 60 seconds
```

### What the Interval Controls

When you set `UPLOAD,N`:

| What happens | Frequency |
|---|---|
| **Heartbeat (LK)** | Every N seconds |
| **Location upload (UD)** | Every N seconds |
| **Battery refresh** | Every N seconds |
| **Geofence evaluation** | Every N seconds (evaluated against fixed geofences in Firestore) |

**Example timeline with UPLOAD=60:**
```
t=0s:   Device sends LK + UD packets (location + battery)
t=60s:  Device sends LK + UD packets again
t=120s: Device sends LK + UD packets again
...
```

If the device loses GPS lock between intervals, it still sends an `LK` heartbeat with battery; the next `UD` includes whatever position data is available (GPS, WiFi/LBS fallback, or stale last-known).

### Guardian's Presets

The mobile app offers quick-select presets in the **Care Settings** → **Location Reporting** section:

| Preset | Interval | Use case |
|--------|----------|----------|
| **Every 30s** | 30 seconds | High alert (active SOS, emergency tracking) |
| **Every 60s** | 60 seconds | Default / balanced |
| **Every 2m** | 120 seconds | Normal daytime wear |
| **Every 5m** | 300 seconds | Extended wear (school day, long commute) |

Guardians can also enter a custom interval (10–3600s) if needed.

### Sending the UPLOAD Command

**Via the Guardian app:**
1. Open **Care Settings** for a device
2. Tap **Location Reporting Interval**
3. Select a preset or enter custom seconds
4. The app writes the desired interval to `devices/{imei}.desiredLocationReportingIntervalSeconds` in Firestore
5. If the device is currently connected (TCP live), the gateway's **downlink manager** sends the `UPLOAD` command immediately
6. The device acknowledges by echoing the command; gateway logs the confirmation

**Programmatically (CLI / direct API):**
```bash
# Update the device config in Firestore (requires auth)
firebase firestore update devices/{imei} -- desiredLocationReportingIntervalSeconds 120

# If device is live, the gateway's downlink manager will send UPLOAD,120
```

**Requirements:**
- Device **must be online** (active TCP connection with gateway) for the interval to take effect immediately
- If the device is offline when the command is queued, it takes effect on the **next connection** (up to 24 hours later if offline)
- No in-app acknowledgment; the interval change is assumed after 2–3 cycles if logs show no errors

---

## Power Consumption & Trade-Offs

### Energy Cost per Interval

Each heartbeat/location packet costs:
- **GPS cold-start (first fix):** 1–3 minutes of active power, ~500–800 mA draw → ~10–40 mJ per fix
- **GPS reacquisition (within 60s of last fix):** Faster; ~1–5 mJ
- **LTE data transmission (packet):** ~20–50 mA for 1–2 seconds → ~1–3 mJ per packet
- **Idle/sleep state:** ~5–20 mA (background cellular registration, real-time TCP listen)

### Battery Drain Scenarios

**Scenario A: UPLOAD=30s (high alert)**
```
- Every 30s: GPS lock attempt (~10–30s) + transmission
- Typical daily power budget: 10 heartbeats + 10 location fixes
- Impact: 40–60% battery per day (non-outdoor, cold GPS)
- Use case: Active emergency, child in danger, elderly person on outing
- Pendant runtime: 1–2 days
```

**Scenario B: UPLOAD=60s (default, balanced)**
```
- Every 60s: GPS lock attempt + transmission
- Typical daily power budget: ~20 heartbeats + ~20 fixes
- Impact: 20–30% battery per day (moderate outdoor/indoor mix)
- Use case: Normal daytime wear, school pickup, checking in
- Pendant runtime: 3–5 days
```

**Scenario C: UPLOAD=300s (5-minute, extended wear)**
```
- Every 5min: GPS attempt + transmission
- Typical daily power budget: ~288 heartbeats/fixes
- Impact: 5–10% battery per day (normal use, outdoor 50%)
- Use case: All-day wear without recharging (school day, long trip)
- Pendant runtime: 10–20 days
```

**Scenario D: UPLOAD=3600s (1-hour, minimal)**
```
- Every 60min: GPS attempt + transmission
- Typical daily power budget: ~24 heartbeats/fixes
- Impact: 2–3% battery per day (minimal reporting)
- Use case: Night-time monitoring, secondary device, low-power mode
- Pendant runtime: 30–60 days
```

### Real-World Variables

Actual battery life depends on:

| Factor | Impact |
|--------|--------|
| **GPS signal quality** | Outdoor/satellite: faster lock (~5–10s). Indoor/urban canyon: longer search (~30–60s) or fallback to WiFi/LBS (lower power) |
| **Network signal strength** | Strong 4G LTE: faster transmission. Weak/roaming: longer connection + retransmit, higher power |
| **Device age** | Battery capacity degrades 15–20% per year; pendant may report 100% when internal capacity is ~80% |
| **Temperature** | Cold (<0°C): battery voltage drops, device may report lower %; fast drain under load. Hot (>45°C): accelerated chemical aging |
| **Cellular provider** | Some carriers have faster handoff; others cause 2–3s extra handshake per transmission |
| **WiFi availability** | Near known WiFi APs → faster fallback (~1s), lower power than GPS search. No WiFi → GPS-only or LBS (~20–30s) |

### Guardian's Cost Estimator

The gateway includes a **cost engine** (`gateway/src/cost-engine/index.js`) that calculates monthly operational cost (Firestore writes, data transmission, API calls) for different interval scenarios. This helps you balance:

- **Safety** (frequent updates = faster alert detection)
- **Cost** (Firestore write volume, SMS charges, compute)
- **Battery life** (device runtime between charges)

The estimator considers:
- Device model (V28C vs V52 have different power profiles)
- Reporting interval (30s–3600s)
- Route distance (drives GPS uptime %)
- Guardian subscription tier (push vs SMS narrowing affects notification cost)

---

## Recommended Settings by Use Case

| User Profile | Interval | Rationale |
|---|---|---|
| **Young child (5–12)** | 60s default, drop to 30s if at risk event | Frequent updates for parent peace-of-mind; battery lasts 3–5 days |
| **Teenager (13–18)** | 120–300s; 60s on field trips | Balanced: less invasive than 30s, still detects absence quickly |
| **Elderly (65+)** | 60–120s; 300s overnight | Frequent enough for fall detection; overnight 5min reduces false alerts |
| **Secondary device** (backup) | 600–3600s | Infrequent check-ins; mostly for "last known location" if primary fails |
| **Active outdoor event** | 30s | Emergency scenario, field trip, high-risk situation |
| **School/work day** | 120s | Balance between tracking and battery; lasts a full day |
| **Night-time tracking** | 300–600s | Reduced frequency for sleeping; minor location changes won't trigger alerts |

---

## Monitoring Battery Health

### In the App

- **Device card:** Shows current `batteryPercent` (refreshes every heartbeat)
- **Alerts page:** Recent low-battery warnings with `createdAt` timestamp
- **Device details:** Historical battery trend (last 7 days) — helps forecast when recharging is needed
- **Offline detection:** If device offline >1 hour, app shows "Offline" badge (not necessarily low battery; could be network issue)

### In Firestore

Raw data available to developers:

```firestore
devices/{imei} {
  batteryPercent: 42,
  lastHeartbeatAt: <timestamp>,
  intelligence: {
    insights: [
      { id: 'low_battery_moving', severity: 'warning', ... }
    ]
  }
}
```

`intelligence.insights` includes:
- `low_battery_moving` — battery <20% and device is moving (higher alert priority)
- `low_battery_idle` — battery <20% and device stationary (lower priority; might recharge at home)

---

## Charging & Storage

### Recommended Charging

- **Frequency:** Charge every 2–5 days (depending on interval + usage)
- **Method:** USB micro-B to power adapter (5V, ≥0.5A); included with device or standard Android charger
- **Time:** 2–3 hours from 0% to 100%
- **Indicator:** LED on device (typically red=charging, green=full; see device manual)

### Long-Term Storage

- **Before storage:** Charge to 60–80% (not 100%, as this stresses battery chemistry)
- **Duration:** If >3 months, recharge to 60% every month
- **Temperature:** Store in cool, dry place (15–25°C). Avoid hot cars or freezing conditions
- **Result:** Battery health maintained at ~95% after 1 year

---

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| Battery % stuck or decreases slowly | Device is offline; battery value last updated when online | Reconnect to TCP; if offline >24h, last-known value displayed |
| Low-battery alarm fires at 50% | Device internal threshold may be different from expected (could be ~50% not ~20%) | Note the percentage in the alert; communicate to user that their device triggers earlier |
| Battery jumps from 30% to 15% suddenly | Normal after idle period (voltage recovers); voltage slope is non-linear in final 20% | Expect erratic readings below 20%; charge soon to avoid unexpected shutdown |
| Device shuts down before 1% | Battery voltage depletes before internal 1% threshold reached | This is normal; device has safety margin. Recommend charging at 10–15% |
| Reporting interval not applied after UPLOAD command | Device was offline when command sent; command queued but device offline >24h | Wait for device to reconnect (within 24h typically); interval applies on next connection |
| Device stays offline despite UPLOAD=30s sent | Gateway connection lost, or device crashed | Check ngrok/tunnel status; check device power; verify gateway logs for TCP errors |

---

## Related Documentation

- **[V28C_DEVICE_SETUP.md](../V28C_DEVICE_SETUP.md)** — Full hardware setup, SMS commands, APN configuration
- **[GT06_PROTOCOL.md](../04-gateway/GT06_PROTOCOL.md)** — Protocol packet format, alarm codes, LK/UD structure
- **[EVENT_PROCESSING.md](../04-gateway/EVENT_PROCESSING.md)** — How battery alarms trigger notifications
- **[TCP_CONNECTION_LIFECYCLE.md](../04-gateway/TCP_CONNECTION_LIFECYCLE.md)** — Device connection, heartbeat persistence
- **[CLAUDE.md](../../CLAUDE.md)** — Hard rule on vendor commands; only documented commands are safe to use

---

## Vendor Reference

| Topic | Document | Location |
|-------|----------|----------|
| LK heartbeat payload | `V28C Communication Protocol.pdf` | `docs/reference/` |
| AL alarm codes (low battery = 0x00020000) | `V28C Communication Protocol.pdf` + `V46-V48-V52 2021-12-20.pdf` | `docs/reference/` |
| UPLOAD command (TCP interval) | `V46-V48-V52 2021-12-20.pdf` section II.1 | `docs/reference/` |
| Battery voltage measurement | `V28C-DataSheet.pdf` | `docs/reference/` |
| SMS commands (center, ip, sos, etc.) | `Switch-Server-SMS-Commands.pdf` | `docs/reference/` |

**Note:** The 20% low-battery threshold is **device-firmware-defined**, not configured via SMS or TCP. Exact threshold may vary by device variant and firmware version. Always test with real hardware to confirm.

---

**Last updated:** 2026-07-29
