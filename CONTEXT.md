# CONTEXT.md — Guardian for AI Assistants

This file orients Claude (and other AI assistants) to the Guardian codebase.

## Project Overview

Guardian is a family safety platform combining GPS safety pendants, a mobile app, a device gateway, and AI-powered assistance. Designed for Mauritius; used by families with elderly relatives, children, and caregivers who need to know their loved ones are safe.

**Product promise:** Know they are safe.

**Current status:** Pre-launch pilot phase  
**Primary market:** Mauritius  
**Primary users:** Elderly people, families with children, caregivers

## Hardware

**Primary device:** V52 (ReachFar, GT06-family protocol)  
**Secondary/legacy:** V28C, V46, V48 (similar protocol variants)

Devices communicate via **TCP over 4G LTE** (fallback to 3G GSM). They send:
- Location (GPS, WiFi/cellular fallback)
- Battery status
- Alarm events (SOS, fall detection)
- Heartbeats every ~5 minutes

**Vendor documents:** See [`docs/reference/`](docs/reference/) for device datasheets and protocol specifications.

## Architecture

```
GPS Pendant (V52) ──TCP/GT06──> Gateway (Node.js) ──> Firestore & Firebase Auth
                                     │
                                     ├──> FCM (push to app)
                                     ├──> Twilio (SMS/WhatsApp)
                                     └──> Claude (AI assistant)
                                     
                                     ▲
                                     │
Flutter App (Android + Web) <────────┘ (real-time sync)
```

**Key components:**
- **Gateway** (`gateway/src/`): TCP listener, GT06 decoder, Firestore writer, device command sender
- **Mobile** (`apps/mobile/`): Flutter caregiver dashboard (map, device linking, care settings)
- **Backend** (Firebase): Firestore (data), Auth (login), FCM (push)
- **Notifications** (Twilio): SMS/WhatsApp to emergency contacts
- **AI** (`gateway/src/assistant/`): Claude integration for WhatsApp assistant (production-readiness TBD)

## Key Features (Current)

✓ = Implemented  
? = Production-readiness unclear  
⏳ = Pending owner decision

| Feature | Status | Notes |
|---------|--------|-------|
| Live map tracking | ✓ | Real-time device location on map |
| Device linking | ✓ | Users can link multiple devices |
| Safe zones | ✓ | Geofence entry/exit alerts |
| Care settings | ✓ | Fall detection, medication reminders, location reporting interval |
| Push notifications | ✓ | FCM to mobile app |
| SMS/WhatsApp alerts | ✓ | To emergency contacts (SOS, fall, geofence, low battery) |
| Guardian AI | ? | Claude integration; needs production verification |
| WhatsApp assistant | ? | Natural-language check-ins; needs production verification |
| Offline fallback | ✓ | Shows last-known-location when device is offline |
| Device status | ✓ | Online/offline detection, battery monitoring |
| Location history | ✓ | Configurable via `WRITE_LOCATION_HISTORY` env var |

## Important Implementation Details

### Device Commands
- Sent via **TCP only** (no SMS fallback)
- Requires live device connection
- No in-app confirmation mechanism
- Request-cache model: app caches desired state in Firestore; device state is inferred, not confirmed

**Key commands:**
- `UPLOAD,<seconds>` — Sets location reporting interval (30s–3600s)
- `FALLDOWN,X,Y` — Enables/disables fall detection with sensitivity
- `TAKEPILLS,<time>,<freq>` — Medication reminder scheduling
- `FIND#` — Ring to find
- `monitor,<phone>#` — Voice monitoring (unverified)

### Location Accuracy
- **GPS valid** (`gpsValid: true`): Satellite GPS, ~5-10m accurate
- **GPS fallback** (`gpsValid: false`): WiFi/cellular positioning, ~100-400m approximate
- **Offline**: Last-known-location displayed

The app clearly communicates accuracy to users. Never assume approximate locations are precise.

### Security
- Firestore uses `linkedTo(imei)` pattern for access control
- Users can only see locations of devices they've linked
- Subscription tiers exist but not enforced (display-only for now)

## Data Model (Key Collections)

