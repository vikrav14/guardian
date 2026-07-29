# Repository Structure

**Last updated:** 2026-07-29

Guide to where everything lives in the Guardian repository.

## Top-Level Files

```
guardian/
├── README.md            # Overview (what to read first)
├── CONTEXT.md           # AI orientation (for Claude, etc.)
├── CLAUDE.md            # Guardian-specific development rules
├── .gitignore           # Excludes: .env, node_modules, build artifacts
├── .github/             # GitHub workflows (CI/CD)
└── LICENSE              # License (TBD)
```

## `apps/mobile/` — Flutter Mobile App

```
apps/mobile/
├── lib/
│   ├── main.dart                 # App entry point
│   ├── theme/                    # Colors, typography, theming
│   ├── screens/                  # One file per screen
│   │   ├── dashboard_page.dart
│   │   ├── map_dashboard_page.dart
│   │   ├── device_linking_page.dart
│   │   ├── care_settings_page.dart
│   │   ├── safe_zones_page.dart
│   │   ├── family_page.dart
│   │   └── settings_page.dart
│   ├── services/
│   │   ├── auth_service.dart     # Firebase Auth + demo account
│   │   ├── guardian_services.dart # Firestore queries/writes (main)
│   │   ├── location_service.dart  # Location-related queries
│   │   └── notification_service.dart
│   ├── models/                   # Data classes
│   │   ├── device.dart
│   │   ├── location.dart
│   │   ├── user.dart
│   │   ├── alert.dart
│   │   └── safe_zone.dart
│   ├── dashboard/                # Dodo character & map components
│   │   ├── dodo_stage.dart       # Dodo visual states
│   │   ├── map_widget.dart
│   │   └── device_card.dart
│   ├── l10n/                     # Localization (partial)
│   │   ├── app_en.arb
│   │   └── app_xx.arb
│   └── widgets/                  # Reusable widgets
│       ├── loading_spinner.dart
│       ├── error_dialog.dart
│       └── ...
├── test/                         # Unit + widget tests
│   ├── models/
│   ├── services/
│   ├── screens/
│   └── widgets/
├── android/                      # Android-specific config
├── web/                          # Web-specific config
├── pubspec.yaml                  # Dart dependencies
├── pubspec.lock                  # Locked dependency versions
└── README.md                     # Mobile app README
```

**Key files:**
- `lib/services/guardian_services.dart` — All Firestore queries live here
- `lib/screens/*.dart` — Each screen is one file, UI + business logic
- `lib/models/` — Data classes (Device, Location, User, etc.)
- `test/` — Tests using `fake_cloud_firestore` + `firebase_auth_mocks`

## `gateway/` — Node.js TCP Gateway

```
gateway/
├── src/
│   ├── server.js                 # Main TCP listener & event loop
│   ├── protocol/
│   │   ├── gt06.js               # GT06 packet decoder (500+ lines)
│   │   ├── imei.js               # IMEI normalization
│   │   └── test-packets.js       # Example packets for testing
│   ├── commands.js               # Device command builders
│   ├── firestore.js              # Firestore writes (admin SDK)
│   ├── geofence.js               # Safe zone evaluation
│   ├── push.js                   # FCM push notifications
│   ├── notify.js                 # SMS/WhatsApp notifications (Twilio)
│   ├── assistant/                # Claude AI integration
│   │   ├── index.js
│   │   └── prompts.js
│   ├── fleet-hemisphere.js       # Mauritius GPS fix
│   └── utils.js                  # Helpers
├── test/
│   ├── protocol/
│   │   └── gt06.test.js          # Protocol parsing tests
│   ├── commands.test.js          # Command building tests
│   ├── geofence.test.js          # Geofence logic tests
│   ├── server.test.js            # Event processing tests
│   └── integration/              # End-to-end tests
├── .env.example                  # Environment template
├── .env                          # Actual secrets (git ignored)
├── package.json                  # Node.js dependencies
├── package-lock.json             # Locked versions
└── README.md                     # Gateway README
```

**Key files:**
- `server.js` — TCP listener, heartbeat handler, command dispatcher
- `protocol/gt06.js` — Packet parsing (UD, LK, AL, CONFIG, UD2)
- `commands.js` — UPLOAD, FALLDOWN, TAKEPILLS, CR, FIND builders
- `firestore.js` — Writes to Firestore collections
- `geofence.js` — Enter/exit logic
- `test/*.js` — Comprehensive test coverage

## `firestore/` — Schema & Security

```
firestore/
├── SCHEMA.md                     # Complete data model (source of truth)
├── rules.example                 # Security rules (deployed to Firebase)
├── firestore.indexes.json        # Composite index definitions
└── README.md
```

**Key files:**
- `SCHEMA.md` — Documents every collection & field
- `rules.example` — `linkedTo(imei)` access control pattern

## `docs/` — Documentation (You Are Here)

