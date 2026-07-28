# Guardian: Family Safety Through GPS Pendants

Guardian combines a wearable GPS pendant, a mobile app, and a device gateway to give families meaningful reassurance — not raw tracking data.

> **Know they are safe.**

Designed for Mauritius families. Works for elderly people living independently, families with children, and any caregiver who needs to know their loved one is safe.

---

## What Does Guardian Do?

1. **Location tracking** — See where your loved one is in real time on a map
2. **Safety alerts** — Get instant notifications if they leave a safe zone or press the SOS button
3. **Care settings** — Enable fall detection, medication reminders, and location update frequency
4. **Family sharing** — Multiple caregivers can track the same device
5. **Offline awareness** — See the last known location if the device is offline

---

## Architecture

```
┌─────────────────┐
│  GPS Pendant    │
│  (V52 device)   │
└────────┬────────┘
         │ TCP/GT06 protocol
         │
    ┌────▼─────┐
    │ Gateway  │  Node.js
    │ (TCP)    │  Decodes GT06, sends commands
    └────┬─────┘
         │ Firestore writes / FCM / Twilio
         │
    ┌────▼──────────┐
    │  Backend      │
    │  Firebase +   │
    │  Firestore    │
    └────┬──────────┘
         │
    ┌────▼──────┐
    │  Mobile   │
    │   App     │  Flutter
    │ (Android) │  Real-time updates via Firestore
    └───────────┘
```

### Core Components

| Component | Tech | Responsibility |
|-----------|------|---|
| **GPS Pendant** | V52 device (ReachFar GT06-protocol) | Sends location, battery, alarm status over TCP |
| **Gateway** | Node.js TCP server | Decodes GT06 packets, writes to Firestore, sends device commands |
| **Backend** | Firebase + Firestore | Data storage, authentication, real-time sync |
| **Mobile App** | Flutter (Android + Web) | Caregiver dashboard, device linking, settings |
| **Notifications** | FCM + Twilio | Push alerts, SMS/WhatsApp to emergency contacts |

---

## Getting Started

### For Developers

**First time setting up?**

1. Follow [Flutter Setup](docs/09-development/GETTING_STARTED.md) to install dependencies
2. Follow [Firebase Setup](docs/09-development/FIREBASE_SETUP.md) to configure Firebase
3. Run `flutter test` and `npm test` to verify everything works

**Want to understand the system?**

Start with [System Overview](docs/02-architecture/SYSTEM_OVERVIEW.md) — it explains how the pendant, gateway, and app talk to each other.

**Running locally?**

- **Mobile:** `flutter run`
- **Gateway:** `npm start`
- **Simulator:** `npm run simulate` (fake pendant data)

### For Operations & Launch

- **Supplier onboarding:** [8-Week Plan](docs/12-operations/SUPPLIER_ONBOARDING.md)
- **Device support:** [V52 Hardware](docs/06-hardware/V52.md)
- **Launch checklist:** [Master Roadmap](docs/14-roadmap/MASTER_ROADMAP.md)

---

## Current Status

**What's built:**
- ✓ Flutter app (map, device linking, care settings, safe zones)
- ✓ Gateway (GT06 decoding, device commands, location pipeline)
- ✓ Firestore schema and security
- ✓ Push notifications, SMS/WhatsApp alerts
- ✓ Guardian AI assistant (status: production-readiness TBD)
- ✓ Fall detection, medication reminders, location reporting interval

**What's pending:**
- Device pricing and subscription model
- Launch timeline and V1 scope
- Supplier qualification and carrier agreements
- Guardian AI / WhatsApp production verification

**Pending decisions? See [Open Questions](docs/audit/OPEN_QUESTIONS.md) (30 items blocking documentation finalization).**

---

## Repository Structure