```
users/{uid}
  ├── email
  ├── linkedImeis: [...]      # Which devices this user can see
  ├── emergencyContacts: [...]
  └── preferences

devices/{imei}
  ├── online: bool
  ├── batteryPercent: int
  ├── lastLocation: {lat, lng, timestamp, gpsValid}
  ├── locationReportingIntervalSeconds: int
  ├── fallDetection: bool
  ├── medicationReminders: [...]
  └── safeZones: [...]

locations/{docId}
  ├── imei
  ├── lat, lng
  ├── gpsValid: bool
  ├── accuracy: int
  ├── timestamp
  └── createdAt

alerts/{docId}
  ├── imei
  ├── type: "geofence_exit" | "fall" | "sos" | "low_battery"
  ├── severity: "info" | "warning" | "critical"
  ├── message
  └── createdAt
```

See [`firestore/SCHEMA.md`](firestore/SCHEMA.md) for the complete schema.

## Code Organization

```
apps/mobile/lib/
  ├── screens/           # One file per screen
  ├── services/          # Firestore queries/writes (guardian_services.dart)
  ├── models/            # Data classes
  ├── dashboard/         # Dodo character and map components
  └── l10n/              # Localization (partial)

gateway/src/
  ├── server.js          # TCP listener & event loop
  ├── protocol/gt06.js   # Packet decoder
  ├── commands.js        # Device command builders
  ├── firestore.js       # Firestore writes
  ├── push.js            # FCM integration
  ├── notify.js          # SMS/WhatsApp (Twilio)
  ├── geofence.js        # Safe zone evaluation
  ├── assistant/         # Claude AI integration
  └── ...

firestore/
  ├── SCHEMA.md          # Data model documentation
  ├── rules.example      # Security rules (deployed)
  └── firestore.indexes.json
```

## Testing

- **Flutter:** `flutter test` (unit + widget tests)
- **Gateway:** `npm test` (Node's built-in test runner)
- **Simulator:** `npm run simulate` (fake pendant data for local testing)

## Important Constraints & Known Gaps

1. **No device onboarding workflow** — Every new account auto-links to demo IMEI (`AuthService.demoImei`)
2. **Location history gated** — Must set `WRITE_LOCATION_HISTORY=true` in gateway `.env`
3. **WiFi safe-zones not functional** — GT06 decoder never populates WiFi SSID from real devices
4. **Family invites one-directional** — Invitee links to inviter's device, but inviter's list isn't updated (issue #62)
5. **Device pricing/billing not implemented** — Subscription tier is display-only
6. **Localization incomplete** — Only nav labels + some settings translated; most UI stays in English
7. **Gateway is local-only** — Real devices need exposed gateway (tunnel for testing, real hosting for production)
8. **WhatsApp assistant production status unclear** — Code exists; readiness TBD
9. **SOS button not user-verified end-to-end** — Device firmware has capability; full flow not confirmed

## Pending Owner Decisions

See [`docs/audit/OPEN_QUESTIONS.md`](docs/audit/OPEN_QUESTIONS.md) for 30 explicit questions blocking documentation. Critical ones:

- V28C deprecation status?
- Guardian AI / WhatsApp production-ready?
- Device pricing finalized?
- SOS button end-to-end verified?
- Launch timeline and V1 scope?
- Supplier and carrier strategy?

## Documentation

Full documentation: [`docs/README.md`](docs/README.md)

Key sections:
- [System Overview](docs/02-architecture/SYSTEM_OVERVIEW.md)
- [Mobile App Guide](docs/03-mobile/MOBILE_OVERVIEW.md)
- [Gateway Technical Guide](docs/04-gateway/GATEWAY_OVERVIEW.md)
- [Firestore Schema](docs/05-data/FIRESTORE_OVERVIEW.md)
- [V52 Hardware](docs/06-hardware/V52.md)
- [Development Setup](docs/09-development/GETTING_STARTED.md)
- [Implementation Audit](docs/audit/IMPLEMENTATION_INVENTORY.md)

## Conventions

- **Security:** All Firestore reads scoped through `linkedTo(imei)` pattern
- **Notifications:** SMS/WhatsApp narrower than push (SOS/fall/exit only, not enter/low-battery)
- **Tests:** Use `fake_cloud_firestore` + `firebase_auth_mocks` (Flutter); `node:test` (gateway)
- **Device commands:** Document vendor confirmation; avoid guessing at undocumented protocols

---

**Last updated:** 2026-07-29  
**For questions:** See [GitHub Issues](https://github.com/vikrav14/guardian/issues)
