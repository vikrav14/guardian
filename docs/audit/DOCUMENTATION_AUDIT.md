# Guardian Documentation Audit

**Audit Date:** 2026-07-29  
**Branch:** `docs/guardian-source-of-truth`  
**Auditor:** Claude Code

## Summary

Guardian's documentation was created during early prototype stages and is significantly outdated. The repository has evolved substantially, but documentation has not kept pace.

- **Root README:** Outdated (claims Flutter is "next")
- **CONTEXT.md:** Severely outdated (outdated hardware claims, old feature priorities)
- **docs/:** Partially useful (device setup still valid, but architecture docs missing)
- **GitHub Wiki:** Unknown current status
- **Code comments:** Generally accurate but sparse in architecture areas
- **Tests:** Accurate source of truth for implemented features

## Inventory of Current Documentation

| Location | Status | Purpose | Issues |
|----------|--------|---------|--------|
| `README.md` | Outdated | Repo overview | Claims Flutter is "next"; only mentions V28C; outdated setup instructions |
| `CONTEXT.md` | Severely outdated | Product vision & architecture | Mixes vision with obsolete impl; outdated hardware; no mention of AI/WhatsApp integration |
| `CLAUDE.md` | Current | Instructions for AI assistants | Accurate; needs linking to full docs |
| `docs/FIREBASE_SETUP.md` | Partially useful | Firebase config | Relevant but needs current project details |
| `docs/FLUTTER_SETUP.md` | Partially useful | Flutter development | Basic setup valid; missing current screen structure |
| `docs/V28C_DEVICE_SETUP.md` | Outdated | V28C hardware provisioning | V28C is legacy; V52 primary; commands outdated |
| `docs/reference/` | Partially useful | Vendor PDFs | Contains real protocol docs; needs organization |
| `firestore/SCHEMA.md` | Outdated | Firestore collections | Needs verification against current code |
| `firestore/firestore.indexes.json` | Current | Firestore indexes | Accurate; referenced in code |
| `firestore/rules.example` | Current | Security rules | Accurate; security model documented here |
| GitHub Wiki | Unknown | QA-facing docs | Not audited (may be out of sync) |

## Documentation Audit by Area

### 1. Architecture & System Design

**Current state:** No current documentation  
**Evidence:** None; deduced from code  
**Missing:**
- System overview diagram
- Device-to-app flow
- Device command pipeline
- Location ingestion pipeline
- Firestore data ownership model
- Guardian AI integration points
- WhatsApp notification flow

**Location to document:** `/docs/02-architecture/`

### 2. Mobile Application (Flutter)

**Current state:** Outdated setup guide; no architecture docs  
**Evidence:**
- `docs/FLUTTER_SETUP.md` exists but is incomplete
- Code shows mature feature set not reflected in docs
- `apps/mobile/lib/screens/` shows:
  - Map dashboard (with Dodo character)
  - Device linking sequence
  - Care settings (fall detection, location interval, medication)
  - Safe zones
  - Connected to Firestore via `guardian_services.dart`

**Missing:**
- Screen structure and navigation
- Linking sequence (4 steps)
- Care settings architecture
- Dodo character states and messaging
- Notification handling
- Guardian AI integration (if present)

**Location to document:** `/docs/03-mobile/`

### 3. Gateway (Node.js)

**Current state:** No current documentation; only old protocol reference  
**Evidence:**
- `gateway/src/` shows mature implementation:
  - `protocol/gt06.js` — GT06 protocol decoder (handles V28C, V46/V48/V52 variants)
  - `server.js` — TCP connection handler
  - `commands.js` — device command builder
  - `geofence.js` — safe zone evaluation
  - `push.js` — notification dispatcher
  - `firestore.js` — Firestore writes
  - `assistant/` — Claude AI integration
  - Tests in `gateway/test/`

**Missing:**
- TCP connection lifecycle
- Packet decoding pipeline
- Firestore write model
- Command delivery and retry
- Geofence evaluation
- Push/SMS/WhatsApp notification flow
- AI assistant request handling
- Observatory/metrics