```
docs/
├── README.md                     # Docs navigation hub
├── audit/                        # Audit findings & inventory
│   ├── DOCUMENTATION_AUDIT.md
│   ├── IMPLEMENTATION_INVENTORY.md
│   ├── OPEN_QUESTIONS.md
│   ├── OUTDATED_ASSUMPTIONS.md
│   └── DOCUMENTATION_REBUILD_PLAN.md
├── 00-overview/                  # (Coming Phase 2)
│   └── GLOSSARY.md
├── 01-product/                   # (Coming Phase 2)
│   ├── FEATURE_MAP.md
│   └── SAFETY_MODEL.md
├── 02-architecture/              # (Phase 1 ✓)
│   ├── SYSTEM_OVERVIEW.md
│   ├── DATA_FLOW.md
│   ├── DEVICE_TO_APP_FLOW.md
│   └── SECURITY_MODEL.md
├── 03-mobile/                    # (Phase 1 ✓)
│   ├── MOBILE_OVERVIEW.md
│   ├── DEVICE_LINKING.md
│   ├── CARE_SETTINGS.md
│   └── SAFE_ZONES.md
├── 04-gateway/                   # (Phase 1 ✓)
│   ├── GATEWAY_OVERVIEW.md
│   ├── TCP_CONNECTION_LIFECYCLE.md
│   ├── GT06_PROTOCOL.md
│   ├── LOCATION_PIPELINE.md
│   ├── DEVICE_COMMANDS.md
│   ├── DOWNLINK_PROTOCOL.md
│   └── EVENT_PROCESSING.md
├── 05-data/                      # (Phase 1 ✓)
│   ├── FIRESTORE_OVERVIEW.md
│   ├── COLLECTIONS_REFERENCE.md
│   ├── SECURITY_RULES.md
│   └── DATA_OWNERSHIP.md
├── 06-hardware/                  # (Phase 1 ✓)
│   ├── V52.md
│   ├── DEVICE_CAPABILITY_MATRIX.md
│   ├── GPS_BEHAVIOR.md
│   ├── BATTERY_AND_REPORTING.md
│   ├── FALL_DETECTION.md
│   ├── SOS_BUTTON.md
│   ├── MEDICATION_REMINDERS.md
│   └── PROTOCOL_REFERENCE.md
├── 08-notifications/             # (Phase 1 ✓)
│   ├── NOTIFICATIONS_ARCHITECTURE.md
│   ├── EVENT_CATALOG.md
│   └── PUSH_NOTIFICATIONS.md
├── 09-development/               # (Phase 1 ✓)
│   ├── GETTING_STARTED.md
│   ├── LOCAL_DEVELOPMENT.md
│   ├── REPOSITORY_STRUCTURE.md
│   ├── FIREBASE_SETUP.md
│   └── GATEWAY_SETUP.md
├── 12-operations/                # (Phase 1 ✓)
│   └── SUPPLIER_ONBOARDING.md
└── 14-roadmap/                   # (Phase 1 ✓)
    └── MASTER_ROADMAP.md
```

## `scripts/` — Utilities

```
scripts/
├── setup-github-issues.sh    # Creates GitHub issues from template
└── [other deployment scripts]
```

## `.github/` — GitHub Configuration

```
.github/
├── workflows/                # CI/CD workflows
│   ├── flutter-tests.yml
│   ├── gateway-tests.yml
│   └── deploy.yml
└── ISSUE_TEMPLATE/           # Issue templates
```

## Naming Conventions

### Flutter (Dart)

- **Files:** `snake_case.dart` (e.g., `device_linking_page.dart`)
- **Classes:** `PascalCase` (e.g., `DeviceLinkingPage`)
- **Functions:** `camelCase` (e.g., `fetchDeviceLocation()`)
- **Variables:** `camelCase` (e.g., `deviceImei`)

### Node.js (JavaScript)

- **Files:** `camelCase.js` or `kebab-case.js` (e.g., `gt06.js`, `device-commands.js`)
- **Classes:** `PascalCase` (e.g., `GTSixProtocol`)
- **Functions:** `camelCase` (e.g., `parseLocation()`)
- **Constants:** `UPPER_SNAKE_CASE` (e.g., `DEFAULT_TIMEOUT`)

## Adding New Code

### New Mobile Screen

1. Create: `apps/mobile/lib/screens/new_page.dart`
2. Add route in `main.dart`
3. Write tests in `test/screens/new_page_test.dart`
4. Import `guardian_services` for Firestore access

### New Gateway Command

1. Add builder in `gateway/src/commands.js`
2. Write test in `gateway/test/commands.test.js`
3. Wire into mobile app (UI + service call)
4. Document in `docs/04-gateway/DEVICE_COMMANDS.md`

### New Firestore Collection

1. Document in `firestore/SCHEMA.md`
2. Add write logic in `gateway/src/firestore.js`
3. Add security rule in `firestore/rules.example`
4. Add query in `apps/mobile/lib/services/guardian_services.dart`

## Where to Find Things

| Need | Location |
|------|----------|
| Device linking logic | `apps/mobile/lib/services/guardian_services.dart` |
| Firestore queries | `apps/mobile/lib/services/guardian_services.dart` |
| Map display | `apps/mobile/lib/screens/map_dashboard_page.dart` |
| Geofence evaluation | `gateway/src/geofence.js` |
| Location pipeline | `gateway/src/server.js` |
| Protocol parsing | `gateway/src/protocol/gt06.js` |
| Push notifications | `gateway/src/push.js` |
| SMS/WhatsApp alerts | `gateway/src/notify.js` |
| Firestore schema | `firestore/SCHEMA.md` |
| Security rules | `firestore/rules.example` |
| Device commands | `gateway/src/commands.js` |

---

**Next:** [Local Development](LOCAL_DEVELOPMENT.md) — Daily workflow
