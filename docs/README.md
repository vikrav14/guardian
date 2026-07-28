# Guardian Documentation

Guardian is a Mauritius-first family safety platform combining GPS safety pendants, a mobile app, device gateway, and AI-powered assistance to deliver meaningful reassurance rather than raw tracking data.

> Know they are safe.

## Quick Start

### For developers
- **First time here?** Start with [Getting Started](09-development/GETTING_STARTED.md)
- **How does Guardian work?** Read [System Overview](02-architecture/SYSTEM_OVERVIEW.md)
- **Set up locally** — [Local Development](09-development/LOCAL_DEVELOPMENT.md)

### For operations & launch
- **Supplier onboarding** — [8-Week Plan](12-operations/SUPPLIER_ONBOARDING.md)
- **Launch readiness** — [Master Roadmap](14-roadmap/MASTER_ROADMAP.md)
- **Device support** — [V52 Hardware](06-hardware/V52.md)

### For product & design
- **Feature overview** — [Feature Map](01-product/FEATURE_MAP.md) *(coming in Phase 2)*
- **Product principles** — [Safety Model](01-product/SAFETY_MODEL.md) *(coming in Phase 2)*

---

## Documentation Structure

| Section | Purpose | Status |
|---------|---------|--------|
| **00-overview** | Product vision, principles, scope | Phase 2 |
| **01-product** | Features, user journeys, product decisions | Phase 2 |
| **02-architecture** | System design, data flow, security | ✓ Phase 1 |
| **03-mobile** | Flutter app structure, screens, flows | ✓ Phase 1 |
| **04-gateway** | Node.js gateway, protocol, commands | ✓ Phase 1 |
| **05-data** | Firestore schema, ownership, security | ✓ Phase 1 |
| **06-hardware** | V52 device, capabilities, protocol | ✓ Phase 1 |
| **07-ai-and-messaging** | Claude AI, WhatsApp integration | Phase 3 |
| **08-notifications** | Push, SMS, WhatsApp alerts | ✓ Phase 1 |
| **09-development** | Setup, development, contribution | ✓ Phase 1 |
| **10-deployment** | Gateway, mobile, Firebase deployment | Phase 3 |
| **11-qa** | Testing strategy, field pilots | Phase 3 |
| **12-operations** | Supplier, onboarding, support | ✓ Phase 1 |
| **13-business** | Pricing, market, partnerships | Phase 2 |
| **14-roadmap** | Master roadmap, launch checklist | ✓ Phase 1 |
| **15-decisions** | Architecture decision records | Phase 3 |
| **audit** | Audit findings & implementation inventory | ✓ Done |

---

## Key Concepts

### Location Accuracy
Guardian distinguishes between:
- **Satellite GPS** — Accurate within ~5-10m; marked as `gpsValid: true`
- **WiFi/LBS fallback** — Approximate within ~100-400m; marked as `gpsValid: false`
- **Last known location** — Shown when device is offline

Never assume an approximate location is precise. The app communicates this distinction to caregivers.

### Device Status Model
- **Online** — Device checked in within the last 5 minutes
- **Stale** — Device was online, but hasn't checked in recently
- **Offline** — Device hasn't checked in for several hours; last known location is displayed

### Device Commands
- **TCP downlink** — Real-time commands require a live device connection (no SMS fallback)
- **Request cache** — Some settings (fall detection, location interval) are cached in Firestore but cannot be read back from the device
- **Command delivery** — No in-app confirmation; assumes acceptance if the device echoes

---

## Product Principles

1. **Translate telemetry into reassurance.** Caregivers don't need raw coordinates; they need to know if someone is safe.
2. **Never lie about accuracy.** Approximate locations are labeled; precise GPS is distinguished.
3. **Communicate clearly.** Device limitations are honest; SOS triggers are unambiguous.
4. **Protect privacy.** Location history is configurable; data ownership is enforced at the security-rule layer.
5. **Design for families.** Multiple languages, multiple caregivers, multiple devices.

---

## Repository Structure