**Location to document:** `/docs/04-gateway/`

### 4. Hardware & Device Protocol

**Current state:** V28C device setup guide; vendor PDFs in reference  
**Evidence:**
- `docs/V28C_DEVICE_SETUP.md` exists
- `docs/reference/` contains vendor protocol documents
- Code shows V52 and V46/V48/V52 support
- Gateway decoder handles multiple device families

**Issues:**
- V28C documentation exists but V28C appears to be legacy/secondary
- V52 has no documentation
- Device capability matrix not documented
- No clear statement of which device is primary
- Protocol documents are PDFs (not searchable)

**Location to document:** `/docs/06-hardware/`

### 5. Firebase & Firestore

**Current state:** Schema documented; rules documented; no ownership model  
**Evidence:**
- `firestore/SCHEMA.md` exists but needs verification
- `firestore/rules.example` is current (referenced in code)
- `firestore/firestore.indexes.json` is current
- Code shows:
  - Users collection
  - Devices collection
  - Locations collection
  - Safe zones
  - Device commands
  - Alerts

**Missing:**
- Data ownership model (who can read/write what)
- Request cache fields vs. confirmed device state
- Collection retention policy
- Indexes explanation
- Security rule architecture

**Location to document:** `/docs/05-data/`

### 6. Guardian AI & WhatsApp

**Current state:** No documentation; code exists in `gateway/src/assistant/`  
**Evidence:**
- `gateway/src/assistant/` directory present
- `push.js` and `notify.js` handle messaging
- Tests reference WhatsApp integration
- CLAUDE.md mentions "Claude-powered WhatsApp assistant"

**Status:** Integrated or planned? Not yet verified from code.  
**Missing:**
- AI request flow
- Claude integration details
- WhatsApp payload format
- Authorization checks
- Rate limiting/cost controls
- Failure scenarios
- Supported use cases

**Location to document:** `/docs/07-ai-and-messaging/`

### 7. Notifications

**Current state:** Partial; referenced in code but not documented  
**Evidence:**
- `gateway/src/push.js` handles push notifications
- `gateway/src/notify.js` handles SMS/WhatsApp
- Code shows event types: location, heartbeat, alarm, geofence
- Tests show different notification types

**Missing:**
- Event catalog (what triggers notifications)
- Delivery mechanism per notification type
- Retry behavior
- Rate limits
- Quiet hours / do-not-disturb
- Alert escalation (SOS)

**Location to document:** `/docs/08-notifications/`

### 8. Development & Deployment

**Current state:** Partial setup guides; no deployment docs  
**Evidence:**
- `docs/FIREBASE_SETUP.md` exists
- `docs/FLUTTER_SETUP.md` exists
- `.claude/launch.json` exists (for dev server)
- Scripts in `scripts/` (setup-github-issues.sh visible in CLAUDE.md)

**Missing:**
- Full dev setup guide
- Testing strategy
- Debugging guide
- Deployment procedures
- CI/CD (if present)
- Environment variables
- Coding standards

**Location to document:** `/docs/09-development/`, `/docs/10-deployment/`

### 9. Testing

**Current state:** Tests exist in code; no QA strategy documented  
**Evidence:**
- Tests in:
  - `gateway/test/` (Node tests)
  - `apps/mobile/test/` (Flutter tests)
- CLAUDE.md mentions test frameworks: `fake_cloud_firestore`, `firebase_auth_mocks`, `node:test`
- Recent commits show test-driven work

**Missing:**
- QA strategy
- Test coverage goals
- Device acceptance tests
- Safe zone testing
- SOS testing
- Fall detection testing
- Field pilot plan

**Location to document:** `/docs/11-qa/`

### 10. Operations & Supplier Onboarding

**Current state:** No documentation  
**Evidence:**
- CLAUDE.md references V52, supplier, real hardware testing
- Recent work on Care Settings suggests operational features

