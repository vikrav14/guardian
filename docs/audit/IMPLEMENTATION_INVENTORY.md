# Guardian Implementation Inventory

**Audit Date:** 2026-07-29  
**Status:** Verified from code + tests + live behavior  

## Core Platform Features

| Feature | Status | Code Location | Firestore | Device Commands | Test Evidence | Notes |
|---------|--------|---|---|---|---|---|
| Device connectivity | ✓ Implemented | `gateway/src/server.js` | `devices/{imei}.online` | LK heartbeat | gateway tests | Distinguishes online vs. stale location |
| Location ingestion | ✓ Implemented | `gateway/src/protocol/gt06.js` | `locations/{docId}` | UD_LTE, GPS packets | gateway tests | Handles GPS (A) and WiFi/LBS (V) fallback |
| GPS validation | ✓ Implemented | `gateway/src/protocol/gt06.js` | `location.gpsValid` | Implicit in packets | code inspection | A=valid sat, V=fallback |
| WiFi/LBS fallback | ✓ Implemented | `gateway/src/geolocate/google.js` | `location.accuracySource` | From parsed cells/WiFi | gateway tests | Uses Google Geolocation API |
| Location history | ✓ Implemented (conditional) | `gateway/src/firestore.js` | `locations/` collection | Write-gated | code inspection | WRITE_LOCATION_HISTORY env gate |
| Device status | ✓ Implemented | `gateway/src/server.js` | `devices/{imei}` | heartbeat-derived | code inspection | Battery, connectivity, offline time |
| Multiple linked devices | ✓ Implemented | `apps/mobile/lib/models/device.dart` | `users/{uid}.linkedImeis` | Per-device | mobile code | App supports list of linked IMEIs |
| Device linking | ✓ Implemented | `apps/mobile/lib/screens/linking_page.dart` | Device linking logic | Manual IMEI entry | mobile code | Linking sequence with 4 visual steps |
| Dodo character states | ✓ Implemented | `apps/mobile/lib/dashboard/dodo_stage.dart` | No persistent state | Derived from device state | mobile code | Active / offline / linking / listening |
| Push notifications | ✓ Implemented | `gateway/src/push.js` | `alerts/` collection | FCM integration | code inspection | Firebase Cloud Messaging |
| SMS notifications | ✓ Implemented | `gateway/src/notify.js` | Alert write triggers | Twilio integration | code inspection | To emergency contacts |
| WhatsApp notifications | ✓ Implemented (status unclear) | `gateway/src/notify.js` | Alert write triggers | Twilio WhatsApp API | code inspection | Needs verification if production-ready |
| Guardian AI assistant | ✓ Implemented (status unclear) | `gateway/src/assistant/` | Interaction logs? | N/A | code inspection | Claude integration; needs verification if production-ready |

## Location & Safety Features

| Feature | Status | Code Location | Firestore | Device Commands | Test Evidence | Notes |
|---------|--------|---|---|---|---|---|
| Live map view | ✓ Implemented | `apps/mobile/lib/screens/map_dashboard_page.dart` | Reads `locations/`, `devices/` | N/A | mobile code | Shows device marker + last known location |
| Safe zones | ✓ Implemented | `gateway/src/geofence.js` | `devices/{imei}.safeZones` | Evaluated on device but not commanded | gateway tests | Enter/exit events generate alerts |
| Geofence events | ✓ Implemented | `gateway/src/server.js` | `alerts/` collection | Trigger-based | tests | Geofence enter/exit alerts |
| SOS button | ✓ Implemented | Device firmware | Pending implementation? | Device-triggered | code inspection | Documented as device feature; not yet wired in app |
| SOS escalation | Partial | `gateway/src/notify.js` | `alerts/` collection | SMS/WhatsApp to contacts | code inspection | To emergency contacts defined in Firestore |
| Fall detection | ✓ Implemented (command support) | `gateway/src/commands.js` | `devices/{imei}.fallDetection` | FALLDOWN command | gateway tests | Configurable via app; relies on vendor firmware |
| Fall alert | ✓ Implemented | `gateway/src/server.js` | `alerts/` collection | Device-triggered | tests | Fall alarm generates alert event |
| Battery monitoring | ✓ Implemented | `gateway/src/server.js` | `devices/{imei}.batteryPercent` | LK heartbeat reports battery | code inspection | Low-battery threshold alerts |
| Offline detection | ✓ Implemented | `gateway/src/server.js` | `devices/{imei}.online` | Timeout-based on heartbeat | tests | Marks device offline after no heartbeat |
| Last known location | ✓ Implemented | `apps/mobile/lib/screens/map_dashboard_page.dart` | `devices/{imei}.lastLocation` | N/A | mobile code | Displayed when device offline |

## Care Settings

