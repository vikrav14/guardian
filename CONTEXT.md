# Guardian — Personal GPS Safety Platform

## 1. Project Overview & Vision

Guardian is a premium personal safety and tracking SaaS platform tailored for families in Mauritius. It bypasses cheap, generic default tracking apps in favor of a custom, highly polished mobile app integrated with AI features and native WhatsApp messaging.

### Core Target Audiences

- **The Elderly & Dementia/Alzheimer's Patients:** Fall detection, location tracking, and geofencing.
- **Schoolchildren:** Monitoring school van transits with automated safety check-ins.
- **Hikers & Outdoor Enthusiasts:** SOS, fall detection, and offline-resilient backup safety in mountainous regions.

## 2. Hardware Device Specifications

The platform integrates with a wearable 4G GPS smart pendant (**V28C** family — see [docs/reference/V28C-DataSheet.pdf](docs/reference/V28C-DataSheet.pdf)).

Server IP / APN / interval configuration is done via SMS — see [docs/reference/Switch-Server-SMS-Commands.pdf](docs/reference/Switch-Server-SMS-Commands.pdf).

- **Connectivity:** 4G LTE + 3G WCDMA + 2G GSM (Nano SIM).
- **Sensors:** GPS, BDS, WiFi Positioning (indoor), LBS (cellular tower fallback), 3-axis Accelerometer (fall detection), 0.3MP Camera.
- **Battery:** 750mAh.
- **On-Device UI:** Physical SOS button, emergency speed-dial, microphone, loudspeaker (voice monitoring, talking clock / pill reminders).
- **Protocol:** Standard GT06 (or similar Gps103/JT808) — binary/hex packets over raw TCP/UDP.

## 3. High-Level Technical Architecture

```
[4G GPS Pendant]
        │
        ▼  Raw TCP on port 9000 (GT06)
[Google Cloud Compute Engine — Node.js Gateway]
        │
        ▼  Binary → JSON
[Firebase Auth + Firestore]
        │
        ├──► [Flutter Guardian App]
        └──► [AI Processing Engine] ──► [WhatsApp Business API]
```

### Stack Components

1. **Gateway Server:** Lightweight Node.js TCP socket listener on a GCP VM. Decodes buffers, extracts IMEI, coordinates, speed, status, alerts; writes to Firestore.
2. **Database & Auth:** Firebase Firestore (live tracking + config) and Firebase Auth.
3. **Frontend App:** Flutter map-centric Guardian dashboard (next milestone).
4. **Communications Engine:** Twilio or WhatsApp Business Cloud API for template notifications (later).

## 4. App Feature Set & Requirements

### A. Live Map Dashboard

- Real-time map with accuracy-source indicators (GPS = green, WiFi = blue, LBS = amber).
- Device status overlays: battery, speed, last heartbeat timestamp.

### B. Smart Geofencing ("Safe Zones")

- Interactive radii on the map.
- WiFi safe-zones: link "Home" to SSID for low-power mode while on home WiFi.

### C. Remote Hardware Control Panel

Commands via GPRS/SMS:

- Capture photo (0.3MP upload).
- Silent monitor (pendant calls guardian).
- Pill reminders (TTS to pendant speaker).

### D. WhatsApp Notification Hub

- Multiple emergency contacts.
- Template alerts: SOS, fall, safe-zone exit, critically low battery.

## 5. AI Engine Specifications

### AI-1: Predictive Wandering Detection (Dementia Care)

Model historical location vs hour-of-day routines; flag high-deviation anomalies before geofence breach.

### AI-2: Intelligent Fall Verification

Evaluate accelerometer sequences around fall triggers to reduce false alarms (drop vs human fall patterns).

### AI-3: WhatsApp AI "Guardian Assistant"

LLM (e.g. Gemini) + Firestore: natural-language check-ins via WhatsApp Business number.

## 6. Business Parameters (Mauritius Market)

| Parameter | Value |
|-----------|-------|
| Short-term users | 500 |
| Long-term users | 5,000 |
| Hardware unit cost | Rs 1,000 |
| Hardware sale price | Rs 3,500 |
| Subscription | Rs 200 / month |

## 7. Build Priority

1. **Done:** `CONTEXT.md`, Node.js GT06 gateway, Firestore schema, device simulator, Firebase project `guardian-fbadd`.
2. **In progress:** Flutter map dashboard in `apps/mobile` (live Firestore markers).
3. **Later:** WhatsApp hub, remote commands, AI engines, Auth-gated rules.