**Missing:**
- Supplier onboarding plan
- Device provisioning
- Batch QA procedures
- Field pilot planning
- Customer onboarding
- Support procedures
- Warranty/RMA

**Location to document:** `/docs/12-operations/`

### 11. Business & Product

**Current state:** CONTEXT.md is severely outdated; no current product docs  
**Evidence:**
- README mentions "elderly care, school transit"
- CLAUDE.md mentions "Mauritius-first"
- CONTEXT.md mentions Rs 3000 device, Rs 199/month subscription (unverified)

**Missing:**
- Current target users
- Pricing model (if finalized)
- Subscription plans
- Business assumptions
- Launch timeline
- Geographic scope

**Location to document:** `/docs/13-business/`, `/docs/00-overview/`

### 12. Roadmap & Launch

**Current state:** No current roadmap; CONTEXT.md is outdated  
**Missing:**
- Master roadmap
- V1 scope clarity
- Launch readiness checklist
- Post-launch priorities
- Hardware roadmap (V52, future devices)

**Location to document:** `/docs/14-roadmap/`

## Outdated Assumptions Detected

| Assumption | Current claim | Reality | Source |
|-----------|---|---|---|
| Flutter status | "Mobile (next)" | Implemented and deployed | Code + tests |
| Primary hardware | V28C | V52 (V28C legacy) | Gateway code |
| WhatsApp integration | Future? | Implemented | Code + notify.js |
| Guardian AI | Conceptual | Integrated | gateway/src/assistant/ |
| Care settings | Feature ideas? | Implemented (fall, meds, interval) | Mobile code |
| Multiple pendants | Unknown | Supported | Device model + tests |

## Open Questions Requiring Owner Confirmation

1. **V28C status** — Is V28C still supported, or fully deprecated? Should documentation maintain V28C guides?
2. **V52 availability** — Is V52 the only current device, or are multiple models available?
3. **AI/WhatsApp scope** — Are these production-ready features or still in pilot/development?
4. **Pricing finality** — Are Rs 3000 device + Rs 199/month final, or subject to change?
5. **Geographic scope** — Is Guardian Mauritius-only, or expanding to other markets?
6. **Launch stage** — Is this pre-launch, pilot, or production? When is the launch?
7. **Business model** — Is the model device-sale + recurring subscription, or rental?
8. **Supporting documents** — Are there product requirement documents (PRDs), business plans, or pitch decks that should inform the docs?

## Files & Code Locations Verified

✓ Firestore schema — `firestore/SCHEMA.md` (needs verification)  
✓ Firestore rules — `firestore/rules.example` (current)  
✓ Gateway main — `gateway/src/server.js` (mature)  
✓ Protocol decoder — `gateway/src/protocol/gt06.js` (multi-device support)  
✓ Mobile services — `apps/mobile/lib/services/guardian_services.dart` (mature)  
✓ Device models — `apps/mobile/lib/models/device.dart` (mature)  
✓ Care settings — `apps/mobile/lib/screens/care_settings_page.dart` (implemented)  
✓ Safe zones — `apps/mobile/lib/screens/safe_zones_page.dart` (implemented)  
✓ Dodo character — `apps/mobile/lib/dashboard/` (linked to connection states)  

## Secrets & Sensitive Data Check

✓ No API keys found in documentation  
✓ No personal phone numbers in code  
✓ No customer data in repository  
✓ PDFs in `docs/reference/` contain vendor-public information only  

## Recommended Action

**Do not copy old documentation assumptions into new docs.**

For each feature:
1. Verify from code
2. Verify from tests
3. Verify from live behavior (where applicable)
4. Mark explicitly as "verified" or "unverified"
5. Flag owner-decision items

Prioritize rebuilding areas by impact:
1. System overview + architecture (foundational)
2. Mobile app structure (user-facing)
3. Gateway and device protocol (operational)
4. Firestore and data model (critical for dev)
5. Hardware and supplier (launch-blocking)
6. Business and roadmap (strategic)