```
guardian/
├── README.md                 # Root overview
├── CONTEXT.md               # Orientation for AI assistants
├── CLAUDE.md                # Instructions for Claude Code
│
├── apps/mobile/             # Flutter caregiver app (Android + Web)
│   ├── lib/
│   │   ├── screens/         # One file per screen
│   │   ├── services/        # Firestore & API integration
│   │   ├── models/          # Data models
│   │   └── dashboard/       # Dodo states and components
│   └── test/
│
├── gateway/                 # Node.js device gateway & AI assistant
│   ├── src/
│   │   ├── server.js        # TCP listener & connection handler
│   │   ├── protocol/        # GT06 protocol decoder
│   │   ├── commands.js      # Device command builder
│   │   ├── firestore.js     # Firestore writes
│   │   ├── push.js          # FCM push notifications
│   │   ├── notify.js        # SMS/WhatsApp notifications
│   │   ├── geofence.js      # Safe zone evaluation
│   │   ├── assistant/       # Claude AI integration
│   │   └── ...
│   └── test/
│
├── firestore/               # Schema, rules, indexes
│   ├── SCHEMA.md            # Firestore collections & fields
│   ├── rules.example        # Security rules (deployed)
│   └── firestore.indexes.json
│
├── docs/                    # Documentation (you are here)
│   ├── audit/               # Audit findings & implementation inventory
│   ├── 00-overview/
│   ├── 01-product/
│   ├── 02-architecture/
│   └── ... (14 sections total)
│
└── scripts/                 # Setup & utility scripts
```

---

## Common Tasks

**I want to…**

- **Understand the whole system** — Start with [System Overview](02-architecture/SYSTEM_OVERVIEW.md) and [Data Flow](02-architecture/DATA_FLOW.md)
- **Develop the mobile app** — Read [Mobile Overview](03-mobile/MOBILE_OVERVIEW.md) and [Getting Started](09-development/GETTING_STARTED.md)
- **Work on the gateway** — Read [Gateway Overview](04-gateway/GATEWAY_OVERVIEW.md) and [TCP Connection Lifecycle](04-gateway/TCP_CONNECTION_LIFECYCLE.md)
- **Understand Firestore** — Read [Firestore Overview](05-data/FIRESTORE_OVERVIEW.md)
- **Support a real device** — Read [V52 Hardware](06-hardware/V52.md) and [Device Capability Matrix](06-hardware/DEVICE_CAPABILITY_MATRIX.md)
- **Debug an issue** — Read [Debugging Guide](09-development/DEBUGGING_GUIDE.md) *(coming in Phase 3)*
- **Launch Guardian** — Read [Master Roadmap](14-roadmap/MASTER_ROADMAP.md) and [Supplier Onboarding](12-operations/SUPPLIER_ONBOARDING.md)

---

## Status & Scope

**Current status:** Pre-launch pilot phase  
**Primary market:** Mauritius  
**Primary users:** Elderly people living independently, families with children, caregivers

**What's built:**
- ✓ Flutter mobile app (map, linking, care settings, safe zones)
- ✓ Node.js gateway (protocol decoding, Firestore writes, device commands)
- ✓ Firestore data model (locations, devices, safe zones, alerts)
- ✓ Push notifications (FCM), SMS/WhatsApp (Twilio)
- ✓ Guardian AI assistant (Claude integration; production-readiness TBD)
- ✓ Location history, offline fallback, last-known-location display
- ✓ Fall detection and medication reminder commands

**What's pending owner decision:**
- Device pricing and subscription tiers
- Launch timeline and V1 scope
- Guardian AI / WhatsApp production-readiness
- Supplier and carrier lock-in decisions
- Business model finalization (device sale + subscription vs. rental)

See [Open Questions](audit/OPEN_QUESTIONS.md) for the full list (30 items).

---

## Help & Support

- **Stuck?** Check the [Glossary](00-overview/GLOSSARY.md) *(coming in Phase 2)*
- **Found a doc problem?** Open an issue or create a PR
- **Have a question?** See [Contributing](09-development/CONTRIBUTING.md) *(coming in Phase 3)*

---

**Last updated:** 2026-07-29  
**Documentation phase:** Phase 1 (Architecture, Mobile, Gateway, Data, Hardware, Operations)  
**Next phase:** Phase 2 (Product, Business) — awaiting owner decisions on scope and positioning