| Feature | Status | Code Location | Firestore | Device Commands | Test Evidence | Notes |
|---------|--------|---|---|---|---|---|
| Fall detection toggle | ✓ Implemented | `apps/mobile/lib/screens/care_settings_page.dart` | `devices/{imei}.fallDetection` | FALLDOWN,X,Y | gateway tests | Enable/disable SOS call on fall |
| Fall sensitivity | ✓ Implemented | `apps/mobile/lib/screens/care_settings_page.dart` | `devices/{imei}.fallSensitivity` | LSSET,X+Y | gateway tests | Configurable 0-6 range |
| Location reporting interval | ✓ Implemented | `apps/mobile/lib/screens/care_settings_page.dart` | `devices/{imei}.locationReportingIntervalSeconds` | UPLOAD,seconds | gateway tests | 30s-3600s; affects movement reporting |
| Medication reminders | ✓ Implemented | `apps/mobile/lib/screens/care_settings_page.dart` | `devices/{imei}.medicationReminders` | TAKEPILLS command | gateway tests | Time-based with frequency options |

## Gateway & Device Protocol

| Capability | Status | Code Location | Verified | Notes |
|-----------|--------|---|---|---|
| TCP server | ✓ Implemented | `gateway/src/server.js` | Code | Listens 0.0.0.0:9000 |
| GT06 protocol decoder | ✓ Implemented | `gateway/src/protocol/gt06.js` | Tests + live | Handles V28C, V46/V48/V52 variants |
| IMEI normalization | ✓ Implemented | `gateway/src/imei.js` | Code | Protocol ID (10-digit) → Full IMEI (15-digit) |
| Heartbeat (LK) | ✓ Implemented | `gateway/src/protocol/gt06.js` | Tests | Every 5 min by spec; echoed |
| Location upload (UD/AL) | ✓ Implemented | `gateway/src/protocol/gt06.js` | Tests + live | GPS (A) or WiFi/cell (V); timestamp; battery |
| Blind-spot reupload (UD2) | ✓ Implemented | `gateway/src/protocol/gt06.js` | Code | Buffered location from offline period |
| SOS alarm (AL) | ✓ Implemented | `gateway/src/protocol/gt06.js` | Tests | Device-triggered; maps to `severity: critical` |
| Fall alarm | ✓ Implemented | `gateway/src/server.js` | Tests | Parsed from alarm bit; triggers alert |
| Device acknowledgements | ✓ Implemented | `gateway/src/server.js` | Tests | LK, UPLOAD, FALLDOWN, LSSET echo verification |
| TCP downlink commands | ✓ Implemented | `gateway/src/commands.js` | Tests | Requires live session; no SMS fallback |
| CR (positioning request) | ✓ Implemented | `gateway/src/commands.js` | Tests | Forces GPS every 30s for 3 min |
| UPLOAD (reporting interval) | ✓ Implemented | `gateway/src/commands.js` | Tests + live | Sets standing GPS upload interval; CONFIG read-back exists |
| CONFIG packet | ✓ Implemented | `gateway/src/protocol/gt06.js` | Code | Device self-test; includes UL (upload interval) field |
| Mauritius hemisphere fix | ✓ Implemented | `gateway/src/fleet-hemisphere.js` | Tests + live | Corrects GPS latitude hemisphere for V28C fleet |

## Mobile Application

| Component | Status | Code Location | Notes |
|-----------|--------|---|---|
| Home / Mission Control | ✓ Implemented | `apps/mobile/lib/screens/dashboard_page.dart` | Primary caregiver interface |
| Live map view | ✓ Implemented | `apps/mobile/lib/screens/map_dashboard_page.dart` | Shows device marker, history, Dodo character |
| Device card | ✓ Implemented | `apps/mobile/lib/screens/map_dashboard_page.dart` | Status, battery, last update, actions |
| Dodo linking sequence | ✓ Implemented | `apps/mobile/lib/screens/map_dashboard_page.dart` | 4-step visual: Pendant→Network→Location→Guardian AI |
| Care settings | ✓ Implemented | `apps/mobile/lib/screens/care_settings_page.dart` | Fall, medication, location interval |
| Safe zones | ✓ Implemented | `apps/mobile/lib/screens/safe_zones_page.dart` | Create/edit/delete; geofence alerts |
| Family management | ✓ Implemented | `apps/mobile/lib/screens/family_page.dart` | Invite/link family members |
| Notifications | ✓ Implemented | `apps/mobile/` | Firebase Cloud Messaging integration |
| Authentication | ✓ Implemented | `apps/mobile/lib/services/auth_service.dart` | Firebase Auth; auto-demo account |
| Theming | ✓ Implemented | `apps/mobile/lib/theme/` | Light/dark mode support |
| Localization | Partial | `apps/mobile/lib/l10n/` | Nav labels, some settings; mostly English |

## Firebase & Firestore