```
guardian/
├── README.md                      # You are here
├── CONTEXT.md                     # AI orientation
├── CLAUDE.md                      # Instructions for Claude Code
│
├── apps/mobile/                   # Flutter caregiver app
│   ├── lib/screens/               # One file per screen
│   ├── lib/services/              # Firestore & API integration
│   └── test/
│
├── gateway/                       # Node.js device gateway
│   ├── src/
│   │   ├── protocol/gt06.js       # Packet decoder
│   │   ├── commands.js            # Device commands
│   │   ├── firestore.js           # Data writes
│   │   └── notify.js              # SMS/WhatsApp
│   └── test/
│
├── firestore/                     # Schema & security rules
│   ├── SCHEMA.md
│   ├── rules.example
│   └── firestore.indexes.json
│
├── docs/                          # Full documentation (you are here)
│   ├── README.md                  # Docs navigation
│   ├── audit/                     # Audit findings
│   ├── 02-architecture/           # System design
│   ├── 03-mobile/                 # App documentation
│   ├── 04-gateway/                # Gateway documentation
│   ├── 05-data/                   # Firestore documentation
│   ├── 06-hardware/               # Device documentation
│   ├── 08-notifications/          # Alert system
│   ├── 09-development/            # Dev setup & guides
│   ├── 12-operations/             # Operations & supplier
│   ├── 14-roadmap/                # Launch roadmap
│   └── ... (14 sections total)
│
└── scripts/                       # Setup & utility scripts
```

---

## Key Concepts

### Device Status
- **Online** — Device checked in within the last 5 minutes (live location available)
- **Stale** — Device was online, but hasn't checked in recently
- **Offline** — Device hasn't checked in for several hours (last known location displayed)

### Location Accuracy
- **Satellite GPS** — Accurate within ~5-10m; marked as `gpsValid: true`
- **WiFi/LBS fallback** — Approximate within ~100-400m; marked as `gpsValid: false`
- **Last known location** — Shown when the device is offline

Never assume an approximate location is precise. The app clearly communicates this distinction.

### Device Commands
- Real-time commands (UPLOAD interval, fall detection, medication reminders) require a live device connection
- No SMS fallback — TCP only
- No in-app confirmation; assumes acceptance if the device echoes

---

## Documentation

Full documentation is in [`/docs`](docs/README.md):

| Section | Purpose |
|---------|---------|
| [System Overview](docs/02-architecture/SYSTEM_OVERVIEW.md) | How Guardian works end-to-end |
| [Mobile App](docs/03-mobile/MOBILE_OVERVIEW.md) | Flutter app structure and screens |
| [Gateway](docs/04-gateway/GATEWAY_OVERVIEW.md) | TCP server and protocol decoding |
| [Firestore](docs/05-data/FIRESTORE_OVERVIEW.md) | Data model and security |
| [Hardware](docs/06-hardware/V52.md) | V52 device capabilities |
| [Development](docs/09-development/GETTING_STARTED.md) | Local setup and contribution |
| [Operations](docs/12-operations/SUPPLIER_ONBOARDING.md) | Supplier and launch planning |
| [Audit](docs/audit/) | Implementation inventory and findings |

---

## Contributing

See [CLAUDE.md](CLAUDE.md) for project context and conventions.

Development guidelines:
- Run tests before committing: `flutter test` and `npm test`
- Follow existing code style (Dart conventions in Flutter, Node conventions in gateway)
- Update relevant documentation when adding features
- Document your changes in the PR description and GitHub issues

---

## Support & Issues

- **Issues tracked in:** [GitHub Issues](https://github.com/vikrav14/guardian/issues)
- **Project status:** [GitHub Wiki](https://github.com/vikrav14/guardian/wiki)
- **Documentation:** [Full docs](/docs/README.md)

---

## License

[License info TBD]

---

**Last updated:** 2026-07-29  
**Documentation phase:** Phase 1 ✓ (Architecture, Mobile, Gateway, Data, Hardware, Operations)  
**Next phase:** Phase 2 (Product, Business) — awaiting owner decisions