| Component | Status | Code Location | Verification | Notes |
|-----------|--------|---|---|---|
| Firestore schema | ✓ Current | `firestore/SCHEMA.md` | Code match needed | 10+ collections documented |
| Security rules | ✓ Current | `firestore/rules.example` | Rules enforced in code | `linkedTo(imei)` pattern for access control |
| Firestore indexes | ✓ Current | `firestore/firestore.indexes.json` | Referenced in gateway | Composite index on `imei` + `createdAt` desc |
| Firebase Auth | ✓ Implemented | `apps/mobile/lib/services/auth_service.dart` | Code + tests | Email/password; auto-demo account on first login |
| Firebase Cloud Messaging | ✓ Implemented | `gateway/src/push.js` | Code | FCM push to mobile app |

## Data & Observability

| Component | Status | Code Location | Notes |
|-----------|--------|---|---|
| Firestore writes | ✓ Implemented | `gateway/src/firestore.js` | Admin SDK; gated by `WRITE_LOCATION_HISTORY` |
| Device commands queue | ✓ Implemented | `gateway/src/firestore.js` | `deviceCommands/{docId}` collection |
| Alert generation | ✓ Implemented | `gateway/src/server.js` | Triggers on location, alarm, geofence, battery |
| Event logging | Partial | `gateway/src/` | Console logs; no persistent audit log documented |
| Metrics | Partial | `gateway/src/` | Some metrics reference; no documented metrics collection |
| Error reporting | Partial | `gateway/src/` | Console errors; no remote error tracking documented |

## Unverified or Status-Unclear Features

| Feature | Claim | Status | Notes |
|---------|-------|--------|-------|
| WhatsApp notifications | Implemented in code | Code present, production-readiness unclear | Needs owner confirmation |
| Guardian AI assistant | Implemented in code | Code present, production-readiness unclear | Needs owner confirmation |
| Remote photo capture | Documented in protocol | No implementation found | #28 in GitHub issues; supplier-dependent |
| Pedometer/step counting | Documented in protocol | Partial; PEDO/WALKTIME commands present | Needs verification |
| Pill reminders voice | Documented in protocol | TAKEPILLS command present | Needs verification |
| Voice monitoring | Documented in protocol | MONITOR command in code | Unverified; privacy implications |
| SOS button behavior | Documented as device feature | Device-triggered in tests; app UI not confirmed | Needs verification |

## Hardware Support Matrix

| Capability | V28C | V52 | V46/V48 | Code Support | Verified | Notes |
|-----------|---:|---:|---:|---|---|---|
| Heartbeat | ✓ | ✓ | ✓ | `gateway/src/protocol/gt06.js` | Yes | LK command |
| GPS location | ✓ | ✓ | ✓ | `gateway/src/protocol/gt06.js` | Yes | UD_LTE, etc. |
| WiFi/cell fallback | ✓ | ✓ | ✓ | `gateway/src/geolocate/google.js` | Yes | V flag; Google API |
| Upload interval | ✗ | ✓ | ✓ | `gateway/src/commands.js` | Partial | UPLOAD command |
| Fall detection | ✗ | ✓ | ✓ | `gateway/src/commands.js` | Partial | FALLDOWN command |
| SOS | ✗? | ✓ | ✓ | `gateway/src/protocol/gt06.js` | Unclear | Needs verification |
| Medication reminders | ✗? | ✓ | ✓ | `gateway/src/commands.js` | Partial | TAKEPILLS command |
| Voice monitor | ✗? | ✓ | ✓ | `gateway/src/commands.js` | Unverified | MONITOR command |
| Ring to find | ✓ | ✓ | ✓ | `gateway/src/commands.js` | Unverified | FIND command |

## Test Coverage

| Test Suite | Location | Verified Features | Notes |
|-----------|----------|---|---|
| Gateway protocol tests | `gateway/test/protocol/gt06.test.js` | Packet parsing, device types, location data | Comprehensive |
| Gateway commands tests | `gateway/test/commands.test.js` | Command building, validation, downlink | Good coverage |
| Gateway geofence tests | `gateway/test/geofence.test.js` | Safe zone evaluation, enter/exit | Complete |
| Gateway server tests | `gateway/test/server.test.js` | Event processing, Firestore writes | Basic coverage |
| Mobile unit tests | `apps/mobile/test/` | Linking story, models, some screens | Exists but extent unclear |
| Mobile widget tests | `apps/mobile/test/` | Dashboard, care settings | Partial |

## Known Gaps & Limitations

**Device command delivery:**
- No read-back mechanism for most commands (UPLOAD may have CONFIG read-back but unconfirmed)
- Request-cache model: app caches desired state in Firestore, but cannot confirm device compliance
- No SMS fallback (TCP only; requires live session)

**Location accuracy:**
- WiFi/cell fallback uses Google Geolocation API (external dependency)
- Accuracy estimates not always reliable ("mostly 0.0" per protocol doc)
- GPS hemisphere issue fixed for Mauritius fleet only

**Notifications:**
- Device command delivery not confirmed in UI
- Alert explanations rely on Guardian AI (production-readiness unclear)

**Business/Operations:**
- No pricing tier enforcement
- No payment processing
- No device provisioning workflow documented
- No batch QA procedure documented

